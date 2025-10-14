import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

export interface GeminiUploadResult {
  fileUri: string;
  mimeType: string;
  name: string;
}

export interface GeminiOCRResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Client for interacting with Google Gemini File API for OCR processing
 */
export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private fileManager: GoogleAIFileManager;
  private model: GenerativeModel;

  constructor(apiKey: string, modelName: string = 'gemini-2.0-flash-exp') {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.fileManager = new GoogleAIFileManager(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: 65536,
        stopSequences: ["Ne t'arrête pas avant d'avoir procéder TOUT les pages et TOUT les inscriptions du document"],
      },
    });

    logger.info({ modelName }, 'Gemini client initialized');
  }

  /**
   * Upload a file to Gemini File API
   */
  async uploadFile(filePath: string, mimeType: string = 'application/pdf'): Promise<GeminiUploadResult> {
    try {
      logger.info({ filePath, mimeType }, 'Uploading file to Gemini');

      const uploadResult = await this.fileManager.uploadFile(filePath, {
        mimeType,
        displayName: path.basename(filePath),
      });

      logger.info({
        fileUri: uploadResult.file.uri,
        name: uploadResult.file.name,
        state: uploadResult.file.state,
      }, 'File uploaded to Gemini');

      // Wait for file to be processed if needed
      if (uploadResult.file.state === FileState.PROCESSING) {
        logger.info({ fileName: uploadResult.file.name }, 'File is processing, waiting...');
        await this.waitForFileProcessing(uploadResult.file.name);
      }

      return {
        fileUri: uploadResult.file.uri,
        mimeType: uploadResult.file.mimeType,
        name: uploadResult.file.name,
      };
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to upload file to Gemini');
      throw new Error(`Gemini file upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Wait for file to finish processing
   */
  private async waitForFileProcessing(fileName: string, maxWaitMs: number = 120000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const file = await this.fileManager.getFile(fileName);

        if (file.state === FileState.ACTIVE) {
          logger.info({ fileName }, 'File processing complete');
          return;
        }

        if (file.state === FileState.FAILED) {
          throw new Error(`File processing failed: ${fileName}`);
        }

        logger.debug({ fileName, state: file.state }, 'File still processing...');
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        logger.error({ error, fileName }, 'Error checking file status');
        throw error;
      }
    }

    throw new Error(`File processing timeout after ${maxWaitMs}ms: ${fileName}`);
  }

  /**
   * Extract text from a file using OCR with a custom prompt
   */
  async extractText(fileUri: string, prompt: string): Promise<GeminiOCRResult> {
    try {
      logger.info({ fileUri, promptLength: prompt.length }, 'Sending OCR request to Gemini');

      const result = await this.model.generateContent([
        {
          fileData: {
            mimeType: 'application/pdf',
            fileUri: fileUri,
          },
        },
        { text: prompt },
      ]);

      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      logger.info({
        fileUri,
        responseLength: text.length,
      }, 'OCR extraction successful');

      return {
        success: true,
        content: text,
      };
    } catch (error) {
      logger.error({ error, fileUri }, 'OCR extraction failed');
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a file from Gemini File API
   */
  async deleteFile(fileName: string): Promise<void> {
    try {
      await this.fileManager.deleteFile(fileName);
      logger.info({ fileName }, 'File deleted from Gemini');
    } catch (error) {
      logger.warn({ error, fileName }, 'Failed to delete file from Gemini (non-critical)');
    }
  }

  /**
   * Process a local PDF file: upload, extract, and cleanup
   */
  async processFile(
    localFilePath: string,
    prompt: string
  ): Promise<GeminiOCRResult> {
    let uploadedFileName: string | null = null;

    try {
      // Upload file
      const uploadResult = await this.uploadFile(localFilePath);
      uploadedFileName = uploadResult.name;

      // Extract text
      const extractResult = await this.extractText(uploadResult.fileUri, prompt);

      // Cleanup
      if (uploadedFileName) {
        await this.deleteFile(uploadedFileName);
      }

      return extractResult;
    } catch (error) {
      // Cleanup on error
      if (uploadedFileName) {
        await this.deleteFile(uploadedFileName);
      }

      logger.error({ error, localFilePath }, 'File processing failed');
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Load prompt from file
   */
  static async loadPrompt(documentSource: 'index' | 'acte' | 'plan_cadastraux'): Promise<string> {
    const promptPath = path.join(__dirname, 'prompts', `${documentSource}.txt`);

    try {
      const prompt = await fs.readFile(promptPath, 'utf-8');
      logger.debug({ documentSource, promptPath }, 'Loaded OCR prompt');
      return prompt;
    } catch (error) {
      logger.error({ error, documentSource, promptPath }, 'Failed to load OCR prompt');
      throw new Error(`Failed to load prompt for ${documentSource}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


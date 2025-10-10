import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { logger } from '../utils/logger';
import { OCRLogger } from './ocr-logger';
import fs from 'fs/promises';
import path from 'path';

export interface GeminiFileClientConfig {
  apiKey: string;
  defaultModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export interface FileUploadResult {
  fileUri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  state: string;
}

export interface FileProcessingStatus {
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes: string;
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  createTime: string;
  updateTime: string;
}

export interface OCRFileExtractionResult {
  text: string;
  isComplete: boolean;
  totalPages?: number;
}

/**
 * Client for Gemini File API
 * Handles file uploads, status checking, and content generation for large documents
 */
export class GeminiFileClient {
  private genAI: GoogleGenerativeAI;
  private fileManager: GoogleAIFileManager;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: GeminiFileClientConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.fileManager = new GoogleAIFileManager(config.apiKey);
    this.defaultModel = config.defaultModel || 'gemini-2.0-flash-exp';
    this.defaultTemperature = config.defaultTemperature || 0.1;
    this.defaultMaxTokens = config.defaultMaxTokens || 8192;

    logger.debug({
      model: this.defaultModel,
      temperature: this.defaultTemperature,
      maxTokens: this.defaultMaxTokens
    }, 'Gemini File Client initialized');
  }

  /**
   * Upload a file to the Gemini File API
   */
  async uploadFile(filePath: string, displayName?: string): Promise<FileUploadResult> {
    try {
      logger.info({ filePath, displayName }, 'Uploading file to Gemini File API');

      // Read file stats
      const stats = await fs.stat(filePath);
      const sizeKB = Math.round(stats.size / 1024);
      
      OCRLogger.debug(`📤 Uploading file: ${path.basename(filePath)} (${sizeKB} KB)`);

      // Upload file using the File Manager
      const uploadResult = await this.fileManager.uploadFile(filePath, {
        displayName: displayName || path.basename(filePath),
        mimeType: 'application/pdf',
      });

      logger.info({
        fileName: uploadResult.file.name,
        uri: uploadResult.file.uri,
        mimeType: uploadResult.file.mimeType,
        state: uploadResult.file.state
      }, 'File uploaded successfully');

      OCRLogger.debug(`✅ File uploaded: ${uploadResult.file.name} (state: ${uploadResult.file.state})`);

      return {
        fileUri: uploadResult.file.uri,
        fileName: uploadResult.file.name,
        mimeType: uploadResult.file.mimeType,
        sizeBytes: parseInt(uploadResult.file.sizeBytes || '0'),
        state: uploadResult.file.state
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        filePath
      }, 'Failed to upload file to Gemini File API');
      throw error;
    }
  }

  /**
   * Check the processing status of an uploaded file
   */
  async getFileStatus(fileName: string): Promise<FileProcessingStatus> {
    try {
      const file = await this.fileManager.getFile(fileName);

      return {
        name: file.name,
        uri: file.uri,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes || '0',
        state: file.state as 'PROCESSING' | 'ACTIVE' | 'FAILED',
        createTime: file.createTime || '',
        updateTime: file.updateTime || ''
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        fileName
      }, 'Failed to get file status');
      throw error;
    }
  }

  /**
   * Wait for a file to be processed and become ACTIVE
   */
  async waitForFileProcessing(
    fileName: string,
    maxWaitMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<void> {
    const startTime = Date.now();
    
    OCRLogger.debug(`⏳ Waiting for file processing: ${fileName}`);

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getFileStatus(fileName);

      if (status.state === 'ACTIVE') {
        OCRLogger.debug(`✅ File processing complete: ${fileName}`);
        return;
      }

      if (status.state === 'FAILED') {
        throw new Error(`File processing failed: ${fileName}`);
      }

      // Still processing, wait and retry
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`File processing timeout after ${maxWaitMs}ms: ${fileName}`);
  }

  /**
   * Extract text from an uploaded file using Gemini
   */
  async extractTextFromFile(
    fileName: string,
    fileUri: string,
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    }
  ): Promise<OCRFileExtractionResult> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature || this.defaultTemperature;
    const maxAttempts = options?.maxAttempts || 3;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('2.5') && model.includes('pro')) {
      maxTokens = 65536; // Gemini 2.5 Pro supports up to 65,536 tokens
    } else if (model.includes('pro')) {
      maxTokens = 32768; // Older Pro models support 32,768 tokens
    }

    const generativeModel = this.genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    });

    let accumulatedText = '';
    let isComplete = false;
    let attemptCount = 0;

    OCRLogger.debug(`🔍 Extracting text from file: ${fileName} (model: ${model})`);

    while (!isComplete && attemptCount < maxAttempts) {
      attemptCount++;

      try {
        // Get the file reference
        const file = await this.fileManager.getFile(fileName);

        let finalPrompt = prompt;
        if (attemptCount > 1) {
          finalPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.`;
        }

        const result = await generativeModel.generateContent([
          {
            fileData: {
              mimeType: file.mimeType,
              fileUri: fileUri
            }
          },
          { text: finalPrompt }
        ]);

        const response = await result.response;
        const text = response.text();

        accumulatedText += text;

        // Check for completion marker
        if (text.includes('✅ EXTRACTION_COMPLETE:')) {
          isComplete = true;
          OCRLogger.debug(`✅ Extraction complete (${accumulatedText.length} chars)`);
        } else if (attemptCount < maxAttempts) {
          OCRLogger.retryAttempt('File Extraction', attemptCount, maxAttempts);
        }

      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : error,
          attempt: attemptCount,
          fileName
        }, 'Error during file text extraction');

        if (attemptCount >= maxAttempts) {
          throw error;
        }
      }
    }

    return {
      text: accumulatedText,
      isComplete
    };
  }

  /**
   * Apply boost corrections to raw OCR text
   */
  async boostText(
    rawText: string,
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    }
  ): Promise<{ boostedText: string; isComplete: boolean }> {
    const model = options?.model || 'gemini-2.5-pro';
    const temperature = options?.temperature || 0.2;
    const maxAttempts = options?.maxAttempts || 3;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('2.5') && model.includes('pro')) {
      maxTokens = 65536;
    } else if (model.includes('pro')) {
      maxTokens = 32768;
    }

    const generativeModel = this.genAI.getGenerativeModel({
      model,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    });

    let accumulatedText = '';
    let isComplete = false;
    let attemptCount = 0;

    OCRLogger.debug(`🚀 Boosting text (${rawText.length} chars, model: ${model})`);

    while (!isComplete && attemptCount < maxAttempts) {
      attemptCount++;

      try {
        let fullPrompt = `${prompt}\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;

        if (attemptCount > 1) {
          fullPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;
        }

        const result = await generativeModel.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        accumulatedText += text;

        // Check for completion marker
        if (text.includes('✅ BOOST_COMPLETE:')) {
          isComplete = true;
          OCRLogger.debug(`✅ Boost complete (${accumulatedText.length} chars)`);
        } else if (attemptCount < maxAttempts) {
          OCRLogger.retryAttempt('Boost', attemptCount, maxAttempts);
        }

      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : error,
          attempt: attemptCount
        }, 'Error during text boost');

        if (attemptCount >= maxAttempts) {
          throw error;
        }
      }
    }

    return {
      boostedText: accumulatedText,
      isComplete
    };
  }

  /**
   * Delete an uploaded file
   */
  async deleteFile(fileName: string): Promise<void> {
    try {
      await this.fileManager.deleteFile(fileName);
      logger.debug({ fileName }, 'File deleted from Gemini File API');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        fileName
      }, 'Failed to delete file');
      // Don't throw - file cleanup is not critical
    }
  }
}


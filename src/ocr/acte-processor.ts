import { GeminiFileClient } from './gemini-file-client';
import { ACTE_EXTRACT_PROMPT, ACTE_BOOST_PROMPT } from './prompts-acte';
import { logger } from '../utils/logger';
import { OCRLogger } from './ocr-logger';
import fs from 'fs/promises';
import path from 'path';

export interface ActeOCRProcessorConfig {
  geminiApiKey: string;
  tempDir?: string;
  extractModel?: string;
  boostModel?: string;
  extractTemperature?: number;
  boostTemperature?: number;
}

export interface ActeOCRResult {
  rawText: string;
  boostedText: string;
  fileName?: string;
}

/**
 * OCR Processor for Acte Documents using Gemini File API
 * Handles complete text extraction from acte documents (typed and handwritten)
 */
export class ActeOCRProcessor {
  private geminiClient: GeminiFileClient;
  private tempDir: string;
  private extractModel: string;
  private boostModel: string;
  private extractTemperature: number;
  private boostTemperature: number;

  constructor(config: ActeOCRProcessorConfig) {
    this.geminiClient = new GeminiFileClient({
      apiKey: config.geminiApiKey,
      defaultModel: config.extractModel || 'gemini-2.0-flash-exp',
      defaultTemperature: config.extractTemperature || 0.1,
    });

    this.tempDir = config.tempDir || '/tmp/ocr-acte-processing';
    this.extractModel = config.extractModel || 'gemini-2.0-flash-exp';
    this.boostModel = config.boostModel || 'gemini-2.5-pro';
    this.extractTemperature = config.extractTemperature || 0.1;
    this.boostTemperature = config.boostTemperature || 0.2;

    logger.debug({
      extractModel: this.extractModel,
      boostModel: this.boostModel,
      tempDir: this.tempDir
    }, 'Acte OCR Processor initialized');
  }

  /**
   * Initialize the processor (create temp directory)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      logger.debug({ tempDir: this.tempDir }, 'Acte OCR temp directory created');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        tempDir: this.tempDir
      }, 'Failed to create temp directory');
      throw error;
    }
  }

  /**
   * Cleanup temp directory
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        await fs.unlink(path.join(this.tempDir, file));
      }
      logger.debug({ tempDir: this.tempDir }, 'Acte OCR temp directory cleaned');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error
      }, 'Failed to cleanup temp directory');
    }
  }

  /**
   * Process an acte PDF file: upload to File API, extract text, and apply boost
   */
  async processActePDF(pdfPath: string, documentNumber: string): Promise<ActeOCRResult> {
    logger.info({ pdfPath, documentNumber }, 'Starting Acte OCR processing');

    const startTime = Date.now();
    let uploadedFileName: string | undefined;

    try {
      // Step 1: Upload PDF to Gemini File API
      OCRLogger.debug(`📤 Uploading acte PDF to Gemini File API: ${documentNumber}`);
      
      const uploadResult = await this.geminiClient.uploadFile(
        pdfPath,
        `acte-${documentNumber}`
      );

      uploadedFileName = uploadResult.fileName;
      const uploadDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      OCRLogger.debug(
        `✅ Upload complete (${uploadDuration}s) - File: ${uploadResult.fileName}, ` +
        `State: ${uploadResult.state}, Size: ${Math.round(uploadResult.sizeBytes / 1024)} KB`
      );

      // Step 2: Wait for file processing if needed
      if (uploadResult.state === 'PROCESSING') {
        OCRLogger.debug(`⏳ Waiting for file processing: ${uploadResult.fileName}`);
        await this.geminiClient.waitForFileProcessing(uploadResult.fileName, 60000, 2000);
      }

      // Step 3: Extract text from the uploaded file
      OCRLogger.debug(`🔍 Extracting text from acte document: ${documentNumber}`);

      const extractionResult = await this.geminiClient.extractTextFromFile(
        uploadResult.fileName,
        uploadResult.fileUri,
        ACTE_EXTRACT_PROMPT,
        {
          model: this.extractModel,
          temperature: this.extractTemperature
        }
      );

      const extractDuration = ((Date.now() - startTime) / 1000).toFixed(1);

      OCRLogger.debug(
        `✅ Extraction complete (${extractDuration}s) - ` +
        `${extractionResult.text.length} chars`
      );

      logger.info({
        documentNumber,
        textLength: extractionResult.text.length,
        duration: extractDuration
      }, 'Text extraction completed for acte');

      // Step 4: Apply boost corrections to the extracted text
      OCRLogger.debug(`🚀 Applying boost corrections: ${documentNumber}`);

      const boostResult = await this.geminiClient.boostText(
        extractionResult.text,
        ACTE_BOOST_PROMPT,
        {
          model: this.boostModel,
          temperature: this.boostTemperature
        }
      );

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

      OCRLogger.debug(
        `✅ Boost complete (${totalDuration}s total) - ` +
        `${boostResult.boostedText.length} chars`
      );

      logger.info({
        documentNumber,
        rawTextLength: extractionResult.text.length,
        boostedTextLength: boostResult.boostedText.length,
        totalDuration
      }, 'Acte OCR processing completed');

      return {
        rawText: extractionResult.text,
        boostedText: boostResult.boostedText,
        fileName: uploadResult.fileName
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        pdfPath,
        documentNumber
      }, '❌ Acte OCR processing failed');
      throw error;
    } finally {
      // Step 5: Cleanup - delete the uploaded file from Gemini File API
      if (uploadedFileName) {
        try {
          OCRLogger.debug(`🗑️  Deleting uploaded file: ${uploadedFileName}`);
          await this.geminiClient.deleteFile(uploadedFileName);
        } catch (error) {
          logger.warn({
            error: error instanceof Error ? error.message : error,
            fileName: uploadedFileName
          }, 'Failed to delete uploaded file (non-critical)');
        }
      }
    }
  }

  /**
   * Process an acte PDF with token limit handling
   * This method handles cases where the document is too large and needs chunking
   */
  async processActePDFWithChunking(
    pdfPath: string,
    documentNumber: string
  ): Promise<ActeOCRResult> {
    // Process the entire document
    try {
      const result = await this.processActePDF(pdfPath, documentNumber);
      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        documentNumber
      }, 'Acte OCR processing failed');
      throw error;
    }
  }
}


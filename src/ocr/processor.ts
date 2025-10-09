import { GeminiOCRClient } from './gemini-client';
import { PDFConverter } from './pdf-converter';
import { EXTRACT_PROMPT, BOOST_PROMPT } from './prompts';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

export interface OCRProcessorConfig {
  geminiApiKey: string;
  tempDir?: string;
  extractModel?: string;
  boostModel?: string;
  extractTemperature?: number;
  boostTemperature?: number;
}

export interface OCRResult {
  rawText: string;
  boostedText: string;
  extractionComplete: boolean;
  boostComplete: boolean;
}

export interface PageOCRResult {
  pageNumber: number;
  rawText: string;
  boostedText: string;
  extractionComplete: boolean;
  boostComplete: boolean;
}

export interface MultiPageOCRResult {
  pages: PageOCRResult[];
  totalPages: number;
  combinedRawText: string;
  combinedBoostedText: string;
  allPagesComplete: boolean;
}

/**
 * Main OCR Processor that orchestrates PDF conversion, text extraction, and boosting
 */
export class OCRProcessor {
  private geminiClient: GeminiOCRClient;
  private pdfConverter: PDFConverter;
  private extractModel: string;
  private boostModel: string;
  private extractTemperature: number;
  private boostTemperature: number;

  constructor(config: OCRProcessorConfig) {
    this.geminiClient = new GeminiOCRClient({
      apiKey: config.geminiApiKey,
      model: config.extractModel || 'gemini-2.0-flash-exp',
      temperature: config.extractTemperature || 0.1
    });

    this.pdfConverter = new PDFConverter(config.tempDir);
    this.extractModel = config.extractModel || 'gemini-2.0-flash-exp';
    this.boostModel = config.boostModel || 'gemini-2.5-pro';
    this.extractTemperature = config.extractTemperature || 0.1;
    this.boostTemperature = config.boostTemperature || 0.2;

    logger.info({
      extractModel: this.extractModel,
      boostModel: this.boostModel,
      extractTemp: this.extractTemperature,
      boostTemp: this.boostTemperature
    }, 'OCR Processor initialized');
  }

  async initialize(): Promise<void> {
    await this.pdfConverter.initialize();
  }

  /**
   * Process a single page: extract text and apply boost
   */
  private async processPage(
    pageNumber: number,
    base64Data: string,
    mimeType: string
  ): Promise<PageOCRResult> {
    logger.info({ pageNumber }, 'Processing page');

    try {
      // Step 1: Extract text from image
      const extractionResult = await this.geminiClient.extractText(
        base64Data,
        mimeType,
        EXTRACT_PROMPT,
        {
          model: this.extractModel,
          temperature: this.extractTemperature,
          maxAttempts: 3
        }
      );

      logger.info({
        pageNumber,
        textLength: extractionResult.text.length,
        isComplete: extractionResult.isComplete
      }, 'Text extraction completed for page');

      // Step 2: Apply boost corrections
      const boostResult = await this.geminiClient.boostText(
        extractionResult.text,
        BOOST_PROMPT,
        {
          model: this.boostModel,
          temperature: this.boostTemperature,
          maxAttempts: 3
        }
      );

      logger.info({
        pageNumber,
        boostedTextLength: boostResult.boostedText.length,
        isComplete: boostResult.isComplete
      }, 'Boost corrections applied for page');

      return {
        pageNumber,
        rawText: extractionResult.text,
        boostedText: boostResult.boostedText,
        extractionComplete: extractionResult.isComplete,
        boostComplete: boostResult.isComplete
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        pageNumber
      }, 'Page processing failed');
      throw error;
    }
  }

  /**
   * Process all pages of a PDF in parallel
   */
  async processPDFParallel(pdfPath: string): Promise<MultiPageOCRResult> {
    logger.info({ pdfPath }, 'Starting parallel OCR processing');

    try {
      // Step 1: Convert all PDF pages to images
      logger.info({ pdfPath }, 'Converting all PDF pages to images');
      const conversionResult = await this.pdfConverter.convertAllPagesToImages(pdfPath, {
        dpi: 300,
        format: 'png',
        quality: 95
      });

      logger.info({
        totalPages: conversionResult.totalPages,
        totalSizeKB: Math.round(
          conversionResult.pages.reduce((sum, p) => sum + p.base64Data.length, 0) / 1024
        )
      }, 'All PDF pages converted to images');

      // Step 2: Process all pages in parallel
      logger.info({ totalPages: conversionResult.totalPages }, 'Processing all pages in parallel');
      const pageProcessingPromises = conversionResult.pages.map((page, index) =>
        this.processPage(index + 1, page.base64Data, page.mimeType)
      );

      const pageResults = await Promise.all(pageProcessingPromises);

      // Step 3: Combine results
      const combinedRawText = pageResults
        .map(p => `\n\n--- Page ${p.pageNumber} ---\n\n${p.rawText}`)
        .join('\n');

      const combinedBoostedText = pageResults
        .map(p => `\n\n--- Page ${p.pageNumber} ---\n\n${p.boostedText}`)
        .join('\n');

      const allPagesComplete = pageResults.every(p => p.extractionComplete && p.boostComplete);

      logger.info({
        totalPages: conversionResult.totalPages,
        allPagesComplete,
        combinedRawTextLength: combinedRawText.length,
        combinedBoostedTextLength: combinedBoostedText.length
      }, 'Parallel OCR processing completed');

      return {
        pages: pageResults,
        totalPages: conversionResult.totalPages,
        combinedRawText,
        combinedBoostedText,
        allPagesComplete
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        pdfPath
      }, 'Parallel OCR processing failed');
      throw error;
    } finally {
      // Clean up all temporary image files
      logger.info('Cleaning up temporary files');
      await this.pdfConverter.cleanupAll();
    }
  }

  /**
   * Process a PDF file: convert to image, extract text, and apply boost
   * (Single page - kept for backward compatibility)
   */
  async processPDF(pdfPath: string): Promise<OCRResult> {
    logger.info({ pdfPath }, 'Starting OCR processing (single page mode)');

    let imagePath: string | null = null;

    try {
      // Step 1: Convert PDF to image
      logger.info({ pdfPath }, 'Converting PDF to image');
      const conversionResult = await this.pdfConverter.convertToImage(pdfPath, {
        dpi: 300,
        format: 'png',
        quality: 95
      });
      imagePath = conversionResult.imagePath;

      logger.info({
        imagePath,
        mimeType: conversionResult.mimeType,
        sizeKB: Math.round(conversionResult.base64Data.length / 1024)
      }, 'PDF converted to image');

      // Step 2: Extract text from image
      logger.info({ imagePath }, 'Extracting text from image');
      const extractionResult = await this.geminiClient.extractText(
        conversionResult.base64Data,
        conversionResult.mimeType,
        EXTRACT_PROMPT,
        {
          model: this.extractModel,
          temperature: this.extractTemperature,
          maxAttempts: 3
        }
      );

      logger.info({
        textLength: extractionResult.text.length,
        isComplete: extractionResult.isComplete
      }, 'Text extraction completed');

      // Step 3: Apply boost corrections
      logger.info('Applying boost corrections');
      const boostResult = await this.geminiClient.boostText(
        extractionResult.text,
        BOOST_PROMPT,
        {
          model: this.boostModel,
          temperature: this.boostTemperature,
          maxAttempts: 3
        }
      );

      logger.info({
        boostedTextLength: boostResult.boostedText.length,
        isComplete: boostResult.isComplete
      }, 'Boost corrections applied');

      return {
        rawText: extractionResult.text,
        boostedText: boostResult.boostedText,
        extractionComplete: extractionResult.isComplete,
        boostComplete: boostResult.isComplete
      };

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        pdfPath
      }, 'OCR processing failed');
      throw error;
    } finally {
      // Clean up temporary image file
      if (imagePath) {
        await this.pdfConverter.cleanup(imagePath);
      }
    }
  }

  /**
   * Process a PDF from a URL (download first, then process) - parallel mode
   */
  async processPDFFromURLParallel(url: string, downloadPath?: string): Promise<MultiPageOCRResult> {
    const tempPath = downloadPath || path.join(
      this.pdfConverter['tempDir'],
      `download-${Date.now()}.pdf`
    );

    try {
      // Download the PDF
      logger.info({ url, tempPath }, 'Downloading PDF from URL');
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error details');
        throw new Error(`Failed to download PDF: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength === 0) {
        throw new Error('Downloaded PDF is empty (0 bytes)');
      }

      await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

      logger.info({
        url,
        tempPath,
        sizeKB: Math.round(arrayBuffer.byteLength / 1024)
      }, 'PDF downloaded successfully');

      // Process the downloaded PDF in parallel
      const result = await this.processPDFParallel(tempPath);

      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        url
      }, 'Failed to process PDF from URL');
      throw error;
    } finally {
      // Clean up downloaded PDF
      try {
        await fs.unlink(tempPath);
        logger.debug({ tempPath }, 'Cleaned up downloaded PDF');
      } catch (cleanupError) {
        logger.warn({ cleanupError, tempPath }, 'Failed to clean up downloaded PDF');
      }
    }
  }

  /**
   * Process a PDF from a URL (download first, then process) - single page mode
   */
  async processPDFFromURL(url: string, downloadPath?: string): Promise<OCRResult> {
    const tempPath = downloadPath || path.join(
      this.pdfConverter['tempDir'],
      `download-${Date.now()}.pdf`
    );

    try {
      // Download the PDF
      logger.info({ url, tempPath }, 'Downloading PDF from URL');
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error details');
        throw new Error(`Failed to download PDF: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      if (arrayBuffer.byteLength === 0) {
        throw new Error('Downloaded PDF is empty (0 bytes)');
      }

      await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

      logger.info({
        url,
        tempPath,
        sizeKB: Math.round(arrayBuffer.byteLength / 1024)
      }, 'PDF downloaded successfully');

      // Process the downloaded PDF
      const result = await this.processPDF(tempPath);

      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        url
      }, 'Failed to process PDF from URL');
      throw error;
    } finally {
      // Clean up downloaded PDF
      try {
        await fs.unlink(tempPath);
        logger.debug({ tempPath }, 'Cleaned up downloaded PDF');
      } catch (cleanupError) {
        logger.warn({ cleanupError, tempPath }, 'Failed to clean up downloaded PDF');
      }
    }
  }

  /**
   * Process a PDF from base64 data - parallel mode
   */
  async processPDFFromBase64Parallel(base64Data: string): Promise<MultiPageOCRResult> {
    const tempPath = path.join(
      this.pdfConverter['tempDir'],
      `base64-${Date.now()}.pdf`
    );

    try {
      // Write base64 data to temporary file
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(tempPath, buffer);

      logger.info({
        tempPath,
        sizeKB: Math.round(buffer.length / 1024)
      }, 'PDF written from base64 data');

      // Process the PDF in parallel
      const result = await this.processPDFParallel(tempPath);

      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error
      }, 'Failed to process PDF from base64');
      throw error;
    } finally {
      // Clean up temporary PDF
      try {
        await fs.unlink(tempPath);
        logger.debug({ tempPath }, 'Cleaned up temporary PDF');
      } catch (cleanupError) {
        logger.warn({ cleanupError, tempPath }, 'Failed to clean up temporary PDF');
      }
    }
  }

  /**
   * Process a PDF from base64 data - single page mode
   */
  async processPDFFromBase64(base64Data: string): Promise<OCRResult> {
    const tempPath = path.join(
      this.pdfConverter['tempDir'],
      `base64-${Date.now()}.pdf`
    );

    try {
      // Write base64 data to temporary file
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(tempPath, buffer);

      logger.info({
        tempPath,
        sizeKB: Math.round(buffer.length / 1024)
      }, 'PDF written from base64 data');

      // Process the PDF
      const result = await this.processPDF(tempPath);

      return result;

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error
      }, 'Failed to process PDF from base64');
      throw error;
    } finally {
      // Clean up temporary PDF
      try {
        await fs.unlink(tempPath);
        logger.debug({ tempPath }, 'Cleaned up temporary PDF');
      } catch (cleanupError) {
        logger.warn({ cleanupError, tempPath }, 'Failed to clean up temporary PDF');
      }
    }
  }

  /**
   * Clean up all temporary files
   */
  async cleanup(): Promise<void> {
    await this.pdfConverter.cleanupAll();
  }
}


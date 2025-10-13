/**
 * Unified OCR Processor with Automatic Fallback
 * Tries Gemini first, falls back to Claude on failure
 * 
 * Both providers require images, so PDFs are always converted to images first
 */

import { GeminiOCRClient } from './gemini-client';
import { ClaudeOCRClient } from './claude-ocr-client';
import { PDFConverter } from './pdf-converter';
import { OCRLogger } from './ocr-logger';
import { logger } from '../utils/logger';
import { EXTRACT_PROMPT, BOOST_PROMPT } from './prompts';

export interface UnifiedOCRConfig {
  geminiApiKey: string;
  claudeApiKey: string;
  tempDir?: string;
  preferredProvider?: 'gemini' | 'claude';
  extractModel?: {
    gemini?: string;
    claude?: string;
  };
  boostModel?: {
    gemini?: string;
    claude?: string;
  };
  extractTemperature?: number;
  boostTemperature?: number;
}

export interface PageOCRResult {
  pageNumber: number;
  rawText: string;
  boostedText: string;
  provider: 'gemini' | 'claude';
}

export interface MultiPageOCRResult {
  pages: PageOCRResult[];
  totalPages: number;
  combinedRawText: string;
  combinedBoostedText: string;
  provider: 'gemini' | 'claude';
}

export class UnifiedOCRProcessor {
  private geminiClient: GeminiOCRClient;
  private claudeClient: ClaudeOCRClient;
  private pdfConverter: PDFConverter;
  private preferredProvider: 'gemini' | 'claude';

  constructor(config: UnifiedOCRConfig) {
    this.geminiClient = new GeminiOCRClient({
      apiKey: config.geminiApiKey,
      model: config.extractModel?.gemini,
      temperature: config.extractTemperature,
    });

    this.claudeClient = new ClaudeOCRClient({
      apiKey: config.claudeApiKey,
      extractModel: config.extractModel?.claude || 'claude-sonnet-4-5-20250929',
      boostModel: config.boostModel?.claude || 'claude-sonnet-4-5-20250929',
      extractTemperature: config.extractTemperature,
      boostTemperature: config.boostTemperature,
    });

    this.pdfConverter = new PDFConverter(config.tempDir || '/tmp/ocr-temp');

    this.preferredProvider = config.preferredProvider || 'gemini';
  }

  /**
   * Initialize the PDF converter
   */
  async initialize(): Promise<void> {
    await this.pdfConverter.initialize();
  }

  /**
   * Clean up all temporary files
   */
  async cleanup(): Promise<void> {
    await this.pdfConverter.cleanupAll();
  }

  /**
   * Process a PDF with automatic fallback
   * Always converts PDF to images first (required by both Gemini and Claude)
   */
  async processPDFParallel(pdfPath: string): Promise<MultiPageOCRResult> {
    const startTime = Date.now();

    try {
      // Step 1: Convert PDF to images (required for both providers)
      const pageCount = await this.pdfConverter.getPageCount(pdfPath);
      OCRLogger.pdfConversionStart(pageCount);

      const conversionResult = await this.pdfConverter.convertAllPagesToImages(pdfPath, {
        dpi: 300,
        format: 'png',
        quality: 95,
      });

      const totalSizeKB = Math.round(
        conversionResult.pages.reduce((sum, p) => sum + p.base64Data.length, 0) / 1024
      );
      OCRLogger.pdfConverted(conversionResult.totalPages, totalSizeKB);

      // Step 2: Try extraction with preferred provider, fallback on failure
      let extractionResults: Array<{ pageNumber: number; rawText: string; extractionComplete: boolean }>;
      let extractionProvider: 'gemini' | 'claude';

      try {
        if (this.preferredProvider === 'gemini') {
          OCRLogger.info('🔵 Attempting extraction with Gemini (preferred)');
          extractionResults = await this.extractWithGemini(conversionResult.pages);
          extractionProvider = 'gemini';
        } else {
          OCRLogger.info('🟣 Attempting extraction with Claude (preferred)');
          extractionResults = await this.extractWithClaude(conversionResult.pages);
          extractionProvider = 'claude';
        }
      } catch (primaryError) {
        const fallbackProvider = this.preferredProvider === 'gemini' ? 'claude' : 'gemini';
        OCRLogger.warning(`${this.preferredProvider} extraction failed, falling back to ${fallbackProvider}`, {
          'Error': primaryError instanceof Error ? primaryError.message : String(primaryError),
        });

        if (fallbackProvider === 'claude') {
          OCRLogger.info('🟣 Falling back to Claude for extraction');
          extractionResults = await this.extractWithClaude(conversionResult.pages);
          extractionProvider = 'claude';
        } else {
          OCRLogger.info('🔵 Falling back to Gemini for extraction');
          extractionResults = await this.extractWithGemini(conversionResult.pages);
          extractionProvider = 'gemini';
        }
      }

      // Step 3: Combine raw text from all pages
      const combinedRawText = extractionResults
        .map(p => `\n\n--- Page ${p.pageNumber} ---\n\n${p.rawText}`)
        .join('\n');

      OCRLogger.extractionComplete(conversionResult.totalPages, combinedRawText.length);

      // Step 4: Apply boost to combined text with same provider (or fallback)
      let boostResult: any;
      let boostProvider: 'gemini' | 'claude';

      try {
        if (extractionProvider === 'gemini') {
          boostResult = await this.geminiClient.boostText(combinedRawText, BOOST_PROMPT);
          boostProvider = 'gemini';
        } else {
          const claudeResult = await this.claudeClient.boostText(combinedRawText, BOOST_PROMPT);
          boostResult = { boostedText: claudeResult.text };
          boostProvider = 'claude';
        }
      } catch (boostError) {
        const fallbackProvider = extractionProvider === 'gemini' ? 'claude' : 'gemini';
        OCRLogger.warning(`${extractionProvider} boost failed, falling back to ${fallbackProvider}`, {
          'Error': boostError instanceof Error ? boostError.message : String(boostError),
        });

        if (fallbackProvider === 'claude') {
          const claudeResult = await this.claudeClient.boostText(combinedRawText, BOOST_PROMPT);
          boostResult = { boostedText: claudeResult.text };
          boostProvider = 'claude';
        } else {
          boostResult = await this.geminiClient.boostText(combinedRawText, BOOST_PROMPT);
          boostProvider = 'gemini';
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      OCRLogger.boostComplete(boostResult.boostedText.length, duration);

      // Build per-page results
      const pageResults: PageOCRResult[] = extractionResults.map(extraction => ({
        pageNumber: extraction.pageNumber,
        rawText: extraction.rawText,
        boostedText: '', // Individual page boosted text not available in this flow
        provider: extractionProvider,
      }));

      const finalProvider = extractionProvider === boostProvider ? extractionProvider : 'claude';

      OCRLogger.info(`✅ OCR complete using ${finalProvider.toUpperCase()}`);

      return {
        pages: pageResults,
        totalPages: conversionResult.totalPages,
        combinedRawText,
        combinedBoostedText: boostResult.boostedText,
        provider: finalProvider,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, pdfPath }, 'Unified OCR processing failed');
      throw error;
    }
  }

  /**
   * Extract text using Gemini
   */
  private async extractWithGemini(
    pages: Array<{ base64Data: string; mimeType: string; pageNumber?: number }>
  ): Promise<Array<{ pageNumber: number; rawText: string }>> {
    const extractionPromises = pages.map((page, index) =>
      this.geminiClient.extractText(
        page.base64Data,
        page.mimeType,
        EXTRACT_PROMPT
      ).then(result => ({
        pageNumber: index + 1,
        rawText: result.text,
      }))
    );

    return await Promise.all(extractionPromises);
  }

  /**
   * Extract text using Claude
   */
  private async extractWithClaude(
    pages: Array<{ base64Data: string; mimeType: string; pageNumber?: number }>
  ): Promise<Array<{ pageNumber: number; rawText: string }>> {
    const results = await this.claudeClient.extractTextFromImages(
      pages.map((page, index) => ({
        base64Data: page.base64Data,
        mimeType: page.mimeType,
        pageNumber: index + 1,
      })),
      EXTRACT_PROMPT
    );

    return results.map(r => ({
      pageNumber: r.pageNumber,
      rawText: r.text,
    }));
  }
}


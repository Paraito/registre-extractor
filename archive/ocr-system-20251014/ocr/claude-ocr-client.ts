/**
 * Claude OCR Client
 * Handles OCR processing using Claude's vision API
 * Claude only accepts images, so PDFs must be converted to images first
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

export interface ClaudeOCRConfig {
  apiKey: string;
  extractModel?: string;
  boostModel?: string;
  extractTemperature?: number;
  boostTemperature?: number;
}

export interface ClaudeOCRResult {
  text: string;
  isComplete: boolean;
}

export class ClaudeOCRClient {
  private client: Anthropic;
  private extractModel: string;
  private boostModel: string;
  private extractTemperature: number;
  private boostTemperature: number;

  constructor(config: ClaudeOCRConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });

    // Use Claude Sonnet 4.5 for everything (best vision model as of Oct 2025)
    this.extractModel = config.extractModel || 'claude-sonnet-4-5-20250929';
    this.boostModel = config.boostModel || 'claude-sonnet-4-5-20250929';
    this.extractTemperature = config.extractTemperature ?? 0.0;
    this.boostTemperature = config.boostTemperature ?? 0.0;
  }

  /**
   * Extract text from a single image using Claude's vision API
   */
  async extractTextFromImage(
    base64Data: string,
    mimeType: string,
    prompt: string,
    options: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<ClaudeOCRResult> {
    const model = options.model || this.extractModel;
    const temperature = options.temperature ?? this.extractTemperature;
    const maxAttempts = options.maxAttempts || 1;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug({
          model,
          temperature,
          attempt,
          maxAttempts,
          imageSize: base64Data.length
        }, 'Extracting text from image with Claude');

        const message = await this.client.messages.create({
          model,
          max_tokens: 16000, // Claude 4.5 supports up to 64k output tokens
          temperature,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: base64Data,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        });

        // Extract text from response
        const textContent = message.content.find(block => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in Claude response');
        }

        const text = textContent.text;

        // Check if extraction is complete
        const isComplete = message.stop_reason === 'end_turn' || 
                          text.includes('✅ EXTRACTION_COMPLETE') ||
                          text.includes('EXTRACTION_COMPLETE');

        logger.debug({
          textLength: text.length,
          isComplete,
          stopReason: message.stop_reason
        }, 'Claude text extraction completed');

        return {
          text,
          isComplete,
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({
          error: lastError.message,
          attempt,
          maxAttempts,
          model
        }, 'Claude extraction attempt failed');

        if (attempt < maxAttempts) {
          // Wait before retrying (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Claude extraction failed after all attempts');
  }

  /**
   * Apply boost corrections to extracted text using Claude
   */
  async boostText(
    rawText: string,
    prompt: string,
    options: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<ClaudeOCRResult> {
    const model = options.model || this.boostModel;
    const temperature = options.temperature ?? this.boostTemperature;
    const maxAttempts = options.maxAttempts || 1;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug({
          model,
          temperature,
          attempt,
          maxAttempts,
          textLength: rawText.length
        }, 'Applying boost corrections with Claude');

        const message = await this.client.messages.create({
          model,
          max_tokens: 16000,
          temperature,
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\n---\n\nTEXTE BRUT À BOOSTER:\n\n${rawText}`,
            },
          ],
        });

        // Extract text from response
        const textContent = message.content.find(block => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in Claude response');
        }

        const boostedText = textContent.text;

        // Check if boost is complete
        const isComplete = message.stop_reason === 'end_turn' ||
                          boostedText.includes('✅ BOOST_COMPLETE') ||
                          boostedText.includes('BOOST_COMPLETE');

        logger.debug({
          boostedTextLength: boostedText.length,
          isComplete,
          stopReason: message.stop_reason
        }, 'Claude boost completed');

        return {
          text: boostedText,
          isComplete,
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({
          error: lastError.message,
          attempt,
          maxAttempts,
          model
        }, 'Claude boost attempt failed');

        if (attempt < maxAttempts) {
          // Wait before retrying (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Claude boost failed after all attempts');
  }

  /**
   * Process multiple images in parallel
   */
  async extractTextFromImages(
    images: Array<{ base64Data: string; mimeType: string; pageNumber: number }>,
    prompt: string,
    options: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<Array<{ pageNumber: number; text: string; isComplete: boolean }>> {
    logger.info({ imageCount: images.length }, 'Processing multiple images with Claude');

    const results = await Promise.all(
      images.map(async (image) => {
        const result = await this.extractTextFromImage(
          image.base64Data,
          image.mimeType,
          prompt,
          options
        );

        return {
          pageNumber: image.pageNumber,
          text: result.text,
          isComplete: result.isComplete,
        };
      })
    );

    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  }
}


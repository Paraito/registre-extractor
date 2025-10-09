import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';

export interface GeminiOCRConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface OCRExtractionResult {
  text: string;
  isComplete: boolean;
}

export interface OCRBoostResult {
  boostedText: string;
  isComplete: boolean;
}

export class GeminiOCRClient {
  private genAI: GoogleGenerativeAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: GeminiOCRConfig) {
    if (!config.apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }

    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.defaultModel = config.model || 'gemini-2.0-flash-exp';
    this.defaultTemperature = config.temperature || 0.1;
    this.defaultMaxTokens = config.maxOutputTokens || 8192;

    logger.info({
      model: this.defaultModel,
      temperature: this.defaultTemperature,
      maxTokens: this.defaultMaxTokens
    }, 'GeminiOCRClient initialized');
  }

  /**
   * Extract text from an image using Gemini Vision
   */
  async extractText(
    imageData: string,
    mimeType: string,
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxAttempts?: number;
    }
  ): Promise<OCRExtractionResult> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature || this.defaultTemperature;
    const maxAttempts = options?.maxAttempts || 3;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('pro')) {
      maxTokens = 32768; // Pro models support more tokens
    }

    const generativeModel = this.genAI.getGenerativeModel({
      model: model,
      generationConfig: {
        temperature: temperature,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: maxTokens,
      }
    });

    let attemptCount = 0;
    let isComplete = false;
    let accumulatedText = '';

    while (!isComplete && attemptCount < maxAttempts) {
      attemptCount++;

      try {
        const imagePart = {
          inlineData: {
            data: imageData,
            mimeType: mimeType
          }
        };

        let finalPrompt = prompt;
        if (attemptCount > 1) {
          finalPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.`;
        }

        logger.info({
          attempt: attemptCount,
          maxAttempts,
          model,
          temperature
        }, 'Extracting text from image');

        const result = await generativeModel.generateContent([finalPrompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        accumulatedText += text;

        // Check for completion marker
        if (text.includes('✅ EXTRACTION_COMPLETE:')) {
          isComplete = true;
          logger.info({ attempt: attemptCount }, 'Extraction completed successfully');
        } else {
          logger.warn({
            attempt: attemptCount,
            maxAttempts
          }, 'Response truncated, retrying...');
        }

      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : error,
          attempt: attemptCount
        }, 'Error during text extraction');

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
  ): Promise<OCRBoostResult> {
    const model = options?.model || 'gemini-2.5-pro';
    const temperature = options?.temperature || 0.2;
    const maxAttempts = options?.maxAttempts || 3;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('pro')) {
      maxTokens = 32768; // Pro models support more tokens
    }

    const generativeModel = this.genAI.getGenerativeModel({
      model: model,
      generationConfig: {
        temperature: temperature,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: maxTokens,
      }
    });

    let attemptCount = 0;
    let isComplete = false;
    let accumulatedText = '';

    while (!isComplete && attemptCount < maxAttempts) {
      attemptCount++;

      try {
        let fullPrompt = `${prompt}\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;

        if (attemptCount > 1) {
          fullPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;
        }

        logger.info({
          attempt: attemptCount,
          maxAttempts,
          model,
          temperature
        }, 'Boosting OCR text');

        const result = await generativeModel.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        accumulatedText += text;

        // Check for completion marker
        if (text.includes('✅ BOOST_COMPLETE:')) {
          isComplete = true;
          logger.info({ attempt: attemptCount }, 'Boost completed successfully');
        } else {
          logger.warn({
            attempt: attemptCount,
            maxAttempts
          }, 'Response truncated, retrying...');
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
}


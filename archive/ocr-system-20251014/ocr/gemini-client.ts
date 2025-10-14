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
}

export interface OCRBoostResult {
  boostedText: string;
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
    // Use maximum available tokens based on model
    // Gemini 2.0 Flash: 8,192 tokens max
    // Gemini 2.5 Pro: 65,536 tokens max
    this.defaultMaxTokens = config.maxOutputTokens || 8192;

    logger.debug({
      model: this.defaultModel
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
    }
  ): Promise<OCRExtractionResult> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature || this.defaultTemperature;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('2.5') && model.includes('pro')) {
      maxTokens = 65536; // Gemini 2.5 Pro supports up to 65,536 tokens
    } else if (model.includes('pro')) {
      maxTokens = 32768; // Older Pro models support 32,768 tokens
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

    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      }
    };

    const result = await generativeModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    return {
      text
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
    }
  ): Promise<OCRBoostResult> {
    const model = options?.model || 'gemini-2.5-pro';
    const temperature = options?.temperature || 0.2;

    let maxTokens = this.defaultMaxTokens;
    if (model.includes('2.5') && model.includes('pro')) {
      maxTokens = 65536; // Gemini 2.5 Pro supports up to 65,536 tokens
    } else if (model.includes('pro')) {
      maxTokens = 32768; // Older Pro models support 32,768 tokens
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

    const fullPrompt = `${prompt}\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;

    logger.debug({ model }, 'Boosting text...');

    const result = await generativeModel.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    return {
      boostedText: text
    };
  }
}


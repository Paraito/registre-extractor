/**
 * Qwen3-VL Client Module
 * 
 * Handles all interactions with Qwen3-VL via vLLM OpenAI-compatible API.
 */

import { CONFIG } from '../../config/runtime.js';
import { Logger } from '../util/log.js';
import { ExtractedLine } from '../util/json.js';

export class Qwen3Client {
  private apiUrl: string;
  private modelName: string;
  private timeout: number;
  private hfToken?: string;
  private logger: Logger;

  constructor(logger: Logger) {
    this.apiUrl = CONFIG.qwenApiUrl;
    this.modelName = CONFIG.qwenModelName;
    this.timeout = CONFIG.requestTimeoutMs;
    this.hfToken = CONFIG.qwenApiKey;
    this.logger = logger;
  }

  /**
   * Generate content with vision (image + text prompt)
   */
  async generateContent(
    messages: any[], 
    options: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
    } = {}
  ): Promise<{
    response: {
      text: () => string;
      candidates: Array<{
        finishReason: string;
        content: { parts: Array<{ text: string }> };
      }>;
      promptFeedback: { blockReason: null };
    };
  }> {
    const {
      temperature = 0.1,
      maxTokens = 65536,
      topP = 0.95,
      topK = 40,
    } = options;

    // Build request body (OpenAI-compatible format)
    const requestBody = {
      model: this.modelName,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream: false,
    };

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.hfToken) {
      headers['Authorization'] = `Bearer ${this.hfToken}`;
    }

    try {
      // Make request to vLLM API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`vLLM API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      // Extract response in Gemini-compatible format
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('No choices returned from vLLM API');
      }

      const finishReason = this.mapFinishReason(choice.finish_reason);
      const text = choice.message?.content || '';

      return {
        response: {
          text: () => text,
          candidates: [
            {
              finishReason: finishReason,
              content: {
                parts: [{ text: text }]
              }
            }
          ],
          promptFeedback: {
            blockReason: null // vLLM doesn't have safety filters like Gemini
          }
        }
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Map vLLM finish reasons to Gemini format
   */
  private mapFinishReason(vllmReason: string): string {
    const mapping: Record<string, string> = {
      'stop': 'STOP',
      'length': 'MAX_TOKENS',
      'content_filter': 'SAFETY',
      'null': 'UNKNOWN',
    };

    return mapping[vllmReason] || 'UNKNOWN';
  }

  /**
   * Helper: Format image for Qwen3-VL (base64 data URI)
   */
  static formatImageData(base64Data: string, mimeType: string) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`
      }
    };
  }

  /**
   * Helper: Build message array for Qwen3-VL
   */
  static buildMessages(textPrompt: string, imageData?: string, mimeType: string = 'image/png') {
    const content: any[] = [
      { type: 'text', text: textPrompt }
    ];

    if (imageData) {
      content.push(Qwen3Client.formatImageData(imageData, mimeType));
    }

    return [
      {
        role: 'user',
        content: content
      }
    ];
  }

  /**
   * Extract text from a page using Qwen3-VL
   */
  async extractText(
    imageBuffer: Buffer, 
    prompt: string, 
    pageNumber: number
  ): Promise<{ lines: ExtractedLine[], isCompleted: boolean, totalLinesExtracted: number }> {
    return await this.logger.time('qwen3_extract', `Extracting text with Qwen3-VL`, async () => {
      const base64Image = imageBuffer.toString('base64');
      
      // Build messages for Qwen
      const messages = Qwen3Client.buildMessages(prompt, base64Image, 'image/png');

      // Generate content
      const result = await this.generateContent(messages, {
        temperature: 0.1,
        maxTokens: 65536,
      });

      const response = result.response;
      const text = response.text();
      const finishReason = result.response.candidates?.[0]?.finishReason || 'UNKNOWN';

      await this.logger.info('qwen3_extract', `Qwen3 finish reason: ${finishReason}`, {}, pageNumber);

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch (error) {
        // Try to extract JSON from text
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResult = JSON.parse(jsonMatch[0]);
          } catch {
            throw new Error(`Failed to parse Qwen3 extraction response: ${text.substring(0, 200)}...`);
          }
        } else {
          throw new Error(`No JSON found in Qwen3 response: ${text.substring(0, 200)}...`);
        }
      }

      const lines: ExtractedLine[] = (parsedResult.extracted_content || []).map((line: any, index: number) => ({
        index: line.line_index || index + 1,
        party: line.NOMS_DES_PARTIES?.[0]?.value || line.party || '',
        nature: line.NATURE_DE_L_ACTE?.[0]?.value || line.nature || '',
        date: line.ENREGISTREMENT?.Date || line.date || null,
        publicationNo: line.ENREGISTREMENT?.NumeroPublication?.[0]?.value || line.publicationNo || null,
        radiation: line.RADIATION?.numero_depot || line.radiation || null,
        remarks: line.REMARQUES || line.remarks || null,
        confidence: line.confidence || 0.8,
        rawLine: line.raw_line || line.rawLine || ''
      }));

      const result_data = {
        lines,
        isCompleted: parsedResult.is_completed || false,
        totalLinesExtracted: lines.length
      };

      await this.logger.success('qwen3_extract', `Extracted ${lines.length} lines`, {
        isCompleted: result_data.isCompleted,
        finishReason
      }, pageNumber);

      return result_data;
    }, pageNumber);
  }
}

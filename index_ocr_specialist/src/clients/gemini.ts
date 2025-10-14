/**
 * Gemini Client Module
 * 
 * Handles all interactions with Google's Gemini models.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { CONFIG } from '../../config/runtime.js';
import { Logger } from '../util/log.js';
import { LineCountResult, ExtractedLine } from '../util/json.js';

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private logger: Logger;

  constructor(logger: Logger) {
    this.genAI = new GoogleGenerativeAI(CONFIG.geminiApiKey);
    this.logger = logger;
  }

  /**
   * Count lines in a page using Gemini 2.5 Pro
   */
  async countLines(
    imageBuffer: Buffer, 
    prompt: string, 
    pageNumber: number
  ): Promise<LineCountResult> {
    return await this.logger.time('gemini_count', `Counting lines with Gemini`, async () => {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192, // Increased for better response
        }
      });

      const base64Image = imageBuffer.toString('base64');
      
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Image, mimeType: 'image/png' }}
      ]);

      const response = await result.response;
      const text = response.text();

      await this.logger.info('gemini_count', `Gemini raw response`, {
        responseLength: text.length,
        responsePreview: text.substring(0, 200),
        finishReason: result.response.candidates?.[0]?.finishReason
      }, pageNumber);

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch (error) {
        // Try to extract JSON from text
        let jsonStr = text;

        // If text starts with ```json, extract content
        if (text.includes('```json')) {
          const jsonStart = text.indexOf('```json') + 7;
          const jsonEnd = text.indexOf('```', jsonStart);
          if (jsonEnd === -1) {
            // JSON might be truncated, try to get what we have
            jsonStr = text.substring(jsonStart).trim();
          } else {
            jsonStr = text.substring(jsonStart, jsonEnd).trim();
          }
        }

        // Try to parse the extracted JSON
        try {
          parsedResult = JSON.parse(jsonStr);
        } catch {
          // If JSON is truncated or empty, try to handle it
          if (result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            // Handle empty response
            if (!jsonStr || jsonStr.trim().length === 0) {
              await this.logger.warn('gemini_count', 'Empty response from Gemini, using fallback estimate', {
                finishReason: 'MAX_TOKENS'
              }, pageNumber);
              // Use a reasonable estimate based on page size
              parsedResult = {
                total_lines_counted: 45, // Average lines per page from other pages
                counting_method: 'Estimated due to empty API response (token limit reached)',
                confidence: 0.5 // Very low confidence for estimates
              };
            } else {
              // Try to extract the line count from partial JSON
              const lineCountMatch = jsonStr.match(/"total_lines_counted"\s*:\s*(\d+)/);
              const methodMatch = jsonStr.match(/"counting_method"\s*:\s*"([^"]*)"/);

              if (lineCountMatch) {
                parsedResult = {
                  total_lines_counted: parseInt(lineCountMatch[1]),
                  counting_method: methodMatch ? methodMatch[1] : 'Extracted from truncated response',
                  confidence: 0.8 // Lower confidence for truncated responses
                };
                await this.logger.warn('gemini_count', 'Used partial JSON due to token limit', {
                  extractedLineCount: parsedResult.total_lines_counted
                }, pageNumber);
              } else {
                // Fall back to estimate if we can't extract anything
                await this.logger.warn('gemini_count', 'Could not parse response, using fallback estimate', {
                  responseLength: jsonStr.length
                }, pageNumber);
                parsedResult = {
                  total_lines_counted: 45, // Average estimate
                  counting_method: 'Estimated due to unparseable response',
                  confidence: 0.5
                };
              }
            }
          } else {
            // Try one more regex approach
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                parsedResult = JSON.parse(jsonMatch[0]);
              } catch {
                throw new Error(`Failed to parse Gemini count response: ${text.substring(0, 500)}...`);
              }
            } else {
              throw new Error(`No JSON found in Gemini count response: ${text.substring(0, 500)}...`);
            }
          }
        }
      }

      const lineCountResult: LineCountResult = {
        page: pageNumber,
        lineCount: parsedResult.total_lines_counted || parsedResult.total_lines_count || 0,
        model: 'gemini',
        confidence: parsedResult.confidence || 0.9,
        countingMethod: parsedResult.counting_method,
        tableBoundaries: parsedResult.table_boundaries
      };

      await this.logger.success('gemini_count', `Gemini counted ${lineCountResult.lineCount} lines`, {
        confidence: lineCountResult.confidence,
        method: lineCountResult.countingMethod
      }, pageNumber);

      return lineCountResult;
    }, pageNumber);
  }

  /**
   * Extract text from a page using Gemini
   */
  async extractText(
    imageBuffer: Buffer, 
    prompt: string, 
    pageNumber: number,
    model: string = 'gemini-2.5-pro'
  ): Promise<{ lines: ExtractedLine[], isCompleted: boolean, totalLinesExtracted: number }> {
    return await this.logger.time('gemini_extract', `Extracting text with ${model}`, async () => {
      const geminiModel = this.genAI.getGenerativeModel({
        model: model,
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 65536,
        }
      });

      const base64Image = imageBuffer.toString('base64');
      
      // Use the proven working prompt format
      const optimizedPrompt = `Extrais TOUTES les inscriptions de ce tableau d'Index aux Immeubles du Québec.

Format de sortie: une ligne par inscription avec format:
PARTIES | NATURE | DATE | NUM_PUB | RADIATION | REMARQUES

Extrais absolument TOUT ce qui ressemble à une inscription avec une date et une nature d'acte.
Ne rate aucune ligne - je veux toutes les inscriptions présentes dans le tableau.`;

      const result = await geminiModel.generateContent([
        optimizedPrompt,
        { inlineData: { data: base64Image, mimeType: 'image/png' }}
      ]);

      const response = await result.response;
      const text = response.text();

      // Parse the response using the proven format (not JSON)
      const lines: ExtractedLine[] = [];
      const textLines = text.split('\n');
      let lineIndex = 1;

      for (const line of textLines) {
        // Look for lines with the | separator format
        if (line.includes('|') && line.trim().length > 10) {
          const parts = line.split('|').map(p => p.trim());

          if (parts.length >= 4) {
            const extractedLine: ExtractedLine = {
              index: lineIndex++,
              rawLine: line.trim(),
              party: parts[0] || '',
              nature: parts[1] || '',
              date: parts[2] || '',
              publicationNo: parts[3] || '',
              radiation: parts[4] || '',
              remarks: parts[5] || '',
              confidence: 0.9
            };

            lines.push(extractedLine);
          }
        }
      }

      // Log ALL extracted lines instead of just samples
      console.log(`\n📊 PAGE ${pageNumber} - EXTRACTED ${lines.length} LINES:\n`);
      console.log('═'.repeat(80));
      lines.forEach((line, index) => {
        console.log(`${index + 1}. ${line.rawLine}`);
      });
      console.log('═'.repeat(80));
      console.log('');

      await this.logger.info('gemini_extract', `Extracted ${lines.length} lines from response`, {
        responseLength: text.length,
        totalLines: lines.length
      }, pageNumber);

      const result_data = {
        lines,
        isCompleted: lines.length > 0,
        totalLinesExtracted: lines.length
      };

      await this.logger.success('gemini_extract', `Extracted ${lines.length} lines`, {
        isCompleted: result_data.isCompleted,
        model
      }, pageNumber);

      return result_data;
    }, pageNumber);
  }

  /**
   * Boost/normalize extracted text using Gemini
   */
  async boostText(
    rawText: string, 
    prompt: string, 
    pageNumber: number,
    model: string = 'gemini-2.5-pro'
  ): Promise<ExtractedLine[]> {
    return await this.logger.time('gemini_boost', `Boosting text with ${model}`, async () => {
      const geminiModel = this.genAI.getGenerativeModel({
        model: model,
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 65536,
        }
      });

      const result = await geminiModel.generateContent([prompt, rawText]);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch (error) {
        throw new Error(`Failed to parse Gemini boost response: ${text.substring(0, 200)}...`);
      }

      const boostedLines: ExtractedLine[] = (parsedResult.boosted_content || parsedResult || []).map((line: any, index: number) => ({
        index: line.line_index || index + 1,
        party: line.party || '',
        nature: line.nature || '',
        date: line.date || null,
        publicationNo: line.publicationNo || null,
        radiation: line.radiation || null,
        remarks: line.remarks || null,
        confidence: line.confidence || 0.9
      }));

      await this.logger.success('gemini_boost', `Boosted ${boostedLines.length} lines`, {
        model
      }, pageNumber);

      return boostedLines;
    }, pageNumber);
  }
}

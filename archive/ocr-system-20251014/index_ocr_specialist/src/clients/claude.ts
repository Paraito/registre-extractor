/**
 * Claude Client Module
 * 
 * Handles all interactions with Anthropic's Claude models.
 */

import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../../config/runtime.js';
import { Logger } from '../util/log.js';
import { LineCountResult, ExtractedLine, PageExtraction } from '../util/json.js';

export class ClaudeClient {
  private client: Anthropic;
  private logger: Logger;

  constructor(logger: Logger) {
    this.client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    this.logger = logger;
  }

  /**
   * Count lines in a page using Claude Sonnet 4.5
   */
  async countLines(
    imageBuffer: Buffer,
    prompt: string,
    pageNumber: number
  ): Promise<LineCountResult> {
    return await this.logger.time('claude_count', `Counting lines with Claude`, async () => {
      const message = await this.client.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 8192,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBuffer.toString('base64')
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '';

      // Parse JSON response - handle both pure JSON and JSON with extra text
      let parsedResult;
      try {
        // First try to parse as pure JSON
        parsedResult = JSON.parse(text);
      } catch (error) {
        // If that fails, try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            parsedResult = JSON.parse(jsonMatch[0]);
          } catch (innerError) {
            throw new Error(`Failed to parse Claude count response: ${text}`);
          }
        } else {
          throw new Error(`No JSON found in Claude count response: ${text}`);
        }
      }

      const lineCountResult: LineCountResult = {
        page: pageNumber,
        lineCount: parsedResult.total_lines_counted || 0,
        model: 'claude',
        confidence: parsedResult.confidence || 0.9,
        countingMethod: parsedResult.counting_method,
        tableBoundaries: parsedResult.table_boundaries
      };

      await this.logger.success('claude_count', `Claude counted ${lineCountResult.lineCount} lines`, {
        confidence: lineCountResult.confidence,
        method: lineCountResult.countingMethod
      }, pageNumber);

      return lineCountResult;
    }, pageNumber);
  }

  /**
   * Extract text from a page using Claude Sonnet 4.5
   */
  async extractText(
    imageBuffer: Buffer,
    prompt: string,
    pageNumber: number
  ): Promise<{ lines: ExtractedLine[], isCompleted: boolean, totalLinesExtracted: number }> {
    return await this.logger.time('claude_extract', `Extracting text with Claude`, async () => {
      const message = await this.client.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 8192,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBuffer.toString('base64')
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      });

      const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = JSON.parse(jsonMatch[1]);

      return {
        lines: parsed.lines || [],
        isCompleted: parsed.isCompleted || false,
        totalLinesExtracted: parsed.lines?.length || 0
      };
    }, pageNumber);
  }

  /**
   * Verify extraction completeness using Claude Sonnet 4.5
   */
  async verifyExtraction(
    imageBuffer: Buffer, 
    extractedData: PageExtraction,
    prompt: string, 
    pageNumber: number
  ): Promise<{
    status: 'COMPLETE' | 'INCOMPLETE' | 'OVER_EXTRACTED' | 'UNCERTAIN';
    confidence: number;
    recommendation: 'ACCEPT_AS_IS' | 'RETRY_EXTRACTION' | 'MANUAL_REVIEW';
    explanation: string;
    visualCount: number;
    extractedCount: number;
  }> {
    return await this.logger.time('claude_verify', `Verifying extraction with Claude`, async () => {
      // Build summary of extracted data
      const extractedSummary = `Extracted ${extractedData.lines.length} lines.

First 3 lines extracted:
${extractedData.lines.slice(0, 3).map((line, i) =>
  `Line ${i + 1}: ${line.rawLine || 'N/A'}`
).join('\n')}

Last 3 lines extracted:
${extractedData.lines.slice(-3).map((line, i) =>
  `Line ${extractedData.lines.length - 2 + i}: ${line.rawLine || 'N/A'}`
).join('\n')}`;

      const message = await this.client.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 8192,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBuffer.toString('base64')
              }
            },
            {
              type: 'text',
              text: `${prompt}\n\n## EXTRACTED DATA SUMMARY\n\n${extractedSummary}`
            }
          ]
        }]
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch (error) {
        throw new Error(`Failed to parse Claude verification response: ${text}`);
      }

      const verificationResult = {
        status: parsedResult.verification_status || 'UNCERTAIN',
        confidence: parsedResult.confidence || 0.5,
        recommendation: parsedResult.recommendation || 'MANUAL_REVIEW',
        explanation: parsedResult.explanation || 'No explanation provided',
        visualCount: parsedResult.visual_count || 0,
        extractedCount: parsedResult.extracted_count || extractedData.lines.length
      };

      await this.logger.success('claude_verify', `Verification: ${verificationResult.status}`, {
        confidence: verificationResult.confidence,
        recommendation: verificationResult.recommendation,
        visualCount: verificationResult.visualCount,
        extractedCount: verificationResult.extractedCount
      }, pageNumber);

      return verificationResult;
    }, pageNumber);
  }

  /**
   * Boost/normalize extracted text using Claude
   */
  async boostText(
    lines: ExtractedLine[], 
    prompt: string, 
    pageNumber: number
  ): Promise<ExtractedLine[]> {
    return await this.logger.time('claude_boost', `Boosting text with Claude`, async () => {
      // Convert lines to string format for boost prompt
      const rawText = JSON.stringify(lines, null, 2);

      const stream = await this.client.messages.create({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 8192, // Claude's maximum
        temperature: 0.2,
        stream: true,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${prompt}\n\n## RAW EXTRACTED DATA\n\n${rawText}`
            }
          ]
        }]
      });

      // Collect streaming response
      let fullText = '';
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullText += chunk.delta.text;
        }
      }

      const text = fullText;

      // Parse JSON response
      let parsedResult;
      try {
        parsedResult = JSON.parse(text);
      } catch (error) {
        throw new Error(`Failed to parse Claude boost response: ${text.substring(0, 200)}...`);
      }

      const boostedLines: ExtractedLine[] = (parsedResult.boosted_content || parsedResult || []).map((line: any, index: number) => ({
        index: line.index || index + 1,
        party: line.party || '',
        nature: line.nature || '',
        date: line.date || null,
        publicationNo: line.publicationNo || null,
        radiation: line.radiation || null,
        remarks: line.remarks || null,
        confidence: line.confidence || 0.9
      }));

      await this.logger.success('claude_boost', `Boosted ${boostedLines.length} lines`, {
        originalCount: lines.length,
        boostedCount: boostedLines.length
      }, pageNumber);

      return boostedLines;
    }, pageNumber);
  }
}

/**
 * OCR Text Extraction Module
 * 
 * Implements windowed text extraction with support for both Gemini and Qwen3-VL.
 * Handles continuation logic for large documents.
 */

import { Logger } from '../util/log.js';
import { GeminiClient } from '../clients/gemini.js';
import { ClaudeClient } from '../clients/claude.js';
import { ExtractedLine, PageExtraction } from '../util/json.js';
import { UpscaledPage } from './upscale.js';
import { LineCountConsensus } from './ocr_line_count.js';
import { withRetry, processInParallel } from '../util/retry.js';
import { CONFIG } from '../../config/runtime.js';
import { EXTRACTION_CONFIG } from '../../config/rate-limits.js';

export type ExtractionModel = 'gemini' | 'claude' | 'failed';

export interface ExtractionWindow {
  start: number;
  end: number;
  model: ExtractionModel;
  linesExtracted: number;
}

/**
 * Extract text from a single page using windowed approach
 */
export async function extractPageText(
  page: UpscaledPage,
  lineCount: number,
  extractPrompt: string,
  continuePrompt: string,
  model: ExtractionModel,
  logger: Logger
): Promise<PageExtraction> {
  return await logger.time('extract_page', `Extracting text from page ${page.pageNumber}`, async () => {
    const client = model === 'gemini' ? new GeminiClient(logger) : new ClaudeClient(logger);

    // For Gemini, use optimized single-pass extraction (no windowing)
    if (model === 'gemini') {
      await logger.info('extract_page', `Using optimized single-pass extraction`, {
        totalLines: lineCount,
        model: 'gemini'
      }, page.pageNumber);

      const result = await client.extractText(page.content, extractPrompt, page.pageNumber);

      await logger.success('extract_page', `Page extraction complete`, {
        totalLinesDetected: lineCount,
        totalLinesExtracted: result.lines.length,
        completionRate: `${((result.lines.length / lineCount) * 100).toFixed(1)}%`,
        windowsUsed: 1,
        model: 'gemini'
      }, page.pageNumber);

      return {
        page: page.pageNumber,
        lines: result.lines,
        isCompleted: result.isCompleted,
        model: 'gemini',
        windows: [{
          start: 1,
          end: lineCount,
          model: 'gemini',
          linesExtracted: result.lines.length
        }]
      };
    }

    // For Claude, use windowed extraction (original logic)
    let allLines: ExtractedLine[] = [];
    let isCompleted = false;
    let currentWindow = 1;
    const windows: ExtractionWindow[] = [];

    // Calculate extraction windows
    const totalWindows = Math.ceil(lineCount / CONFIG.extractWindow);

    await logger.info('extract_page', `Planning extraction strategy`, {
      totalLines: lineCount,
      windowSize: CONFIG.extractWindow,
      totalWindows,
      model
    }, page.pageNumber);

    for (let windowStart = 1; windowStart <= lineCount; windowStart += CONFIG.extractWindow) {
      const windowEnd = Math.min(windowStart + CONFIG.extractWindow - 1, lineCount);
      const isFirstWindow = windowStart === 1;
      
      await logger.info('extract_page', `Extracting window ${currentWindow}/${totalWindows}`, {
        lines: `${windowStart}-${windowEnd}`,
        isFirstWindow
      }, page.pageNumber);

      let prompt = extractPrompt;
      
      // Use continuation prompt for subsequent windows
      if (!isFirstWindow && continuePrompt) {
        prompt = continuePrompt
          .replace(/\[\[LINES_DONE\]\]/g, (windowStart - 1).toString())
          .replace(/\[\[TOTAL_LINES\]\]/g, lineCount.toString())
          .replace(/\[\[NEXT_LINE\]\]/g, windowStart.toString());
      }

      try {
        // Primary extraction with retry logic
        const result = await withRetry(
          () => client.extractText(page.content, prompt, page.pageNumber),
          logger,
          `extract_window_${currentWindow}`,
          {
            maxAttempts: 3,
            baseDelayMs: 2000,
            maxDelayMs: 10000,
            retryableErrors: ['503', '429', 'timeout', 'deadline', 'service unavailable']
          }
        ) as { lines: ExtractedLine[], isCompleted: boolean, totalLinesExtracted: number };
        
        // Filter lines for this window (in case model returns more)
        const windowLines = result.lines.filter(line =>
          line.index >= windowStart && line.index <= windowEnd
        );

        // Validate extraction - if we detected lines but got 0, that's suspicious
        const expectedLines = windowEnd - windowStart + 1;
        if (windowLines.length === 0 && expectedLines > 0) {
          await logger.warn('extract_page', `Zero lines extracted despite detecting ${expectedLines} lines`, {
            window: `${windowStart}-${windowEnd}`,
            model,
            rawResponseLength: JSON.stringify(result).length
          }, page.pageNumber);

          // Log raw response for debugging
          await logger.info('extract_page', `Raw extraction response for debugging`, {
            rawResponse: JSON.stringify(result, null, 2).substring(0, 1000)
          }, page.pageNumber);
        }

        allLines.push(...windowLines);
        
        windows.push({
          start: windowStart,
          end: windowEnd,
          model,
          linesExtracted: windowLines.length
        });

        await logger.success('extract_page', `Window ${currentWindow} extracted ${windowLines.length} lines`, {
          expectedLines: windowEnd - windowStart + 1,
          actualLines: windowLines.length,
          isCompleted: result.isCompleted
        }, page.pageNumber);

        // Check if extraction is complete
        if (result.isCompleted || windowEnd >= lineCount) {
          isCompleted = true;
          break;
        }

        currentWindow++;

        // Rate limiting delay between windows
        if (windowEnd < lineCount) {
          await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenRequests));
        }

      } catch (error) {
        await logger.error('extract_page', `Window ${currentWindow} primary extraction failed`, error as Error, {
          window: `${windowStart}-${windowEnd}`,
          model
        }, page.pageNumber);

        // Try fallback model if primary failed (only for Claude, Gemini already returned)
        let fallbackResult = null;
        if (model === 'claude') {
          try {
            await logger.info('extract_page', `Trying Claude fallback for window ${currentWindow}`, {}, page.pageNumber);
            const claudeClient = new ClaudeClient(logger);
            fallbackResult = await withRetry(
              () => claudeClient.extractText(page.content, prompt, page.pageNumber),
              logger,
              `extract_fallback_${currentWindow}`,
              {
                maxAttempts: 2,
                baseDelayMs: 1000,
                maxDelayMs: 5000
              }
            ) as { lines: ExtractedLine[], isCompleted: boolean, totalLinesExtracted: number };

            const windowLines = fallbackResult.lines.filter(line =>
              line.index >= windowStart && line.index <= windowEnd
            );

            allLines.push(...windowLines);
            await logger.success('extract_page', `Claude fallback succeeded for window ${currentWindow}`, {
              linesExtracted: windowLines.length
            }, page.pageNumber);

            windows.push({
              start: windowStart,
              end: windowEnd,
              model: 'claude',
              linesExtracted: windowLines.length
            });

          } catch (fallbackError) {
            await logger.error('extract_page', `Claude fallback also failed for window ${currentWindow}`, fallbackError as Error, {}, page.pageNumber);

            windows.push({
              start: windowStart,
              end: windowEnd,
              model: 'failed',
              linesExtracted: 0
            });
          }
        } else {
          // No fallback for Claude, just record failure
          windows.push({
            start: windowStart,
            end: windowEnd,
            model,
            linesExtracted: 0
          });
        }

        currentWindow++;
      }
    }

    // Sort lines by index and remove duplicates
    allLines.sort((a, b) => a.index - b.index);
    const uniqueLines = allLines.filter((line, index, arr) => 
      index === 0 || line.index !== arr[index - 1].index
    );

    const pageExtraction: PageExtraction = {
      page: page.pageNumber,
      lines: uniqueLines,
      isCompleted,
      totalLinesDetected: lineCount,
      extractionWindows: windows
    };

    await logger.success('extract_page', `Page extraction complete`, {
      totalLinesDetected: lineCount,
      totalLinesExtracted: uniqueLines.length,
      completionRate: `${((uniqueLines.length / lineCount) * 100).toFixed(1)}%`,
      windowsUsed: windows.length,
      model
    }, page.pageNumber);

    return pageExtraction;
  }, page.pageNumber);
}

/**
 * Extract text from multiple pages (PARALLEL - Tier 3 optimized)
 */
export async function extractPagesText(
  pages: UpscaledPage[],
  lineCounts: LineCountConsensus[],
  extractPrompt: string,
  continuePrompt: string,
  model: ExtractionModel,
  logger: Logger
): Promise<PageExtraction[]> {
  return await logger.time('extract_all_pages', `Extracting text from ${pages.length} pages (parallel)`, async () => {

    const processor = async (page: UpscaledPage, index: number): Promise<PageExtraction> => {
      const lineCountData = lineCounts.find(lc => lc.page === page.pageNumber);
      if (!lineCountData) {
        await logger.error('extract_all_pages', `No line count data for page ${page.pageNumber}`, undefined, {}, page.pageNumber);
        throw new Error(`No line count data for page ${page.pageNumber}`);
      }

      return await extractPageText(
        page,
        lineCountData.finalCount,
        extractPrompt,
        continuePrompt,
        model,
        logger
      );
    };

    // Use parallel processing with Tier 3 optimized settings
    // Gemini 2.5 Pro: 2,000 RPM, 8M TPM
    // Safe concurrency: 6 pages, 2s stagger = ~3 RPS (180 RPM, well under 2000)
    const results = await processInParallel(
      pages,
      processor,
      logger,
      'text_extraction',
      {
        maxConcurrency: EXTRACTION_CONFIG.maxConcurrency, // 6 concurrent pages
        apiDelayMs: EXTRACTION_CONFIG.apiDelayMs,         // 2 second stagger
        retryOptions: {
          maxAttempts: 3,
          baseDelayMs: 5000,
          maxDelayMs: 30000,
          retryableErrors: ['503', '429', 'timeout', 'deadline', 'service unavailable']
        }
      }
    );

    // Log summary statistics
    const totalLinesDetected = results.reduce((sum, r) => sum + (r.totalLinesDetected || 0), 0);
    const totalLinesExtracted = results.reduce((sum, r) => sum + r.lines.length, 0);
    const avgCompletionRate = results.reduce((sum, r) =>
      sum + (r.lines.length / (r.totalLinesDetected || 1)), 0) / results.length * 100;

    await logger.success('extract_all_pages', `Text extraction complete (parallel)`, {
      totalPages: results.length,
      totalLinesDetected,
      totalLinesExtracted,
      avgCompletionRate: `${avgCompletionRate.toFixed(1)}%`,
      model,
      pagesCompleted: results.filter(r => r.isCompleted).length,
      concurrency: EXTRACTION_CONFIG.maxConcurrency,
      staggerMs: EXTRACTION_CONFIG.apiDelayMs
    });

    return results;
  });
}

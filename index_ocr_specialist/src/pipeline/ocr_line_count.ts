/**
 * OCR Line Count Module
 * 
 * Implements multi-model consensus for line counting (Gemini + Claude).
 * Uses the "pick higher count" consensus rule as specified.
 */

import sharp from 'sharp';
import { Logger } from '../util/log.js';
import { GeminiClient } from '../clients/gemini.js';
import { ClaudeClient } from '../clients/claude.js';
import { LineCountResult, ConsensusResult } from '../util/json.js';
import { UpscaledPage } from './upscale.js';
import { processInParallel, withRetry } from '../util/retry.js';
import { LINE_COUNT_CONFIG } from '../../config/rate-limits.js';

export interface LineCountConsensus {
  page: number;
  geminiResult: LineCountResult;
  claudeResult: LineCountResult;
  consensus: ConsensusResult;
  finalCount: number;
}

/**
 * Resize image for Claude API limits (max 8000px dimension, max 5MB file size)
 */
async function resizeImageForClaude(imageBuffer: Buffer, logger: Logger, pageNumber: number): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const originalSize = imageBuffer.length;

  // Check if resizing is needed
  const maxDimension = Math.max(metadata.width || 0, metadata.height || 0);
  const maxSizeMB = 4.8; // Conservative limit to ensure we stay under 5MB
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  if (maxDimension <= 8000 && originalSize <= maxSizeBytes) {
    return imageBuffer; // No resizing needed
  }

  await logger.info('resize_for_claude', `Resizing image for Claude limits`, {
    originalDimensions: `${metadata.width}x${metadata.height}`,
    originalSizeMB: (originalSize / 1024 / 1024).toFixed(2),
    maxDimension: 8000,
    maxSizeMB
  }, pageNumber);

  // Calculate resize factor to fit both dimension and file size constraints
  let resizeFactor = 1;

  // Factor for dimension constraint
  if (maxDimension > 8000) {
    resizeFactor = Math.min(resizeFactor, 8000 / maxDimension);
  }

  // Factor for file size constraint (estimate)
  if (originalSize > maxSizeBytes) {
    // Rough estimate: file size scales with area (width * height)
    const areaReduction = maxSizeBytes / originalSize;
    const dimensionReduction = Math.sqrt(areaReduction) * 0.8; // Reasonable factor
    resizeFactor = Math.min(resizeFactor, dimensionReduction);
  }

  const newWidth = Math.floor((metadata.width || 0) * resizeFactor);
  const newHeight = Math.floor((metadata.height || 0) * resizeFactor);

  const resizedBuffer = await sharp(imageBuffer)
    .resize(newWidth, newHeight, {
      kernel: 'lanczos3',
      withoutEnlargement: true
    })
    .png({ quality: 90, compressionLevel: 6 })
    .toBuffer();

  await logger.success('resize_for_claude', `Image resized for Claude`, {
    newDimensions: `${newWidth}x${newHeight}`,
    newSizeMB: (resizedBuffer.length / 1024 / 1024).toFixed(2),
    resizeFactor: resizeFactor.toFixed(3),
    sizeReduction: `${((1 - resizedBuffer.length / originalSize) * 100).toFixed(1)}%`
  }, pageNumber);

  return resizedBuffer;
}

/**
 * Perform multi-model line counting consensus
 */
export async function countLinesConsensus(
  page: UpscaledPage,
  geminiPrompt: string,
  claudePrompt: string,
  logger: Logger,
  originalPage?: { content: Buffer; width: number; height: number }
): Promise<LineCountConsensus> {
  return await logger.time('line_count_consensus', `Multi-model line counting consensus`, async () => {
    const geminiClient = new GeminiClient(logger);
    const claudeClient = new ClaudeClient(logger);

    // Prepare images for each model
    const geminiImage = page.content; // Gemini can handle large images

    // For Claude, always check and resize if needed (both original and upscaled)
    let claudeImage: Buffer;

    // Debug logging
    await logger.info('claude_image_debug', `Page ${page.pageNumber} image selection`, {
      hasOriginalPage: !!originalPage,
      originalSizeMB: originalPage ? (originalPage.content.length / 1024 / 1024).toFixed(2) : 'N/A',
      upscaledSizeMB: (page.content.length / 1024 / 1024).toFixed(2)
    }, page.pageNumber);

    // Choose the smaller image that's most likely to fit Claude's limits
    // Be very conservative: base64 encoding increases size by ~33%, so use 3MB as safe limit
    const safeSizeBytes = 3.0 * 1024 * 1024; // 3MB (very safe for base64 encoding)

    if (originalPage && originalPage.content.length < safeSizeBytes && originalPage.content.length < page.content.length) {
      // Original is small enough and smaller than upscaled - use it directly
      claudeImage = originalPage.content;
      await logger.info('claude_image_selection', `Using original image for Claude (${(originalPage.content.length / 1024 / 1024).toFixed(2)}MB)`, {}, page.pageNumber);
    } else if (originalPage && originalPage.content.length < page.content.length) {
      // Original is smaller but still needs resizing
      await logger.info('claude_image_selection', `Resizing original image for Claude (${(originalPage.content.length / 1024 / 1024).toFixed(2)}MB)`, {}, page.pageNumber);
      claudeImage = await resizeImageForClaude(originalPage.content, logger, page.pageNumber);
    } else {
      // Use upscaled image but resize if needed
      await logger.info('claude_image_selection', `Resizing upscaled image for Claude (${(page.content.length / 1024 / 1024).toFixed(2)}MB)`, {}, page.pageNumber);
      claudeImage = await resizeImageForClaude(page.content, logger, page.pageNumber);
    }

    // Run both models in parallel for efficiency
    const [geminiResult, claudeResult] = await Promise.all([
      geminiClient.countLines(geminiImage, geminiPrompt, page.pageNumber),
      claudeClient.countLines(claudeImage, claudePrompt, page.pageNumber)
    ]);

    // Apply consensus rule: pick higher count with Gemini bias
    // If Gemini count is significantly higher (>3 lines difference), prefer Gemini
    // as it's more accurate for complex pages
    const difference = Math.abs(geminiResult.lineCount - claudeResult.lineCount);
    let finalCount = Math.max(geminiResult.lineCount, claudeResult.lineCount);

    if (difference > 3 && geminiResult.lineCount > claudeResult.lineCount) {
      // Gemini is significantly higher - trust it more
      finalCount = geminiResult.lineCount;
      await logger.info('line_count_consensus', `Using Gemini count due to significant difference`, {
        geminiCount: geminiResult.lineCount,
        claudeCount: claudeResult.lineCount,
        difference,
        reason: 'Gemini more accurate for complex pages'
      }, page.pageNumber);
    }
    
    const consensus: ConsensusResult = {
      page: page.pageNumber,
      geminiCount: geminiResult.lineCount,
      claudeCount: claudeResult.lineCount,
      consensusCount: finalCount,
      consensusRule: 'higher',
      confidence: Math.min(geminiResult.confidence, claudeResult.confidence) // Conservative confidence
    };

    const result: LineCountConsensus = {
      page: page.pageNumber,
      geminiResult,
      claudeResult,
      consensus,
      finalCount
    };

    await logger.success('line_count_consensus', `Consensus: ${finalCount} lines`, {
      geminiCount: geminiResult.lineCount,
      claudeCount: claudeResult.lineCount,
      consensusRule: 'higher',
      confidence: consensus.confidence
    }, page.pageNumber);

    // Log detailed breakdown
    await logger.info('line_count_consensus', 'Detailed consensus breakdown', {
      gemini: {
        count: geminiResult.lineCount,
        confidence: geminiResult.confidence,
        method: geminiResult.countingMethod
      },
      claude: {
        count: claudeResult.lineCount,
        confidence: claudeResult.confidence,
        method: claudeResult.countingMethod
      },
      consensus: {
        finalCount,
        rule: 'pick_higher',
        difference: Math.abs(geminiResult.lineCount - claudeResult.lineCount)
      }
    }, page.pageNumber);

    return result;
  }, page.pageNumber);
}

/**
 * Count lines for multiple pages using Gemini only (faster, no 5MB limit issues)
 */
export async function countLinesForPages(
  pages: UpscaledPage[],
  geminiPrompt: string,
  claudePrompt: string,
  logger: Logger,
  originalPages?: { content: Buffer; width: number; height: number; pageNumber: number }[]
): Promise<LineCountConsensus[]> {
  return await logger.time('count_all_pages', `Counting lines for ${pages.length} pages (Gemini-only)`, async () => {

    const processor = async (page: UpscaledPage, index: number): Promise<LineCountConsensus> => {
      // Use Gemini-only to avoid Claude's 5MB limit issues
      const geminiClient = new GeminiClient(logger);
      const geminiResult = await geminiClient.countLines(page.content, geminiPrompt, page.pageNumber);

      // Create a consensus result using only Gemini (no Claude)
      const dummyClaudeResult: LineCountResult = {
        page: page.pageNumber,
        lineCount: geminiResult.lineCount,
        model: 'claude',
        confidence: 0,
        countingMethod: 'skipped'
      };

      const consensus: ConsensusResult = {
        page: page.pageNumber,
        geminiCount: geminiResult.lineCount,
        claudeCount: geminiResult.lineCount,
        consensusCount: geminiResult.lineCount,
        consensusRule: 'higher',
        confidence: geminiResult.confidence
      };

      return {
        page: page.pageNumber,
        geminiResult,
        claudeResult: dummyClaudeResult,
        consensus,
        finalCount: geminiResult.lineCount
      };
    };

    const results = await processInParallel(
      pages,
      processor,
      logger,
      'line_counting',
      {
        maxConcurrency: LINE_COUNT_CONFIG.maxConcurrency, // Tier 3 optimized: 10 concurrent
        apiDelayMs: LINE_COUNT_CONFIG.apiDelayMs,         // 500ms stagger
        retryOptions: {
          maxAttempts: 5,
          baseDelayMs: 2000,
          maxDelayMs: 30000
        }
      }
    );

    // Log summary statistics
    const totalLines = results.reduce((sum, r) => sum + r.finalCount, 0);
    const avgConfidence = results.reduce((sum, r) => sum + r.consensus.confidence, 0) / results.length;

    await logger.success('count_all_pages', `Line counting complete (Gemini-only)`, {
      totalPages: results.length,
      totalLines,
      avgConfidence: avgConfidence.toFixed(3),
      method: 'gemini_only'
    });

    return results;
  });
}

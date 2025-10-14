/**
 * Main Pipeline Orchestration
 * 
 * Coordinates the complete E2E OCR pipeline with all stages.
 */

import { Logger } from '../util/log.js';
import { fetchPDF } from '../pipeline/fetch.js';
import { pdfToImages, savePageImages } from '../pipeline/pdf_to_images.js';
// Removed upscaling - using original images for better performance
import { countLinesForPages } from '../pipeline/ocr_line_count.js';
import { extractPagesText } from '../pipeline/ocr_extract.js';
import { checkPagesCoherence } from '../pipeline/ocr_check.js';
import { boostPagesExtraction } from '../pipeline/boost.js';
import { mergePageExtractions, MergeResult } from '../pipeline/merge.js';

// Import prompts
import {
  GEMINI_EXTRACT_PROMPT,
  GEMINI_CONTINUE_PROMPT,
  GEMINI_BOOST_PROMPT
} from '../../prompts/prompts-unified.js';
import {
  COUNT_PROMPT_GEMINI,
  COUNT_PROMPT_CLAUDE,
  VERIFICATION_PROMPT_CLAUDE
} from '../../prompts/prompts-multi-model.js';

export interface PipelineOptions {
  url: string;
  extractionModel: 'gemini'; // Gemini primary with Claude fallback
  runId: string;
  tolerancePercent?: number;
  skipBoost?: boolean;
  skipCoherence?: boolean;
  logger: Logger;
}

/**
 * Run the complete E2E OCR pipeline
 */
export async function runE2EPipeline(options: PipelineOptions): Promise<MergeResult> {
  const {
    url,
    extractionModel,
    runId,
    tolerancePercent = 5.0,
    skipBoost = false,
    skipCoherence = false,
    logger
  } = options;

  return await logger.time('e2e_pipeline', 'Running complete E2E OCR pipeline', async () => {
    await logger.info('e2e_pipeline', 'Pipeline configuration', {
      url: url.substring(0, 100) + '...',
      extractionModel,
      runId,
      tolerancePercent,
      skipBoost,
      skipCoherence
    });

    // Stage 1: Fetch PDF
    const pdfResult = await fetchPDF(url, logger);

    // Stage 2: Convert PDF to images
    const imageResult = await pdfToImages(pdfResult.buffer, logger);
    await savePageImages(imageResult.pages, logger, runId, 'original');

    // Stage 3: Use original images (no upscaling - saves memory and prevents size issues)
    const originalPages = imageResult.pages.map(p => ({
      pageNumber: p.pageNumber,
      content: p.content,
      width: p.width,
      height: p.height,
      originalWidth: p.width,
      originalHeight: p.height,
      upscaledWidth: p.width,
      upscaledHeight: p.height,
      upscaleFactor: 1
    }));

    // Stage 4: Multi-model line count consensus
    const lineCounts = await countLinesForPages(
      originalPages,
      COUNT_PROMPT_GEMINI,
      COUNT_PROMPT_CLAUDE,
      logger,
      originalPages
    );

    // Stage 5: Text extraction with windowed approach (Gemini 2.5 Pro only)
    const extractions = await extractPagesText(
      originalPages,
      lineCounts,
      GEMINI_EXTRACT_PROMPT,
      GEMINI_CONTINUE_PROMPT,
      'gemini',
      logger
    );

    // Stage 6: Coherence checking (optional)
    let coherenceResults;
    if (!skipCoherence) {
      coherenceResults = await checkPagesCoherence(
        originalPages,
        extractions,
        VERIFICATION_PROMPT_CLAUDE,
        logger,
        tolerancePercent
      );
    }

    // Stage 7: Boost processing (optional)
    let boostResults;
    if (!skipBoost) {
      boostResults = await boostPagesExtraction(
        extractions,
        GEMINI_BOOST_PROMPT, // TODO: Switch to Claude boost prompt
        logger
      );
    }

    // Stage 8: Merge and save artifacts
    const mergeResult = await mergePageExtractions(
      extractions,
      url,
      runId,
      logger,
      lineCounts,
      coherenceResults,
      boostResults
    );

    await logger.success('e2e_pipeline', 'Pipeline completed successfully', {
      totalPages: mergeResult.document.totalPages,
      totalLines: mergeResult.document.totalLines,
      processingTimeMs: mergeResult.document.processingTimeMs,
      artifactsDir: `artifacts/${runId}`,
      models: mergeResult.document.models
    });

    return mergeResult;
  });
}

/**
 * Run E2E pipeline for Gemini model
 */
export async function runGeminiPipeline(
  url: string,
  runId?: string,
  logger?: Logger
): Promise<MergeResult> {
  const actualRunId = runId || `gemini-${Date.now()}`;
  const actualLogger = logger || (await import('../util/log.js')).createLogger(actualRunId);
  
  if (!logger) {
    await actualLogger.init();
  }

  return runE2EPipeline({
    url,
    extractionModel: 'gemini',
    runId: actualRunId,
    tolerancePercent: 5.0,
    skipBoost: true,  // Skip boost to avoid parsing errors
    skipCoherence: true,  // Skip coherence check to avoid Claude 5MB limit issues
    logger: actualLogger
  });
}

/**
 * Run E2E pipeline for Qwen3 model
 */
export async function runQwen3Pipeline(
  url: string,
  runId?: string,
  logger?: Logger
): Promise<MergeResult> {
  const actualRunId = runId || `qwen3-${Date.now()}`;
  const actualLogger = logger || (await import('../util/log.js')).createLogger(actualRunId);
  
  if (!logger) {
    await actualLogger.init();
  }

  return runE2EPipeline({
    url,
    extractionModel: 'gemini',
    runId: actualRunId,
    tolerancePercent: 5.0,
    skipBoost: false,
    skipCoherence: false,
    logger: actualLogger
  });
}

/**
 * Compare Gemini vs Qwen3 on the same document
 */
export async function comparePipelines(
  url: string,
  baseRunId?: string
): Promise<{
  geminiResult: MergeResult;
  qwen3Result: MergeResult;
  comparison: {
    geminiLines: number;
    qwen3Lines: number;
    difference: number;
    geminiTime: number;
    qwen3Time: number;
  };
}> {
  const timestamp = Date.now();
  const geminiRunId = baseRunId ? `${baseRunId}-gemini` : `compare-gemini-${timestamp}`;
  const qwen3RunId = baseRunId ? `${baseRunId}-qwen3` : `compare-qwen3-${timestamp}`;

  const geminiLogger = (await import('../util/log.js')).createLogger(geminiRunId);
  const qwen3Logger = (await import('../util/log.js')).createLogger(qwen3RunId);

  await geminiLogger.init();
  await qwen3Logger.init();

  await geminiLogger.info('comparison', 'Starting Gemini vs Qwen3 comparison', { url });

  // Run both pipelines
  const [geminiResult, qwen3Result] = await Promise.all([
    runGeminiPipeline(url, geminiRunId, geminiLogger),
    runQwen3Pipeline(url, qwen3RunId, qwen3Logger)
  ]);

  const comparison = {
    geminiLines: geminiResult.document.totalLines,
    qwen3Lines: qwen3Result.document.totalLines,
    difference: Math.abs(geminiResult.document.totalLines - qwen3Result.document.totalLines),
    geminiTime: geminiResult.document.processingTimeMs,
    qwen3Time: qwen3Result.document.processingTimeMs
  };

  await geminiLogger.success('comparison', 'Pipeline comparison complete', comparison);

  return {
    geminiResult,
    qwen3Result,
    comparison
  };
}

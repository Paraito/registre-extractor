/**
 * OCR Coherence Check Module
 * 
 * Uses Claude Sonnet 4.5 to validate extraction completeness and coherence
 * with ~5% tolerance for minor OCR inconsistencies.
 */

import sharp from 'sharp';
import { Logger } from '../util/log.js';
import { ClaudeClient } from '../clients/claude.js';
import { PageExtraction } from '../util/json.js';
import { UpscaledPage } from './upscale.js';

export interface CoherenceCheckResult {
  page: number;
  status: 'COMPLETE' | 'INCOMPLETE' | 'OVER_EXTRACTED' | 'UNCERTAIN';
  confidence: number;
  recommendation: 'ACCEPT_AS_IS' | 'RETRY_EXTRACTION' | 'MANUAL_REVIEW';
  explanation: string;
  visualCount: number;
  extractedCount: number;
  missingLines: string[];
  extraLines: string[];
  toleranceCheck: {
    withinTolerance: boolean;
    deviationPercent: number;
    tolerancePercent: number;
  };
}

/**
 * Resize image for Claude API limits (reused from ocr_line_count.ts)
 */
async function resizeImageForClaude(imageBuffer: Buffer, logger: Logger, pageNumber: number): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const originalSize = imageBuffer.length;

  // Check if resizing is needed
  const maxDimension = Math.max(metadata.width || 0, metadata.height || 0);
  const maxSizeMB = 5;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  if (maxDimension <= 8000 && originalSize <= maxSizeBytes) {
    return imageBuffer; // No resizing needed
  }

  // Calculate resize factor to fit both dimension and file size constraints
  let resizeFactor = 1;

  // Factor for dimension constraint
  if (maxDimension > 8000) {
    resizeFactor = Math.min(resizeFactor, 8000 / maxDimension);
  }

  // Factor for file size constraint (estimate)
  if (originalSize > maxSizeBytes) {
    const areaReduction = maxSizeBytes / originalSize;
    const dimensionReduction = Math.sqrt(areaReduction) * 0.8; // Conservative factor
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

  return resizedBuffer;
}

/**
 * Check extraction coherence using Claude Sonnet 4.5
 */
export async function checkExtractionCoherence(
  page: UpscaledPage,
  extraction: PageExtraction,
  verificationPrompt: string,
  logger: Logger,
  tolerancePercent: number = 5.0
): Promise<CoherenceCheckResult> {
  return await logger.time('coherence_check', `Checking extraction coherence`, async () => {
    const claudeClient = new ClaudeClient(logger);

    // Resize image for Claude if needed
    const claudeImage = await resizeImageForClaude(page.content, logger, page.pageNumber);

    const verificationResult = await claudeClient.verifyExtraction(
      claudeImage,
      extraction,
      verificationPrompt,
      page.pageNumber
    );

    // Calculate tolerance check
    const expectedCount = extraction.totalLinesDetected || 0;
    const actualCount = extraction.lines.length;
    const deviationPercent = expectedCount > 0 ? 
      Math.abs(actualCount - expectedCount) / expectedCount * 100 : 0;
    const withinTolerance = deviationPercent <= tolerancePercent;

    const coherenceResult: CoherenceCheckResult = {
      page: page.pageNumber,
      status: verificationResult.status,
      confidence: verificationResult.confidence,
      recommendation: verificationResult.recommendation,
      explanation: verificationResult.explanation,
      visualCount: verificationResult.visualCount,
      extractedCount: verificationResult.extractedCount,
      missingLines: [], // Would be populated by Claude's detailed analysis
      extraLines: [],   // Would be populated by Claude's detailed analysis
      toleranceCheck: {
        withinTolerance,
        deviationPercent,
        tolerancePercent
      }
    };

    // Override recommendation based on tolerance check
    if (!withinTolerance && coherenceResult.recommendation === 'ACCEPT_AS_IS') {
      coherenceResult.recommendation = 'RETRY_EXTRACTION';
      coherenceResult.explanation += ` Deviation of ${deviationPercent.toFixed(1)}% exceeds tolerance of ${tolerancePercent}%.`;
    }

    await logger.success('coherence_check', `Coherence check: ${coherenceResult.status}`, {
      confidence: coherenceResult.confidence,
      recommendation: coherenceResult.recommendation,
      visualCount: coherenceResult.visualCount,
      extractedCount: coherenceResult.extractedCount,
      deviationPercent: deviationPercent.toFixed(1),
      withinTolerance
    }, page.pageNumber);

    // Log detailed explanation
    if (coherenceResult.explanation) {
      await logger.info('coherence_check', 'Claude verification explanation', {
        explanation: coherenceResult.explanation
      }, page.pageNumber);
    }

    return coherenceResult;
  }, page.pageNumber);
}

/**
 * Check coherence for multiple pages
 */
export async function checkPagesCoherence(
  pages: UpscaledPage[],
  extractions: PageExtraction[],
  verificationPrompt: string,
  logger: Logger,
  tolerancePercent: number = 5.0
): Promise<CoherenceCheckResult[]> {
  return await logger.time('check_all_coherence', `Checking coherence for ${pages.length} pages`, async () => {
    const results: CoherenceCheckResult[] = [];

    for (const page of pages) {
      const extraction = extractions.find(e => e.page === page.pageNumber);
      if (!extraction) {
        await logger.error('check_all_coherence', `No extraction data for page ${page.pageNumber}`, undefined, {}, page.pageNumber);
        continue;
      }

      const coherenceResult = await checkExtractionCoherence(
        page,
        extraction,
        verificationPrompt,
        logger,
        tolerancePercent
      );

      results.push(coherenceResult);

      // Add coherence check to extraction
      extraction.coherenceCheck = {
        status: coherenceResult.status,
        confidence: coherenceResult.confidence,
        recommendation: coherenceResult.recommendation,
        explanation: coherenceResult.explanation
      };

      // Brief delay between pages
      if (pages.indexOf(page) < pages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Log summary statistics
    const statusCounts = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const withinToleranceCount = results.filter(r => r.toleranceCheck.withinTolerance).length;
    const needsRetryCount = results.filter(r => r.recommendation === 'RETRY_EXTRACTION').length;

    await logger.success('check_all_coherence', `Coherence checking complete`, {
      totalPages: results.length,
      statusBreakdown: statusCounts,
      avgConfidence: avgConfidence.toFixed(3),
      withinTolerance: `${withinToleranceCount}/${results.length}`,
      needsRetry: needsRetryCount,
      tolerancePercent
    });

    return results;
  });
}

/**
 * Filter pages that need retry based on coherence check
 */
export function getPagesNeedingRetry(coherenceResults: CoherenceCheckResult[]): number[] {
  return coherenceResults
    .filter(result => result.recommendation === 'RETRY_EXTRACTION')
    .map(result => result.page);
}

/**
 * Get overall coherence assessment
 */
export function getOverallCoherenceAssessment(coherenceResults: CoherenceCheckResult[]): {
  overallStatus: 'PASS' | 'PARTIAL' | 'FAIL';
  passRate: number;
  avgConfidence: number;
  summary: string;
} {
  const passCount = coherenceResults.filter(r => 
    r.status === 'COMPLETE' && r.recommendation === 'ACCEPT_AS_IS'
  ).length;
  
  const passRate = passCount / coherenceResults.length;
  const avgConfidence = coherenceResults.reduce((sum, r) => sum + r.confidence, 0) / coherenceResults.length;
  
  let overallStatus: 'PASS' | 'PARTIAL' | 'FAIL';
  let summary: string;
  
  if (passRate >= 0.9) {
    overallStatus = 'PASS';
    summary = `Excellent coherence: ${passCount}/${coherenceResults.length} pages passed validation`;
  } else if (passRate >= 0.7) {
    overallStatus = 'PARTIAL';
    summary = `Acceptable coherence: ${passCount}/${coherenceResults.length} pages passed validation`;
  } else {
    overallStatus = 'FAIL';
    summary = `Poor coherence: Only ${passCount}/${coherenceResults.length} pages passed validation`;
  }
  
  return {
    overallStatus,
    passRate,
    avgConfidence,
    summary
  };
}

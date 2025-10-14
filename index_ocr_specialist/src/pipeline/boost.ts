/**
 * Boost Module
 * 
 * Applies confidence scoring and field normalization using Claude Sonnet 4.5.
 * Enhances extracted data with improved confidence scores and normalized fields.
 */

import { Logger } from '../util/log.js';
import { ClaudeClient } from '../clients/claude.js';
import { ExtractedLine, PageExtraction } from '../util/json.js';
import { processInParallel } from '../util/retry.js';
import { BOOST_CONFIG } from '../../config/rate-limits.js';

export interface BoostResult {
  page: number;
  originalLines: ExtractedLine[];
  boostedLines: ExtractedLine[];
  improvements: {
    confidenceAdjustments: number;
    fieldNormalizations: number;
    dataCorrections: number;
  };
  avgConfidenceChange: number;
}

/**
 * Boost a single page's extracted data
 */
export async function boostPageExtraction(
  extraction: PageExtraction,
  boostPrompt: string,
  logger: Logger
): Promise<BoostResult> {
  return await logger.time('boost_page', `Boosting page ${extraction.page} data`, async () => {
    const claudeClient = new ClaudeClient(logger);

    const originalLines = [...extraction.lines];
    
    await logger.info('boost_page', `Starting boost process`, {
      originalLineCount: originalLines.length,
      avgOriginalConfidence: originalLines.reduce((sum, l) => sum + (l.confidence || 0), 0) / originalLines.length
    }, extraction.page);

    const boostedLines = await claudeClient.boostText(
      originalLines,
      boostPrompt,
      extraction.page
    );

    // Calculate improvements
    const improvements = calculateImprovements(originalLines, boostedLines);
    const avgConfidenceChange = calculateAvgConfidenceChange(originalLines, boostedLines);

    // Update extraction with boosted data
    extraction.lines = boostedLines;

    const result: BoostResult = {
      page: extraction.page,
      originalLines,
      boostedLines,
      improvements,
      avgConfidenceChange
    };

    await logger.success('boost_page', `Boost complete`, {
      boostedLineCount: boostedLines.length,
      avgBoostedConfidence: boostedLines.reduce((sum, l) => sum + (l.confidence || 0), 0) / boostedLines.length,
      confidenceChange: avgConfidenceChange > 0 ? `+${avgConfidenceChange.toFixed(3)}` : avgConfidenceChange.toFixed(3),
      improvements: improvements
    }, extraction.page);

    return result;
  }, extraction.page);
}

/**
 * Boost multiple pages' extracted data (PARALLEL - Tier 3 optimized)
 */
export async function boostPagesExtraction(
  extractions: PageExtraction[],
  boostPrompt: string,
  logger: Logger
): Promise<BoostResult[]> {
  return await logger.time('boost_all_pages', `Boosting ${extractions.length} pages (parallel)`, async () => {

    const processor = async (extraction: PageExtraction, index: number): Promise<BoostResult> => {
      return await boostPageExtraction(extraction, boostPrompt, logger);
    };

    // Use parallel processing with Tier 3 optimized settings
    // Claude Sonnet 3.5: 4,000 RPM, 2M ITPM, 400K OTPM
    // OTPM is the bottleneck: 400K / 5K = 80 pages/minute max
    // Safe concurrency: 5 pages, 1s stagger = ~5 RPS (300 RPM, well under 4000)
    const results = await processInParallel(
      extractions,
      processor,
      logger,
      'boost_processing',
      {
        maxConcurrency: BOOST_CONFIG.maxConcurrency, // 5 concurrent pages
        apiDelayMs: BOOST_CONFIG.apiDelayMs,         // 1 second stagger
        retryOptions: {
          maxAttempts: 3,
          baseDelayMs: 5000,
          maxDelayMs: 30000,
          retryableErrors: ['503', '429', 'timeout', 'overloaded']
        }
      }
    );

    // Log summary statistics
    const totalOriginalLines = results.reduce((sum, r) => sum + r.originalLines.length, 0);
    const totalBoostedLines = results.reduce((sum, r) => sum + r.boostedLines.length, 0);
    const avgConfidenceChange = results.reduce((sum, r) => sum + r.avgConfidenceChange, 0) / results.length;

    const totalImprovements = results.reduce((acc, r) => ({
      confidenceAdjustments: acc.confidenceAdjustments + r.improvements.confidenceAdjustments,
      fieldNormalizations: acc.fieldNormalizations + r.improvements.fieldNormalizations,
      dataCorrections: acc.dataCorrections + r.improvements.dataCorrections
    }), { confidenceAdjustments: 0, fieldNormalizations: 0, dataCorrections: 0 });

    await logger.success('boost_all_pages', `Boost processing complete (parallel)`, {
      totalPages: results.length,
      totalOriginalLines,
      totalBoostedLines,
      avgConfidenceChange: avgConfidenceChange > 0 ? `+${avgConfidenceChange.toFixed(3)}` : avgConfidenceChange.toFixed(3),
      totalImprovements,
      concurrency: BOOST_CONFIG.maxConcurrency,
      staggerMs: BOOST_CONFIG.apiDelayMs
    });

    return results;
  });
}

/**
 * Calculate improvements between original and boosted lines
 */
function calculateImprovements(
  originalLines: ExtractedLine[], 
  boostedLines: ExtractedLine[]
): {
  confidenceAdjustments: number;
  fieldNormalizations: number;
  dataCorrections: number;
} {
  let confidenceAdjustments = 0;
  let fieldNormalizations = 0;
  let dataCorrections = 0;

  for (let i = 0; i < Math.min(originalLines.length, boostedLines.length); i++) {
    const original = originalLines[i];
    const boosted = boostedLines[i];

    // Count confidence adjustments
    if (Math.abs((original.confidence || 0) - (boosted.confidence || 0)) > 0.01) {
      confidenceAdjustments++;
    }

    // Count field normalizations (basic heuristic)
    const originalFields = [original.party, original.nature, original.date, original.publicationNo, original.radiation, original.remarks];
    const boostedFields = [boosted.party, boosted.nature, boosted.date, boosted.publicationNo, boosted.radiation, boosted.remarks];
    
    for (let j = 0; j < originalFields.length; j++) {
      const origField = originalFields[j] || '';
      const boostField = boostedFields[j] || '';
      
      // Check for normalization (length change, case change, etc.)
      if (origField !== boostField && origField.toLowerCase().trim() === boostField.toLowerCase().trim()) {
        fieldNormalizations++;
      }
      // Check for data corrections (content change)
      else if (origField !== boostField && origField.toLowerCase().trim() !== boostField.toLowerCase().trim()) {
        dataCorrections++;
      }
    }
  }

  return {
    confidenceAdjustments,
    fieldNormalizations,
    dataCorrections
  };
}

/**
 * Calculate average confidence change
 */
function calculateAvgConfidenceChange(
  originalLines: ExtractedLine[], 
  boostedLines: ExtractedLine[]
): number {
  if (originalLines.length === 0 || boostedLines.length === 0) {
    return 0;
  }

  const originalAvg = originalLines.reduce((sum, l) => sum + (l.confidence || 0), 0) / originalLines.length;
  const boostedAvg = boostedLines.reduce((sum, l) => sum + (l.confidence || 0), 0) / boostedLines.length;

  return boostedAvg - originalAvg;
}

/**
 * Get boost summary statistics
 */
export function getBoostSummary(boostResults: BoostResult[]): {
  totalPages: number;
  totalLinesProcessed: number;
  avgConfidenceImprovement: number;
  totalImprovements: {
    confidenceAdjustments: number;
    fieldNormalizations: number;
    dataCorrections: number;
  };
  pagesWithImprovements: number;
} {
  const totalPages = boostResults.length;
  const totalLinesProcessed = boostResults.reduce((sum, r) => sum + r.boostedLines.length, 0);
  const avgConfidenceImprovement = boostResults.reduce((sum, r) => sum + r.avgConfidenceChange, 0) / totalPages;
  
  const totalImprovements = boostResults.reduce((acc, r) => ({
    confidenceAdjustments: acc.confidenceAdjustments + r.improvements.confidenceAdjustments,
    fieldNormalizations: acc.fieldNormalizations + r.improvements.fieldNormalizations,
    dataCorrections: acc.dataCorrections + r.improvements.dataCorrections
  }), { confidenceAdjustments: 0, fieldNormalizations: 0, dataCorrections: 0 });

  const pagesWithImprovements = boostResults.filter(r => 
    r.improvements.confidenceAdjustments > 0 || 
    r.improvements.fieldNormalizations > 0 || 
    r.improvements.dataCorrections > 0
  ).length;

  return {
    totalPages,
    totalLinesProcessed,
    avgConfidenceImprovement,
    totalImprovements,
    pagesWithImprovements
  };
}

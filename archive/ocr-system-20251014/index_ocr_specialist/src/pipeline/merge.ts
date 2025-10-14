/**
 * Merge Module
 * 
 * Merges per-page results into final document extraction and manages artifacts.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '../util/log.js';
import { DocumentExtraction, PageExtraction } from '../util/json.js';
import { CONFIG } from '../../config/runtime.js';
import { LineCountConsensus } from './ocr_line_count.js';
import { CoherenceCheckResult } from './ocr_check.js';
import { BoostResult } from './boost.js';

export interface MergeResult {
  document: DocumentExtraction;
  artifactPaths: {
    documentJson: string;
    pagesJson: string[];
    summaryReport: string;
  };
}

/**
 * Merge page extractions into final document
 */
export async function mergePageExtractions(
  pageExtractions: PageExtraction[],
  sourceUrl: string,
  runId: string,
  logger: Logger,
  lineCounts?: LineCountConsensus[],
  coherenceResults?: CoherenceCheckResult[],
  boostResults?: BoostResult[]
): Promise<MergeResult> {
  return await logger.time('merge_document', 'Merging page extractions into document', async () => {
    const startTime = Date.now();
    
    // Create document extraction
    const document: DocumentExtraction = {
      pages: pageExtractions,
      sourceUrl,
      createdAt: new Date().toISOString(),
      runId,
      totalPages: pageExtractions.length,
      totalLines: pageExtractions.reduce((sum, page) => sum + page.lines.length, 0),
      processingTimeMs: Date.now() - startTime,
      models: {
        lineCount: ['gemini', 'claude'],
        extraction: pageExtractions[0]?.extractionWindows?.[0]?.model === 'claude' ? 'claude' : 'gemini',
        coherenceCheck: 'claude',
        boost: 'claude'
      }
    };

    await logger.info('merge_document', 'Document structure created', {
      totalPages: document.totalPages,
      totalLines: document.totalLines,
      models: document.models
    });

    // Save artifacts
    const artifactPaths = await saveArtifacts(
      document, 
      runId, 
      logger,
      lineCounts,
      coherenceResults,
      boostResults
    );

    await logger.success('merge_document', 'Document merge complete', {
      totalPages: document.totalPages,
      totalLines: document.totalLines,
      artifactsDir: `${CONFIG.artifactsDir}/${runId}`
    });

    return {
      document,
      artifactPaths
    };
  });
}

/**
 * Save all artifacts to disk
 */
async function saveArtifacts(
  document: DocumentExtraction,
  runId: string,
  logger: Logger,
  lineCounts?: LineCountConsensus[],
  coherenceResults?: CoherenceCheckResult[],
  boostResults?: BoostResult[]
): Promise<{
  documentJson: string;
  pagesJson: string[];
  summaryReport: string;
}> {
  const artifactsDir = `${CONFIG.artifactsDir}/${runId}`;
  const jsonDir = `${artifactsDir}/json`;
  
  // Create directories
  if (!existsSync(jsonDir)) {
    await mkdir(jsonDir, { recursive: true });
  }

  // Save complete document JSON
  const documentPath = `${jsonDir}/document.json`;
  await writeFile(documentPath, JSON.stringify(document, null, 2));
  await logger.info('save_artifacts', `Saved document JSON`, { path: documentPath });

  // Save individual page JSONs
  const pagePaths: string[] = [];
  for (const page of document.pages) {
    const pagePath = `${jsonDir}/page_${page.page}.json`;
    await writeFile(pagePath, JSON.stringify(page, null, 2));
    pagePaths.push(pagePath);
  }
  await logger.info('save_artifacts', `Saved ${pagePaths.length} page JSONs`, { dir: jsonDir });

  // Generate and save summary report
  const summaryReport = generateSummaryReport(
    document, 
    runId,
    lineCounts,
    coherenceResults,
    boostResults
  );
  const reportPath = `${CONFIG.reportsDir}/e2e-summary-${runId}.md`;
  
  if (!existsSync(CONFIG.reportsDir)) {
    await mkdir(CONFIG.reportsDir, { recursive: true });
  }
  
  await writeFile(reportPath, summaryReport);
  await logger.info('save_artifacts', `Saved summary report`, { path: reportPath });

  return {
    documentJson: documentPath,
    pagesJson: pagePaths,
    summaryReport: reportPath
  };
}

/**
 * Generate summary report in markdown format
 */
function generateSummaryReport(
  document: DocumentExtraction,
  runId: string,
  lineCounts?: LineCountConsensus[],
  coherenceResults?: CoherenceCheckResult[],
  boostResults?: BoostResult[]
): string {
  const timestamp = new Date().toISOString();
  
  let report = `# OCR Pipeline Summary Report

**Run ID**: ${runId}  
**Generated**: ${timestamp}  
**Source**: ${document.sourceUrl}  

## Overview

- **Total Pages**: ${document.totalPages}
- **Total Lines Extracted**: ${document.totalLines}
- **Processing Time**: ${(document.processingTimeMs / 1000).toFixed(2)}s
- **Models Used**: 
  - Line Count: ${document.models.lineCount.join(' + ')}
  - Extraction: ${document.models.extraction}
  - Coherence Check: ${document.models.coherenceCheck}
  - Boost: ${document.models.boost}

## Per-Page Results

| Page | Lines Detected | Lines Extracted | Completion | Coherence | Status |
|------|----------------|-----------------|------------|-----------|--------|
`;

  for (const page of document.pages) {
    const lineCount = lineCounts?.find(lc => lc.page === page.page);
    const coherence = coherenceResults?.find(cr => cr.page === page.page);
    
    const linesDetected = page.totalLinesDetected || lineCount?.finalCount || 'N/A';
    const linesExtracted = page.lines.length;
    const completion = page.isCompleted ? '✅' : '⚠️';
    const coherenceStatus = coherence ? coherence.status : 'N/A';
    const coherenceIcon = coherence?.status === 'COMPLETE' ? '✅' : 
                         coherence?.status === 'INCOMPLETE' ? '⚠️' : 
                         coherence?.status === 'OVER_EXTRACTED' ? '❌' : '❓';
    
    report += `| ${page.page} | ${linesDetected} | ${linesExtracted} | ${completion} | ${coherenceIcon} ${coherenceStatus} | ${page.isCompleted ? 'Complete' : 'Partial'} |\n`;
  }

  // Line Count Consensus Section
  if (lineCounts && lineCounts.length > 0) {
    report += `\n## Line Count Consensus\n\n`;
    report += `| Page | Gemini Count | Claude Count | Consensus | Difference |\n`;
    report += `|------|--------------|--------------|-----------|------------|\n`;
    
    for (const lc of lineCounts) {
      const diff = Math.abs(lc.geminiResult.lineCount - lc.claudeResult.lineCount);
      report += `| ${lc.page} | ${lc.geminiResult.lineCount} | ${lc.claudeResult.lineCount} | ${lc.finalCount} | ${diff} |\n`;
    }
  }

  // Coherence Check Section
  if (coherenceResults && coherenceResults.length > 0) {
    report += `\n## Coherence Check Results\n\n`;
    const statusCounts = coherenceResults.reduce((acc, cr) => {
      acc[cr.status] = (acc[cr.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    report += `**Status Breakdown**:\n`;
    for (const [status, count] of Object.entries(statusCounts)) {
      report += `- ${status}: ${count} pages\n`;
    }
    
    const avgConfidence = coherenceResults.reduce((sum, cr) => sum + cr.confidence, 0) / coherenceResults.length;
    report += `\n**Average Confidence**: ${(avgConfidence * 100).toFixed(1)}%\n`;
  }

  // Boost Results Section
  if (boostResults && boostResults.length > 0) {
    report += `\n## Boost Processing Results\n\n`;
    const totalImprovements = boostResults.reduce((acc, br) => ({
      confidenceAdjustments: acc.confidenceAdjustments + br.improvements.confidenceAdjustments,
      fieldNormalizations: acc.fieldNormalizations + br.improvements.fieldNormalizations,
      dataCorrections: acc.dataCorrections + br.improvements.dataCorrections
    }), { confidenceAdjustments: 0, fieldNormalizations: 0, dataCorrections: 0 });
    
    const avgConfidenceChange = boostResults.reduce((sum, br) => sum + br.avgConfidenceChange, 0) / boostResults.length;
    
    report += `**Improvements Applied**:\n`;
    report += `- Confidence Adjustments: ${totalImprovements.confidenceAdjustments}\n`;
    report += `- Field Normalizations: ${totalImprovements.fieldNormalizations}\n`;
    report += `- Data Corrections: ${totalImprovements.dataCorrections}\n`;
    report += `\n**Average Confidence Change**: ${avgConfidenceChange > 0 ? '+' : ''}${(avgConfidenceChange * 100).toFixed(2)}%\n`;
  }

  // Warnings and Recommendations
  report += `\n## Warnings and Recommendations\n\n`;
  
  const incompletePages = document.pages.filter(p => !p.isCompleted);
  if (incompletePages.length > 0) {
    report += `⚠️ **Incomplete Extractions**: ${incompletePages.length} pages may have incomplete data\n`;
  }
  
  const lowConfidencePages = coherenceResults?.filter(cr => cr.confidence < 0.8) || [];
  if (lowConfidencePages.length > 0) {
    report += `⚠️ **Low Confidence**: ${lowConfidencePages.length} pages have coherence confidence < 80%\n`;
  }
  
  const retryPages = coherenceResults?.filter(cr => cr.recommendation === 'RETRY_EXTRACTION') || [];
  if (retryPages.length > 0) {
    report += `❌ **Retry Recommended**: ${retryPages.length} pages should be re-extracted\n`;
  }
  
  if (incompletePages.length === 0 && lowConfidencePages.length === 0 && retryPages.length === 0) {
    report += `✅ **All checks passed** - No issues detected\n`;
  }

  report += `\n## Artifacts\n\n`;
  report += `- Document JSON: \`artifacts/${runId}/json/document.json\`\n`;
  report += `- Page JSONs: \`artifacts/${runId}/json/page_*.json\`\n`;
  report += `- Images: \`artifacts/${runId}/images/\`\n`;
  report += `- Upscaled Images: \`artifacts/${runId}/upscaled/\`\n`;
  report += `- Logs: \`logs/${runId}.ndjson\`\n`;

  return report;
}

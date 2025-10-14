#!/usr/bin/env tsx
/**
 * Extract Page 3 Content - Focused Test Script
 * 
 * This script specifically extracts and boosts text from page 3 using both Gemini and Qwen3.
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { upscalePages } from '../src/pipeline/upscale.js';
import { countLinesConsensus } from '../src/pipeline/ocr_line_count.js';
import { extractPageText } from '../src/pipeline/ocr_extract.js';
import { boostPageExtraction } from '../src/pipeline/boost.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Import prompts
import { 
  GEMINI_EXTRACT_PROMPT, 
  GEMINI_CONTINUE_PROMPT, 
  GEMINI_BOOST_PROMPT,
  QWEN_EXTRACT_PROMPT,
  QWEN_CONTINUE_PROMPT,
  QWEN_BOOST_PROMPT
} from '../prompts/prompts-unified.js';
import { 
  COUNT_PROMPT_GEMINI, 
  COUNT_PROMPT_CLAUDE
} from '../prompts/prompts-multi-model.js';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const runId = `page3-extract-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    await logger.info('page3_extract', 'Starting Page 3 extraction test', {
      url: testUrl.substring(0, 100) + '...',
      runId
    });
    
    // Stage 1: Fetch PDF
    const pdfResult = await fetchPDF(testUrl, logger);
    
    // Stage 2: Convert PDF to images
    const imageResult = await pdfToImages(pdfResult.buffer, logger);
    
    // Stage 3: Upscale images
    const upscaledPages = await upscalePages(imageResult.pages, logger);
    
    // Find page 3
    const page3Upscaled = upscaledPages.find(p => p.pageNumber === 3);
    const page3Original = imageResult.pages.find(p => p.pageNumber === 3);
    
    if (!page3Upscaled || !page3Original) {
      throw new Error('Page 3 not found in PDF');
    }
    
    await logger.info('page3_extract', 'Found page 3', {
      originalDimensions: `${page3Original.width}x${page3Original.height}`,
      upscaledDimensions: `${page3Upscaled.width}x${page3Upscaled.height}`,
      originalSizeKB: (page3Original.content.length / 1024).toFixed(2),
      upscaledSizeKB: (page3Upscaled.content.length / 1024).toFixed(2)
    });
    
    // Stage 4: Line count consensus for page 3
    const lineCountConsensus = await countLinesConsensus(
      page3Upscaled,
      COUNT_PROMPT_GEMINI,
      COUNT_PROMPT_CLAUDE,
      logger,
      { content: page3Original.content, width: page3Original.width, height: page3Original.height }
    );
    
    await logger.success('page3_extract', `Page 3 line count consensus: ${lineCountConsensus.finalCount} lines`, {
      geminiCount: lineCountConsensus.geminiResult.lineCount,
      claudeCount: lineCountConsensus.claudeResult.lineCount,
      consensusCount: lineCountConsensus.finalCount
    });
    
    // Stage 5: Extract text with Gemini
    await logger.info('page3_extract', 'Extracting text with Gemini...');
    const geminiExtraction = await extractPageText(
      page3Upscaled,
      lineCountConsensus.finalCount,
      GEMINI_EXTRACT_PROMPT,
      GEMINI_CONTINUE_PROMPT,
      'gemini',
      logger
    );
    
    // Stage 6: Extract text with Qwen3
    await logger.info('page3_extract', 'Extracting text with Qwen3...');
    const qwen3Extraction = await extractPageText(
      page3Upscaled,
      lineCountConsensus.finalCount,
      QWEN_EXTRACT_PROMPT,
      QWEN_CONTINUE_PROMPT,
      'qwen3',
      logger
    );
    
    // Stage 7: Boost Gemini extraction
    await logger.info('page3_extract', 'Boosting Gemini extraction...');
    const geminiBoostResult = await boostPageExtraction(
      geminiExtraction,
      GEMINI_BOOST_PROMPT,
      logger
    );
    
    // Stage 8: Boost Qwen3 extraction
    await logger.info('page3_extract', 'Boosting Qwen3 extraction...');
    const qwen3BoostResult = await boostPageExtraction(
      qwen3Extraction,
      QWEN_BOOST_PROMPT,
      logger
    );
    
    // Stage 9: Save results to files
    const outputDir = `./results/${runId}`;
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    
    // Save Gemini results
    const geminiOriginalFile = `${outputDir}/page3-gemini-original.json`;
    const geminiBoostedFile = `${outputDir}/page3-gemini-boosted.json`;
    
    await writeFile(geminiOriginalFile, JSON.stringify({
      page: 3,
      model: 'gemini',
      lineCount: lineCountConsensus.finalCount,
      extractedLines: geminiBoostResult.originalLines.length,
      extraction: geminiExtraction,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    await writeFile(geminiBoostedFile, JSON.stringify({
      page: 3,
      model: 'gemini',
      lineCount: lineCountConsensus.finalCount,
      boostedLines: geminiBoostResult.boostedLines.length,
      extraction: {
        ...geminiExtraction,
        lines: geminiBoostResult.boostedLines
      },
      boostResult: geminiBoostResult,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Save Qwen3 results
    const qwen3OriginalFile = `${outputDir}/page3-qwen3-original.json`;
    const qwen3BoostedFile = `${outputDir}/page3-qwen3-boosted.json`;
    
    await writeFile(qwen3OriginalFile, JSON.stringify({
      page: 3,
      model: 'qwen3',
      lineCount: lineCountConsensus.finalCount,
      extractedLines: qwen3BoostResult.originalLines.length,
      extraction: qwen3Extraction,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    await writeFile(qwen3BoostedFile, JSON.stringify({
      page: 3,
      model: 'qwen3',
      lineCount: lineCountConsensus.finalCount,
      boostedLines: qwen3BoostResult.boostedLines.length,
      extraction: {
        ...qwen3Extraction,
        lines: qwen3BoostResult.boostedLines
      },
      boostResult: qwen3BoostResult,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Create summary report
    const summaryFile = `${outputDir}/page3-summary.md`;
    const summary = `# Page 3 Extraction Results

**Run ID**: ${runId}  
**Generated**: ${new Date().toISOString()}  
**Source**: ${testUrl}  

## Line Count Consensus

- **Gemini Count**: ${lineCountConsensus.geminiResult.lineCount}
- **Claude Count**: ${lineCountConsensus.claudeResult.lineCount}
- **Final Consensus**: ${lineCountConsensus.finalCount} lines

## Extraction Results

### Gemini
- **Original Lines Extracted**: ${geminiBoostResult.originalLines.length}
- **Boosted Lines**: ${geminiBoostResult.boostedLines.length}
- **Completion Status**: ${geminiExtraction.isCompleted ? 'Complete' : 'Partial'}
- **Extraction Windows**: ${geminiExtraction.extractionWindows?.length || 0}

### Qwen3
- **Original Lines Extracted**: ${qwen3BoostResult.originalLines.length}
- **Boosted Lines**: ${qwen3BoostResult.boostedLines.length}
- **Completion Status**: ${qwen3Extraction.isCompleted ? 'Complete' : 'Partial'}
- **Extraction Windows**: ${qwen3Extraction.extractionWindows?.length || 0}

## Boost Improvements

### Gemini Boost
- **Confidence Adjustments**: ${geminiBoostResult.improvements.confidenceAdjustments}
- **Field Normalizations**: ${geminiBoostResult.improvements.fieldNormalizations}
- **Data Corrections**: ${geminiBoostResult.improvements.dataCorrections}
- **Avg Confidence Change**: ${geminiBoostResult.avgConfidenceChange > 0 ? '+' : ''}${(geminiBoostResult.avgConfidenceChange * 100).toFixed(2)}%

### Qwen3 Boost
- **Confidence Adjustments**: ${qwen3BoostResult.improvements.confidenceAdjustments}
- **Field Normalizations**: ${qwen3BoostResult.improvements.fieldNormalizations}
- **Data Corrections**: ${qwen3BoostResult.improvements.dataCorrections}
- **Avg Confidence Change**: ${qwen3BoostResult.avgConfidenceChange > 0 ? '+' : ''}${(qwen3BoostResult.avgConfidenceChange * 100).toFixed(2)}%

## Files Generated

- \`page3-gemini-original.json\` - Original Gemini extraction
- \`page3-gemini-boosted.json\` - Boosted Gemini extraction
- \`page3-qwen3-original.json\` - Original Qwen3 extraction
- \`page3-qwen3-boosted.json\` - Boosted Qwen3 extraction
- \`page3-summary.md\` - This summary report
`;
    
    await writeFile(summaryFile, summary);
    
    await logger.success('page3_extract', 'Page 3 extraction complete!', {
      outputDir,
      geminiLines: geminiBoostResult.boostedLines.length,
      qwen3Lines: qwen3BoostResult.boostedLines.length,
      filesGenerated: 5
    });
    
    console.log('\n🎉 Page 3 extraction completed successfully!');
    console.log(`📁 Results saved to: ${outputDir}`);
    console.log(`📋 Summary: ${summaryFile}`);
    console.log(`📊 Gemini extracted ${geminiBoostResult.boostedLines.length} lines`);
    console.log(`📊 Qwen3 extracted ${qwen3BoostResult.boostedLines.length} lines`);
    console.log(`📝 Logs: ${logger.getLogFile()}`);
    
  } catch (error) {
    console.error('❌ Page 3 extraction failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

// Run the script
main();

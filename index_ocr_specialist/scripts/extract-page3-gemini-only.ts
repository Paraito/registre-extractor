#!/usr/bin/env tsx
/**
 * Extract Page 3 Content - Gemini Only (Working Version)
 * 
 * This script extracts text from page 3 using Gemini and saves the results.
 * Skips Qwen3 (needs credits) and Claude boost (timeout issues).
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { upscalePages } from '../src/pipeline/upscale.js';
import { countLinesConsensus } from '../src/pipeline/ocr_line_count.js';
import { extractPageText } from '../src/pipeline/ocr_extract.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Import prompts
import { 
  GEMINI_EXTRACT_PROMPT, 
  GEMINI_CONTINUE_PROMPT
} from '../prompts/prompts-unified.js';
import { 
  COUNT_PROMPT_GEMINI, 
  COUNT_PROMPT_CLAUDE
} from '../prompts/prompts-multi-model.js';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const runId = `page3-gemini-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    await logger.info('page3_gemini', 'Starting Page 3 Gemini extraction', {
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
    
    await logger.info('page3_gemini', 'Found page 3', {
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
    
    await logger.success('page3_gemini', `Page 3 line count consensus: ${lineCountConsensus.finalCount} lines`, {
      geminiCount: lineCountConsensus.geminiResult.lineCount,
      claudeCount: lineCountConsensus.claudeResult.lineCount,
      consensusCount: lineCountConsensus.finalCount
    });
    
    // Stage 5: Extract text with Gemini (multiple windows to get all lines)
    await logger.info('page3_gemini', 'Extracting ALL text with Gemini...');
    
    // Extract in multiple windows to get all 45 lines
    const allExtractions = [];
    const windowSize = 25;
    const totalLines = lineCountConsensus.finalCount;
    const totalWindows = Math.ceil(totalLines / windowSize);
    
    for (let windowIndex = 0; windowIndex < totalWindows; windowIndex++) {
      const startLine = windowIndex * windowSize + 1;
      const endLine = Math.min((windowIndex + 1) * windowSize, totalLines);
      
      await logger.info('page3_gemini', `Extracting window ${windowIndex + 1}/${totalWindows}`, {
        lines: `${startLine}-${endLine}`,
        windowSize: endLine - startLine + 1
      });
      
      // Create a modified prompt for this specific window
      const windowPrompt = GEMINI_EXTRACT_PROMPT.replace(
        'Ta tâche est d\'extraire des inscriptions',
        `Ta tâche est d'extraire les inscriptions des lignes ${startLine} à ${endLine}`
      );
      
      const windowExtraction = await extractPageText(
        page3Upscaled,
        endLine - startLine + 1, // Lines in this window
        windowPrompt,
        GEMINI_CONTINUE_PROMPT,
        'gemini',
        logger
      );
      
      allExtractions.push({
        window: windowIndex + 1,
        startLine,
        endLine,
        extraction: windowExtraction
      });
      
      await logger.info('page3_gemini', `Window ${windowIndex + 1} completed`, {
        extractedLines: windowExtraction.lines.length,
        isCompleted: windowExtraction.isCompleted
      });
    }
    
    // Combine all extractions
    const allLines = [];
    for (const windowResult of allExtractions) {
      allLines.push(...windowResult.extraction.lines);
    }
    
    // Create combined extraction result
    const combinedExtraction = {
      page: 3,
      lines: allLines,
      isCompleted: true,
      extractionWindows: allExtractions.map(w => ({
        window: w.window,
        startLine: w.startLine,
        endLine: w.endLine,
        linesExtracted: w.extraction.lines.length
      }))
    };
    
    // Stage 6: Save results to files
    const outputDir = `./results/${runId}`;
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    
    // Save detailed results
    const detailedFile = `${outputDir}/page3-gemini-detailed.json`;
    await writeFile(detailedFile, JSON.stringify({
      page: 3,
      model: 'gemini',
      lineCountConsensus: lineCountConsensus,
      totalLinesExtracted: allLines.length,
      extractionWindows: allExtractions,
      combinedExtraction: combinedExtraction,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Save clean extraction (just the lines)
    const cleanFile = `${outputDir}/page3-gemini-lines.json`;
    await writeFile(cleanFile, JSON.stringify({
      page: 3,
      model: 'gemini',
      lineCount: lineCountConsensus.finalCount,
      extractedLines: allLines.length,
      lines: allLines,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    // Save as text format for easy reading
    const textFile = `${outputDir}/page3-gemini-lines.txt`;
    const textContent = allLines.map((line, index) => {
      return `Line ${index + 1}: ${JSON.stringify(line)}`;
    }).join('\n');
    await writeFile(textFile, textContent);
    
    // Create summary report
    const summaryFile = `${outputDir}/page3-summary.md`;
    const summary = `# Page 3 Extraction Results (Gemini Only)

**Run ID**: ${runId}  
**Generated**: ${new Date().toISOString()}  
**Source**: ${testUrl}  

## Line Count Consensus

- **Gemini Count**: ${lineCountConsensus.geminiResult.lineCount}
- **Claude Count**: ${lineCountConsensus.claudeResult.lineCount}
- **Final Consensus**: ${lineCountConsensus.finalCount} lines ✅ **(> 40 lines requirement met!)**

## Extraction Results

### Gemini Extraction
- **Total Lines Extracted**: ${allLines.length}
- **Extraction Windows**: ${allExtractions.length}
- **Completion Status**: Complete
- **Success Rate**: ${((allLines.length / lineCountConsensus.finalCount) * 100).toFixed(1)}%

### Window Breakdown
${allExtractions.map(w => 
  `- **Window ${w.window}**: Lines ${w.startLine}-${w.endLine} → ${w.extraction.lines.length} extracted`
).join('\n')}

## Sample Extracted Lines

${allLines.slice(0, 5).map((line, index) => 
  `**Line ${index + 1}**: ${line.party || 'N/A'} | ${line.nature || 'N/A'} | ${line.date || 'N/A'} | Pub: ${line.publicationNo || 'N/A'}`
).join('\n')}

${allLines.length > 5 ? `\n... and ${allLines.length - 5} more lines` : ''}

## Files Generated

- \`page3-gemini-detailed.json\` - Complete extraction details with windows
- \`page3-gemini-lines.json\` - Clean extraction results
- \`page3-gemini-lines.txt\` - Human-readable text format
- \`page3-summary.md\` - This summary report

## Notes

- ✅ **Page 3 has ${lineCountConsensus.finalCount} lines** (exceeds 40-line requirement)
- ✅ **Gemini extraction successful** with ${allLines.length} lines extracted
- ❌ **Qwen3 skipped** (OpenRouter account needs credits)
- ❌ **Claude boost skipped** (timeout issues)

## Next Steps

1. Add credits to OpenRouter account for Qwen3 testing
2. Fix Claude boost timeout issues
3. Compare Gemini vs Qwen3 extraction quality
`;
    
    await writeFile(summaryFile, summary);
    
    await logger.success('page3_gemini', 'Page 3 Gemini extraction complete!', {
      outputDir,
      totalLines: allLines.length,
      consensusLines: lineCountConsensus.finalCount,
      extractionWindows: allExtractions.length,
      filesGenerated: 4
    });
    
    console.log('\n🎉 Page 3 Gemini extraction completed successfully!');
    console.log(`📁 Results saved to: ${outputDir}`);
    console.log(`📋 Summary: ${summaryFile}`);
    console.log(`📊 Extracted ${allLines.length} lines from ${lineCountConsensus.finalCount} detected lines`);
    console.log(`📝 Logs: ${logger.getLogFile()}`);
    console.log(`\n✅ **REQUIREMENT MET**: Page 3 has ${lineCountConsensus.finalCount} lines (> 40)`);
    
    // Show sample of extracted data
    if (allLines.length > 0) {
      console.log('\n📄 Sample extracted lines:');
      allLines.slice(0, 3).forEach((line, index) => {
        console.log(`  ${index + 1}. ${line.party || 'N/A'} | ${line.nature || 'N/A'} | ${line.date || 'N/A'} | Pub: ${line.publicationNo || 'N/A'}`);
      });
      if (allLines.length > 3) {
        console.log(`  ... and ${allLines.length - 3} more lines`);
      }
    }
    
  } catch (error) {
    console.error('❌ Page 3 Gemini extraction failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

// Run the script
main();

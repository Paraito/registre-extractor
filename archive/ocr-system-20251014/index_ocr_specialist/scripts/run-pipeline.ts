#!/usr/bin/env tsx

import { runGeminiPipeline } from '../src/server/pipeline.js';
import { CONFIG, validateConfig } from '../config/runtime.js';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    // Get URL from command line
    const url = process.argv[2];
    if (!url) {
      console.error('❌ Error: Please provide a PDF URL');
      console.log('');
      console.log('Usage:');
      console.log('  npx tsx scripts/run-pipeline.ts "https://your-pdf-url-here"');
      console.log('');
      console.log('Example:');
      console.log('  npx tsx scripts/run-pipeline.ts "https://example.com/document.pdf"');
      process.exit(1);
    }
    
    console.log('🚀 **STARTING OCR PIPELINE**');
    console.log(`📄 PDF URL: ${url.substring(0, 80)}...`);
    console.log(`⚙️ Model: Gemini 2.5 Pro (optimized extraction)`);
    console.log(`📊 Extract window: ${CONFIG.extractWindow} lines`);
    console.log(`🔍 Upscale factor: ${CONFIG.upscaleFactor}x`);
    console.log('');
    
    const startTime = Date.now();
    
    // Run the pipeline with coherence check disabled to avoid Claude 5MB issues
    const result = await runGeminiPipeline(url);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('');
    console.log('🎉 **PIPELINE COMPLETED**');
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`📊 Total pages: ${result.pages.length}`);
    console.log(`📝 Total inscriptions: ${result.totalLinesExtracted}`);
    console.log(`📁 Results saved to: ./artifacts/${result.runId}/`);
    console.log('');
    
    // Show page breakdown
    console.log('📋 **PAGE BREAKDOWN:**');
    result.pages.forEach(page => {
      // Handle both possible structures: page.lines or page.extraction.lines
      const linesCount = page.lines?.length || page.extraction?.lines?.length || 0;
      const pageNum = page.pageNumber || page.page;
      const status = linesCount > 0 ? '✅' : '❌';
      console.log(`   ${status} Page ${pageNum}: ${linesCount} inscriptions`);
    });

    // Save full results to file
    const resultsFile = `./results/extraction_${result.runId}.txt`;
    let fullResults = `OCR EXTRACTION RESULTS\n`;
    fullResults += `======================\n`;
    fullResults += `Date: ${new Date().toISOString()}\n`;
    fullResults += `PDF: ${url}\n`;
    fullResults += `Total Pages: ${result.pages.length}\n`;
    fullResults += `Total Lines Extracted: ${result.totalLinesExtracted}\n\n`;

    result.pages.forEach(page => {
      // Handle both possible structures
      const lines = page.lines || page.extraction?.lines;
      const pageNum = page.pageNumber || page.page;

      if (lines && lines.length > 0) {
        fullResults += `\n${'='.repeat(80)}\n`;
        fullResults += `PAGE ${pageNum} - ${lines.length} INSCRIPTIONS\n`;
        fullResults += `${'='.repeat(80)}\n\n`;

        lines.forEach((line, index) => {
          fullResults += `${index + 1}. ${line.rawLine || 'N/A'}\n`;
          fullResults += `   - Parties: ${line.party || 'N/A'}\n`;
          fullResults += `   - Nature: ${line.nature || 'N/A'}\n`;
          fullResults += `   - Date: ${line.date || 'N/A'}\n`;
          fullResults += `   - Publication: ${line.publicationNo || 'N/A'}\n`;
          fullResults += `   - Radiation: ${line.radiation || 'N/A'}\n`;
          fullResults += `   - Remarks: ${line.remarks || 'N/A'}\n`;
          fullResults += `   - Confidence: ${line.confidence}\n\n`;
        });
      }
    });

    // Ensure results directory exists
    const fs = await import('fs');
    await fs.promises.mkdir('./results', { recursive: true });
    await fs.promises.writeFile(resultsFile, fullResults);

    console.log('');
    console.log(`📄 **FULL RESULTS SAVED TO:** ${resultsFile}`);
    console.log('🎯 **SUCCESS!** Your Quebec land registry data has been extracted.');
    
  } catch (error) {
    console.error('');
    console.error('❌ **PIPELINE FAILED**');
    console.error(`Error: ${(error as Error).message}`);
    console.error('');
    console.error('💡 **TROUBLESHOOTING:**');
    console.error('1. Check your internet connection');
    console.error('2. Verify the PDF URL is accessible');
    console.error('3. Ensure API keys are set in .env file');
    console.error('4. Try with a smaller PDF first');
    process.exit(1);
  }
}

main();

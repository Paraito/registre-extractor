#!/usr/bin/env tsx
/**
 * Show Extraction and Boost Results
 * 
 * This script runs a focused test to show actual extraction and boost results
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { runE2EPipeline } from '../src/server/pipeline.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `extraction-demo-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    console.log('\n📄 **EXTRACTION & BOOST RESULTS DEMO**');
    console.log('🎯 Running focused extraction test to show actual results...\n');
    
    const startTime = Date.now();
    
    // Run the E2E pipeline
    const result = await runE2EPipeline({
      url: testUrl,
      extractionModel: 'gemini',
      runId,
      tolerancePercent: 5.0,
      skipBoost: false,
      skipCoherence: true, // Skip coherence to avoid token issues
      logger
    });
    
    const duration = Date.now() - startTime;
    
    console.log('\n🎉 **EXTRACTION COMPLETED!**');
    console.log(`⏱️  Duration: ${(duration / 60000).toFixed(2)} minutes`);
    console.log(`📄 Pages: ${result.document.pages.length}`);
    
    // Show detailed extraction results
    console.log('\n📊 **DETAILED EXTRACTION RESULTS**\n');
    
    result.document.pages.forEach((page: any, index: number) => {
      console.log(`\n📄 **PAGE ${page.page}**`);
      console.log(`   📊 Lines Detected: ${page.lineCount}`);
      console.log(`   📝 Lines Extracted: ${page.lines.length}`);
      console.log(`   ✅ Completion Rate: ${((page.lines.length / page.lineCount) * 100).toFixed(1)}%`);
      
      if (page.lines.length > 0) {
        console.log(`   📋 **Sample Extractions:**`);
        page.lines.slice(0, 3).forEach((line: any, lineIndex: number) => {
          console.log(`      ${lineIndex + 1}. Party: "${line.party || 'N/A'}" | Nature: "${line.nature || 'N/A'}" | Date: "${line.date || 'N/A'}" | Pub: "${line.publicationNo || 'N/A'}"`);
        });
        
        if (page.lines.length > 3) {
          console.log(`      ... and ${page.lines.length - 3} more lines`);
        }
        
        // Show boost results if available
        const boostedLines = page.lines.filter((line: any) => line.boost);
        if (boostedLines.length > 0) {
          console.log(`   🚀 **Boost Results:**`);
          console.log(`      📊 Boosted Lines: ${boostedLines.length}/${page.lines.length}`);
          
          const avgConfidence = boostedLines.reduce((sum: number, line: any) => 
            sum + (line.boost?.confidence || 0), 0) / boostedLines.length;
          console.log(`      🎯 Avg Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
          
          // Show sample boost data
          const sampleBoosted = boostedLines[0];
          if (sampleBoosted?.boost) {
            console.log(`      📋 **Sample Boost:**`);
            console.log(`         Original: "${sampleBoosted.party || 'N/A'}"`);
            console.log(`         Boosted: "${sampleBoosted.boost.normalizedParty || 'N/A'}"`);
            console.log(`         Confidence: ${(sampleBoosted.boost.confidence * 100).toFixed(1)}%`);
            console.log(`         Issues: ${sampleBoosted.boost.issues?.join(', ') || 'None'}`);
          }
        }
      } else {
        console.log(`   ❌ No lines extracted (extraction failed or returned empty)`);
      }
    });
    
    // Overall statistics
    const totalLinesDetected = result.document.pages.reduce((sum: number, page: any) => sum + page.lineCount, 0);
    const totalLinesExtracted = result.document.pages.reduce((sum: number, page: any) => sum + page.lines.length, 0);
    const totalBoostedLines = result.document.pages.reduce((sum: number, page: any) => 
      sum + page.lines.filter((line: any) => line.boost).length, 0);
    
    console.log('\n📈 **OVERALL STATISTICS**');
    console.log(`   📊 Total Lines Detected: ${totalLinesDetected}`);
    console.log(`   📝 Total Lines Extracted: ${totalLinesExtracted}`);
    console.log(`   🚀 Total Lines Boosted: ${totalBoostedLines}`);
    console.log(`   ✅ Overall Completion Rate: ${((totalLinesExtracted / totalLinesDetected) * 100).toFixed(1)}%`);
    console.log(`   🎯 Boost Coverage: ${totalLinesExtracted > 0 ? ((totalBoostedLines / totalLinesExtracted) * 100).toFixed(1) : 0}%`);
    
    // Show file locations
    console.log('\n📁 **RESULT FILES**');
    console.log(`   📄 Artifacts: ${result.artifactsDir}`);
    console.log(`   📝 Logs: ${logger.getLogFile()}`);
    console.log(`   💾 Document JSON: ${result.artifactsDir}/document.json`);
    
    // Performance metrics
    console.log('\n⚡ **PERFORMANCE METRICS**');
    console.log(`   🚀 Lines per minute: ${(totalLinesExtracted / (duration / 60000)).toFixed(1)}`);
    console.log(`   📊 Pages per minute: ${(result.document.pages.length / (duration / 60000)).toFixed(1)}`);
    console.log(`   💰 Estimated cost: $${((totalLinesDetected * 0.02) + (totalLinesExtracted * 0.05)).toFixed(2)}`);
    
  } catch (error) {
    console.error('\n❌ Extraction demo failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

main();

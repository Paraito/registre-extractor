#!/usr/bin/env tsx
/**
 * Optimized Pipeline Test - Gemini 2.5 Pro + Claude Sonnet
 * 
 * Features:
 * - Parallel image processing
 * - Resilient API calls with retry logic
 * - Gemini 2.5 Pro for all extraction
 * - Claude Sonnet as validation soundboard
 * - Capped upscaling for resilience
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { runE2EPipeline } from '../src/server/pipeline.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `optimized-test-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    await logger.info('optimized_test', 'Starting optimized pipeline test', {
      url: testUrl.substring(0, 100) + '...',
      runId,
      features: [
        'Parallel processing',
        'Resilient retries',
        'Gemini 2.5 Pro primary',
        'Claude Sonnet validation',
        'Capped upscaling'
      ]
    });
    
    console.log('\n🚀 Starting Optimized OCR Pipeline Test');
    console.log('📋 Features:');
    console.log('   ⚡ Parallel image processing');
    console.log('   🔄 Resilient API calls with retry logic');
    console.log('   🤖 Gemini 2.5 Pro for all extraction');
    console.log('   🎯 Claude Sonnet as validation soundboard');
    console.log('   🛡️ Capped upscaling for resilience');
    console.log('   📊 Real-time progress tracking');
    
    const startTime = Date.now();
    
    // Run the optimized E2E pipeline
    const result = await runE2EPipeline({
      url: testUrl,
      extractionModel: 'gemini',
      runId,
      tolerancePercent: 5.0,
      skipBoost: false,
      skipCoherence: false,
      logger
    });
    
    const duration = Date.now() - startTime;
    
    // Analyze results
    const totalPages = result.document.pages.length;
    const totalLines = result.document.pages.reduce((sum: number, page: any) => sum + page.lines.length, 0);
    const page3 = result.document.pages.find((p: any) => p.page === 3);
    const page4 = result.document.pages.find((p: any) => p.page === 4);
    
    await logger.success('optimized_test', 'Pipeline completed successfully!', {
      totalPages,
      totalLines,
      durationMs: duration,
      durationMinutes: (duration / 60000).toFixed(2),
      page3Lines: page3?.lines.length || 0,
      page4Lines: page4?.lines.length || 0
    });
    
    console.log('\n🎉 Optimized Pipeline Test Completed Successfully!');
    console.log(`⏱️  Total Duration: ${(duration / 60000).toFixed(2)} minutes`);
    console.log(`📄 Pages Processed: ${totalPages}`);
    console.log(`📝 Total Lines Extracted: ${totalLines}`);
    
    if (page3) {
      console.log(`📊 Page 3: ${page3.lines.length} lines ${page3.lines.length > 40 ? '✅' : '❌'} (requirement: > 40)`);
    }
    
    if (page4) {
      console.log(`📊 Page 4: ${page4.lines.length} lines ${page4.lines.length > 40 ? '✅' : '❌'} (requirement: > 40)`);
    }
    
    // Test assertions
    if (page3 && page3.lines.length <= 40) {
      throw new Error(`Page 3 assertion failed: expected > 40 lines, got ${page3.lines.length}`);
    }
    
    if (page4 && page4.lines.length <= 40) {
      throw new Error(`Page 4 assertion failed: expected > 40 lines, got ${page4.lines.length}`);
    }
    
    console.log('\n✅ All test assertions passed!');
    console.log(`📁 Results saved to: ${result.artifactsDir}`);
    console.log(`📝 Logs: ${logger.getLogFile()}`);
    
    // Performance summary
    console.log('\n📈 Performance Summary:');
    console.log(`   🚀 Average time per page: ${(duration / totalPages / 1000).toFixed(1)}s`);
    console.log(`   📊 Lines per minute: ${(totalLines / (duration / 60000)).toFixed(0)}`);
    console.log(`   ⚡ Pipeline efficiency: ${totalPages > 0 ? 'Optimized' : 'Needs improvement'}`);
    
    // Show sample extracted data
    if (page3 && page3.lines.length > 0) {
      console.log('\n📄 Sample Page 3 Extractions:');
      page3.lines.slice(0, 3).forEach((line: any, index: number) => {
        console.log(`   ${index + 1}. ${line.party || 'N/A'} | ${line.nature || 'N/A'} | ${line.date || 'N/A'} | Pub: ${line.publicationNo || 'N/A'}`);
      });
      if (page3.lines.length > 3) {
        console.log(`   ... and ${page3.lines.length - 3} more lines`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Optimized pipeline test failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    
    // Provide helpful debugging info
    console.log('\n🔍 Debugging Tips:');
    console.log('   1. Check API keys are valid and have sufficient quota');
    console.log('   2. Verify network connectivity');
    console.log('   3. Check if PDF URL is accessible');
    console.log('   4. Review logs for specific error details');
    
    process.exit(1);
  }
}

// Performance monitoring
const originalConsoleLog = console.log;
let logCount = 0;

console.log = (...args) => {
  logCount++;
  if (logCount % 50 === 0) {
    originalConsoleLog(`📊 Processed ${logCount} log entries...`);
  }
  return originalConsoleLog(...args);
};

// Run the test
main();

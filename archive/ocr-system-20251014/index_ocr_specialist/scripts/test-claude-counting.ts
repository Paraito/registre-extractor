#!/usr/bin/env tsx
/**
 * Test Claude's improved counting on Page 3
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { ClaudeClient } from '../src/clients/claude.js';
import { COUNT_PROMPT_CLAUDE } from '../prompts/prompts-multi-model.js';
import sharp from 'sharp';

async function main() {
  try {
    validateConfig();
    
    const runId = `claude-count-test-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    console.log('\n🧪 **TESTING CLAUDE IMPROVED COUNTING**');
    console.log('🎯 Testing Page 3 specifically (should be 20+ lines)\n');
    
    // Fetch and convert
    const fetchResult = await fetchPDF(testUrl, logger);
    const pdfResult = await pdfToImages(fetchResult.buffer, logger);
    const pages = pdfResult.pages;
    
    // Test Page 3 specifically
    const page3 = pages.find(p => p.pageNumber === 3);
    if (!page3) {
      console.log('❌ Page 3 not found');
      return;
    }
    
    console.log(`📄 Page 3 found: ${(page3.content.length / 1024 / 1024).toFixed(2)}MB`);

    // Resize image for Claude (same logic as pipeline)
    console.log(`🔧 Resizing image for Claude...`);
    const metadata = await sharp(page3.content).metadata();
    const maxDimension = Math.max(metadata.width || 0, metadata.height || 0);
    const originalSize = page3.content.length;
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB

    let resizeFactor = 1;
    if (maxDimension > 8000) {
      resizeFactor = Math.min(resizeFactor, 8000 / maxDimension);
    }
    if (originalSize > maxSizeBytes) {
      const areaReduction = maxSizeBytes / originalSize;
      const dimensionReduction = Math.sqrt(areaReduction) * 0.6;
      resizeFactor = Math.min(resizeFactor, dimensionReduction);
    }

    const newWidth = Math.floor((metadata.width || 0) * resizeFactor);
    const newHeight = Math.floor((metadata.height || 0) * resizeFactor);

    const resizedImage = await sharp(page3.content)
      .resize(newWidth, newHeight, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer();

    console.log(`   ✅ Resized: ${metadata.width}x${metadata.height} → ${newWidth}x${newHeight}`);
    console.log(`   ✅ Size: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(resizedImage.length / 1024 / 1024).toFixed(2)}MB`);

    // Test Claude counting 3 times to see consistency
    const claudeClient = new ClaudeClient(logger);
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`\n🔍 **Attempt ${attempt}/3**`);
        
        const result = await claudeClient.countLines(resizedImage, COUNT_PROMPT_CLAUDE, page3.pageNumber);
        
        console.log(`   📊 Count: ${result.count} lines`);
        console.log(`   🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`   📝 Method: ${result.method.substring(0, 100)}...`);
        
        if (result.count >= 20) {
          console.log(`   ✅ GOOD! Count is 20+ (target achieved)`);
        } else if (result.count >= 18) {
          console.log(`   ⚠️  CLOSE! Count is 18+ (getting better)`);
        } else {
          console.log(`   ❌ LOW! Count is <18 (still undercounting)`);
        }
        
      } catch (error) {
        console.log(`   ❌ Attempt ${attempt} failed: ${(error as Error).message}`);
      }
      
      // Brief delay between attempts
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n📊 **COMPARISON TARGET**');
    console.log('   🎯 Gemini 2.5 Pro (browser): ~25 lines');
    console.log('   🎯 Expected Claude (improved): 20+ lines');
    console.log('   ❌ Previous Claude: 17 lines');
    
  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env tsx
/**
 * Debug Page 5 Image Size Issue
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { upscalePages } from '../src/pipeline/upscale.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `debug-page5-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    console.log('🔍 Debugging Page 5 Image Size Issue');
    
    // Fetch PDF
    const fetchResult = await fetchPDF(testUrl, logger);
    console.log(`📄 PDF Size: ${(fetchResult.buffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Convert to images
    const result = await pdfToImages(fetchResult.buffer, logger);
    const pages = result.pages;
    console.log(`📄 Total Pages: ${pages.length}`);
    
    // Check Page 5 specifically
    const page5 = pages.find(p => p.pageNumber === 5);
    if (page5) {
      console.log(`📄 Page 5 Original: ${(page5.content.length / 1024 / 1024).toFixed(2)}MB (${page5.width}x${page5.height}px)`);
      
      // Upscale Page 5
      const upscaledPages = await upscalePages([page5], logger);
      const upscaledPage5 = upscaledPages[0];
      
      console.log(`📄 Page 5 Upscaled: ${(upscaledPage5.content.length / 1024 / 1024).toFixed(2)}MB (${upscaledPage5.width}x${upscaledPage5.height}px)`);
      
      // Test size limits
      const safeSizeBytes = 3.5 * 1024 * 1024; // 3.5MB
      const maxSizeBytes = 5 * 1024 * 1024; // 5MB
      
      console.log('\n🔍 Size Analysis:');
      console.log(`   Safe limit (3.5MB): ${safeSizeBytes.toLocaleString()} bytes`);
      console.log(`   Max limit (5MB): ${maxSizeBytes.toLocaleString()} bytes`);
      console.log(`   Original size: ${page5.content.length.toLocaleString()} bytes`);
      console.log(`   Upscaled size: ${upscaledPage5.content.length.toLocaleString()} bytes`);
      
      console.log('\n🔍 Logic Check:');
      console.log(`   Original < Safe (${page5.content.length < safeSizeBytes})`);
      console.log(`   Original < Upscaled (${page5.content.length < upscaledPage5.content.length})`);
      console.log(`   Should use original directly: ${page5.content.length < safeSizeBytes && page5.content.length < upscaledPage5.content.length}`);
      console.log(`   Should resize original: ${!(page5.content.length < safeSizeBytes) && page5.content.length < upscaledPage5.content.length}`);
      console.log(`   Should resize upscaled: ${!(page5.content.length < upscaledPage5.content.length)}`);
      
      // Base64 encoding test
      const base64Size = Math.ceil(page5.content.length * 4 / 3);
      console.log(`\n🔍 Base64 Encoding:`);
      console.log(`   Original binary: ${page5.content.length.toLocaleString()} bytes`);
      console.log(`   Base64 encoded: ${base64Size.toLocaleString()} bytes`);
      console.log(`   Base64 > 5MB limit: ${base64Size > maxSizeBytes}`);
      
    } else {
      console.log('❌ Page 5 not found');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

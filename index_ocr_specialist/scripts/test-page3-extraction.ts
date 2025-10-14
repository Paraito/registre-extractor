#!/usr/bin/env tsx

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { upscalePages } from '../src/pipeline/upscale.js';
import { GeminiClient } from '../src/clients/gemini.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `page3-extract-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || "https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/sign/index/856-Shefford-Canton_d_Ely-1756990434100.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85MzgyN2Y2MS04OGM3LTRkN2MtYWEyZi00NzlhZTc2YWE3MjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbmRleC84NTYtU2hlZmZvcmQtQ2FudG9uX2RfRWx5LTE3NTY5OTA0MzQxMDAucGRmIiwiaWF0IjoxNzYwMjAxNTYxLCJleHAiOjE3NjI3OTM1NjF9.pw4g89W86VUJLlEtNzMP6uKUZUcy3RBxEsNhKwsx7gc";
    
    console.log('\n🎯 **PAGE 5 EXTRACTION TEST**');
    console.log('📄 Testing main inscription table (15+ lines expected)\n');
    
    // Get PDF and convert
    console.log('📥 Fetching PDF...');
    const fetchResult = await fetchPDF(testUrl, logger);
    
    console.log('🔄 Converting to images...');
    const pdfResult = await pdfToImages(fetchResult.buffer, logger);
    const pages = pdfResult.pages;
    
    // Find Page 5 (main inscription table)
    const page5 = pages.find(p => p.pageNumber === 5);
    if (!page5) {
      console.log('❌ Page 5 not found');
      return;
    }

    console.log(`✅ Page 5 found: ${(page5.content.length / 1024 / 1024).toFixed(2)}MB`);
    
    // Upscale for better quality
    console.log('🔍 Upscaling Page 5...');
    const upscaledPages = await upscalePages([page5], logger);
    const upscaledPage5 = upscaledPages[0];

    console.log(`📏 Upscaled: ${(page5.content.length / 1024 / 1024).toFixed(2)}MB → ${(upscaledPage5.content.length / 1024 / 1024).toFixed(2)}MB`);
    
    // Extract with new method
    console.log('\n🤖 Extracting with optimized Gemini method...');
    const geminiClient = new GeminiClient(logger);
    
    const result = await geminiClient.extractText(
      upscaledPage5.content,
      '', // Empty prompt - method uses its own optimized prompt
      page5.pageNumber
    );
    
    console.log(`\n🎉 **EXTRACTION RESULTS**`);
    console.log(`📊 Lines extracted: ${result.lines.length}`);
    console.log(`✅ Completed: ${result.isCompleted}`);
    console.log(`🎯 Target: 20+ lines`);
    
    if (result.lines.length >= 20) {
      console.log(`✅ SUCCESS! Got ${result.lines.length} lines!`);
    } else {
      console.log(`⚠️ Got ${result.lines.length} lines (target: 20+)`);
    }
    
    if (result.lines.length > 0) {
      console.log(`\n📋 **SAMPLE EXTRACTED LINES:**`);
      result.lines.slice(0, 10).forEach((line, i) => {
        console.log(`   ${i + 1}. ${line.party} | ${line.nature} | ${line.date} | ${line.publicationNo}`);
      });
      
      if (result.lines.length > 10) {
        console.log(`   ... and ${result.lines.length - 10} more lines`);
      }
      
      console.log(`\n📈 **SUMMARY:**`);
      console.log(`   📊 Total entries: ${result.lines.length}`);
      console.log(`   🎯 Success rate: ${result.lines.length >= 20 ? '✅ EXCELLENT' : result.lines.length >= 15 ? '⚠️ GOOD' : '❌ NEEDS IMPROVEMENT'}`);
      
      // Show all raw lines for debugging
      console.log(`\n📄 **ALL RAW LINES:**`);
      result.lines.forEach((line, i) => {
        console.log(`${i + 1}. ${line.rawLine}`);
      });
      
    } else {
      console.log(`\n❌ **NO CONTENT EXTRACTED**`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

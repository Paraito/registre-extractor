#!/usr/bin/env tsx

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { GeminiClient } from '../src/clients/gemini.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `all-pages-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || "https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/sign/index/10A-77-Montcalm-Canton_de_Kilkenny-1757447811787.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85MzgyN2Y2MS04OGM3LTRkN2MtYWEyZi00NzlhZTc2YWE3MjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbmRleC8xMEEtNzctTW9udGNhbG0tQ2FudG9uX2RlX0tpbGtlbm55LTE3NTc0NDc4MTE3ODcucGRmIiwiaWF0IjoxNzYwMzkyMjUyLCJleHAiOjE3NjI5ODQyNTJ9.rlVet095kn8mmgMQaBBEQVG-KPRjn65BajCkxlDNN8k";
    
    console.log('\n🎯 **ALL PAGES EXTRACTION TEST**');
    console.log('📄 Testing all pages to find the main inscription table\n');
    
    // Get PDF and convert
    console.log('📥 Fetching PDF...');
    const fetchResult = await fetchPDF(testUrl, logger);
    
    console.log('🔄 Converting to images...');
    const pdfResult = await pdfToImages(fetchResult.buffer, logger);
    const pages = pdfResult.pages;
    
    console.log(`✅ Found ${pages.length} pages`);
    
    // Test each page
    const geminiClient = new GeminiClient(logger);
    
    for (const page of pages) {
      console.log(`\n📄 **PAGE ${page.pageNumber}** (${(page.content.length / 1024 / 1024).toFixed(2)}MB)`);
      
      try {
        const result = await geminiClient.extractText(
          page.content, 
          '', // Empty prompt - method uses its own optimized prompt
          page.pageNumber
        );
        
        console.log(`   📊 Lines extracted: ${result.lines.length}`);
        
        if (result.lines.length > 0) {
          console.log(`   📋 Sample lines:`);
          result.lines.slice(0, 3).forEach((line, i) => {
            const preview = line.rawLine.substring(0, 80);
            console.log(`      ${i + 1}. ${preview}${line.rawLine.length > 80 ? '...' : ''}`);
          });
          
          if (result.lines.length >= 10) {
            console.log(`   🎯 **POTENTIAL MAIN TABLE** - ${result.lines.length} lines!`);
          }
        } else {
          console.log(`   ❌ No inscriptions found`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${(error as Error).message}`);
      }
      
      // Brief delay between pages
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n📊 **SUMMARY**`);
    console.log(`   📄 Total pages tested: ${pages.length}`);
    console.log(`   🎯 Look for pages with 10+ lines for main inscription tables`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

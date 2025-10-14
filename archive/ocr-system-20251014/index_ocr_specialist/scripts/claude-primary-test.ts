#!/usr/bin/env tsx
/**
 * Claude Primary Test - When Gemini is down
 * 
 * This script tests using Claude as primary for both line counting and extraction
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages, savePageImages } from '../src/pipeline/pdf_to_images.js';
import { upscalePages, saveUpscaledImages } from '../src/pipeline/upscale.js';
import { ClaudeClient } from '../src/clients/claude.js';
import { COUNT_PROMPT_CLAUDE } from '../prompts/prompts-multi-model.js';
import { GEMINI_EXTRACT_PROMPT } from '../prompts/prompts-unified.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `claude-primary-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    console.log('\n🎯 **CLAUDE PRIMARY TEST**');
    console.log('🔧 Using Claude as primary when Gemini is down...\n');
    
    const startTime = Date.now();
    
    // Stage 1: Fetch PDF
    const fetchResult = await fetchPDF(testUrl, logger);
    const pdfBuffer = fetchResult.buffer;
    
    // Stage 2: Convert to images
    const pdfResult = await pdfToImages(pdfBuffer, logger);
    const pages = pdfResult.pages;
    await savePageImages(pages, logger, runId, 'original');
    
    // Stage 3: Upscale images
    const upscaledPages = await upscalePages(pages, logger);
    await saveUpscaledImages(upscaledPages, logger, runId);
    
    // Stage 4: Claude-only line counting
    console.log('\n📊 **CLAUDE LINE COUNTING**\n');
    const claudeClient = new ClaudeClient(logger);
    const lineCounts = [];
    
    for (const page of upscaledPages) {
      try {
        console.log(`🔍 Counting lines on Page ${page.pageNumber}...`);
        
        // Use original image if small enough, otherwise use upscaled
        const originalPage = pages.find(p => p.pageNumber === page.pageNumber);
        const imageToUse = originalPage && originalPage.content.length < 3 * 1024 * 1024 
          ? originalPage.content 
          : page.content;
        
        const result = await claudeClient.countLines(imageToUse, COUNT_PROMPT_CLAUDE, page.pageNumber);
        
        lineCounts.push({
          page: page.pageNumber,
          count: result.count,
          confidence: result.confidence,
          method: result.method
        });
        
        console.log(`   ✅ Page ${page.pageNumber}: ${result.count} lines (${(result.confidence * 100).toFixed(1)}% confidence)`);
        
      } catch (error) {
        console.log(`   ❌ Page ${page.pageNumber}: Failed - ${(error as Error).message}`);
        lineCounts.push({
          page: page.pageNumber,
          count: 0,
          confidence: 0,
          method: 'Failed'
        });
      }
    }
    
    // Stage 5: Claude extraction for pages with >0 lines
    console.log('\n📝 **CLAUDE TEXT EXTRACTION**\n');
    const extractions = [];
    
    for (const lineCount of lineCounts) {
      if (lineCount.count === 0) {
        console.log(`⏭️  Skipping Page ${lineCount.page} (0 lines detected)`);
        continue;
      }
      
      try {
        console.log(`📄 Extracting Page ${lineCount.page} (${lineCount.count} lines)...`);
        
        const page = upscaledPages.find(p => p.pageNumber === lineCount.page);
        if (!page) continue;
        
        // Use original image if small enough
        const originalPage = pages.find(p => p.pageNumber === page.pageNumber);
        const imageToUse = originalPage && originalPage.content.length < 3 * 1024 * 1024 
          ? originalPage.content 
          : page.content;
        
        const extractResult = await claudeClient.extractText(imageToUse, GEMINI_EXTRACT_PROMPT, page.pageNumber);
        
        extractions.push({
          page: lineCount.page,
          linesDetected: lineCount.count,
          linesExtracted: extractResult.lines.length,
          lines: extractResult.lines,
          isCompleted: extractResult.isCompleted
        });
        
        console.log(`   ✅ Page ${lineCount.page}: ${extractResult.lines.length}/${lineCount.count} lines extracted`);
        
        // Show sample extractions
        if (extractResult.lines.length > 0) {
          console.log(`   📋 Sample: "${extractResult.lines[0].party || 'N/A'}" | "${extractResult.lines[0].nature || 'N/A'}" | "${extractResult.lines[0].date || 'N/A'}"`);
        }
        
      } catch (error) {
        console.log(`   ❌ Page ${lineCount.page}: Extraction failed - ${(error as Error).message}`);
        extractions.push({
          page: lineCount.page,
          linesDetected: lineCount.count,
          linesExtracted: 0,
          lines: [],
          isCompleted: false
        });
      }
    }
    
    const duration = Date.now() - startTime;
    
    // Results summary
    console.log('\n🎉 **CLAUDE PRIMARY TEST RESULTS**\n');
    
    const totalLinesDetected = lineCounts.reduce((sum, lc) => sum + lc.count, 0);
    const totalLinesExtracted = extractions.reduce((sum, ex) => sum + ex.linesExtracted, 0);
    const successfulPages = extractions.filter(ex => ex.linesExtracted > 0).length;
    
    console.log(`📊 **Summary:**`);
    console.log(`   📄 Pages processed: ${pages.length}`);
    console.log(`   📊 Total lines detected: ${totalLinesDetected}`);
    console.log(`   📝 Total lines extracted: ${totalLinesExtracted}`);
    console.log(`   ✅ Successful pages: ${successfulPages}/${pages.length}`);
    console.log(`   🎯 Success rate: ${((totalLinesExtracted / Math.max(totalLinesDetected, 1)) * 100).toFixed(1)}%`);
    console.log(`   ⏱️  Duration: ${(duration / 60000).toFixed(2)} minutes`);
    
    console.log(`\n📄 **Per-Page Results:**`);
    extractions.forEach(ex => {
      const rate = ex.linesDetected > 0 ? ((ex.linesExtracted / ex.linesDetected) * 100).toFixed(1) : '0.0';
      console.log(`   Page ${ex.page}: ${ex.linesExtracted}/${ex.linesDetected} lines (${rate}%)`);
    });
    
    // Show actual extracted content
    console.log(`\n📋 **EXTRACTED CONTENT SAMPLES:**`);
    extractions.forEach(ex => {
      if (ex.lines.length > 0) {
        console.log(`\n   📄 **Page ${ex.page}** (${ex.lines.length} lines):`);
        ex.lines.slice(0, 3).forEach((line, i) => {
          console.log(`      ${i + 1}. Party: "${line.party || 'N/A'}" | Nature: "${line.nature || 'N/A'}" | Date: "${line.date || 'N/A'}" | Pub: "${line.publicationNo || 'N/A'}"`);
        });
        if (ex.lines.length > 3) {
          console.log(`      ... and ${ex.lines.length - 3} more lines`);
        }
      }
    });
    
    console.log(`\n📁 **Files saved to:** ./artifacts/${runId}/`);
    console.log(`📝 **Logs:** ./logs/${runId}.ndjson`);
    
  } catch (error) {
    console.error('\n❌ Claude primary test failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

main();

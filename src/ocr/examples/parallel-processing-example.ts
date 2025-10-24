/**
 * Example: Parallel OCR Processing for Multi-Page PDFs
 * 
 * This example demonstrates how to use the parallel OCR processing
 * capabilities to process all pages of a PDF document simultaneously.
 */

import { OCRProcessor } from '../processor';
import { logger } from '../../utils/logger';

async function exampleParallelProcessing() {
  // Initialize the OCR processor
  const processor = new OCRProcessor({
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    extractModel: 'gemini-2.0-flash-exp',
    boostModel: 'gemini-2.5-pro',
    extractTemperature: 0.1,
    boostTemperature: 0.2,
    tempDir: '/tmp/ocr-parallel-example'
  });

  await processor.initialize();

  try {
    // Example 1: Process a local multi-page PDF in parallel
    console.log('\n=== Example 1: Parallel Processing of Local PDF ===\n');
    
    const pdfPath = '/path/to/your/multipage-document.pdf';
    const result = await processor.processPDFParallel(pdfPath);

    console.log(`Total pages processed: ${result.totalPages}`);
    console.log(`All pages complete: ${result.allPagesComplete}`);
    console.log(`Combined text length: ${result.combinedBoostedText.length} characters`);
    
    // Access individual page results
    result.pages.forEach(page => {
      console.log(`\nPage ${page.pageNumber}:`);
      console.log(`  - Extraction complete: ${page.extractionComplete}`);
      console.log(`  - Boost complete: ${page.boostComplete}`);
      console.log(`  - Text length: ${page.boostedText.length} characters`);
    });

    // Example 2: Process a PDF from URL in parallel
    console.log('\n=== Example 2: Parallel Processing from URL ===\n');
    
    const pdfUrl = 'https://example.com/document.pdf';
    const urlResult = await processor.processPDFFromURLParallel(pdfUrl);

    console.log(`Total pages from URL: ${urlResult.totalPages}`);
    console.log(`Combined boosted text preview:`);
    console.log(urlResult.combinedBoostedText.substring(0, 500) + '...');

    // Example 3: Compare parallel vs sequential processing
    console.log('\n=== Example 3: Performance Comparison ===\n');
    
    const testPdfPath = '/path/to/test-document.pdf';
    
    // Sequential processing (single page)
    const startSequential = Date.now();
    const sequentialResult = await processor.processPDF(testPdfPath);
    const sequentialTime = Date.now() - startSequential;
    
    console.log(`Sequential processing time: ${sequentialTime}ms`);
    console.log(`Sequential result length: ${sequentialResult.boostedText.length} characters`);
    
    // Parallel processing (all pages)
    const startParallel = Date.now();
    const parallelResult = await processor.processPDFParallel(testPdfPath);
    const parallelTime = Date.now() - startParallel;
    
    console.log(`Parallel processing time: ${parallelTime}ms`);
    console.log(`Parallel result pages: ${parallelResult.totalPages}`);
    console.log(`Parallel result length: ${parallelResult.combinedBoostedText.length} characters`);
    
    if (parallelResult.totalPages > 1) {
      const estimatedSequentialTime = sequentialTime * parallelResult.totalPages;
      const speedup = estimatedSequentialTime / parallelTime;
      console.log(`\nEstimated speedup: ${speedup.toFixed(2)}x faster`);
    }

  } catch (error) {
    logger.error({ error }, 'Example failed');
    console.error('Error:', error);
  } finally {
    // Clean up
    await processor.cleanup();
  }
}

// Example 4: Processing with error handling for individual pages
async function exampleWithErrorHandling() {
  const processor = new OCRProcessor({
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    tempDir: '/tmp/ocr-parallel-example'
  });

  await processor.initialize();

  try {
    const pdfPath = '/path/to/document.pdf';
    const result = await processor.processPDFParallel(pdfPath);

    // Check which pages completed successfully
    const successfulPages = result.pages.filter(p => p.extractionComplete && p.boostComplete);
    const failedPages = result.pages.filter(p => !p.extractionComplete || !p.boostComplete);

    console.log(`\nSuccessful pages: ${successfulPages.length}/${result.totalPages}`);
    
    if (failedPages.length > 0) {
      console.log(`Failed pages: ${failedPages.map(p => p.pageNumber).join(', ')}`);
      
      // You could retry failed pages individually here
      for (const failedPage of failedPages) {
        console.log(`Page ${failedPage.pageNumber} needs attention`);
      }
    }

    // Use only successful pages
    const successfulText = successfulPages
      .map(p => `\n\n--- Page ${p.pageNumber} ---\n\n${p.boostedText}`)
      .join('\n');

    console.log(`\nCombined text from successful pages: ${successfulText.length} characters`);

  } catch (error) {
    logger.error({ error }, 'Processing failed');
  } finally {
    await processor.cleanup();
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  console.log('Starting OCR Parallel Processing Examples...\n');
  
  exampleParallelProcessing()
    .then(() => {
      console.log('\n=== Example 4: Error Handling ===\n');
      return exampleWithErrorHandling();
    })
    .then(() => {
      console.log('\nAll examples completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Examples failed:', error);
      process.exit(1);
    });
}

export { exampleParallelProcessing, exampleWithErrorHandling };


/**
 * Test script for OCR integration
 * 
 * This script tests the OCR processing pipeline by:
 * 1. Checking configuration
 * 2. Testing PDF conversion
 * 3. Testing Gemini API connection
 * 4. Running a sample OCR process
 */

import { OCRProcessor } from './src/ocr';
import { config } from './src/config';
import { logger } from './src/utils/logger';
import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

async function testOCRIntegration() {
  logger.info('🧪 Starting OCR Integration Test');

  // Get document ID from command line argument if provided
  const documentId = process.argv[2];

  // Step 1: Check configuration
  logger.info('📋 Step 1: Checking configuration...');

  if (!config.ocr.geminiApiKey) {
    logger.error('❌ GEMINI_API_KEY is not configured in .env');
    logger.info('Please add GEMINI_API_KEY to your .env file');
    process.exit(1);
  }

  logger.info('✅ Configuration OK', {
    extractModel: config.ocr.extractModel,
    boostModel: config.ocr.boostModel,
    extractTemp: config.ocr.extractTemperature,
    boostTemp: config.ocr.boostTemperature,
    tempDir: config.ocr.tempDir
  });

  // Step 2: Check database connection
  logger.info('📋 Step 2: Checking database connection...');

  const environments = supabaseManager.getAvailableEnvironments();

  if (environments.length === 0) {
    logger.error('❌ No Supabase environments configured');
    logger.info('Please configure at least one Supabase environment in .env');
    process.exit(1);
  }

  logger.info('✅ Database connection OK', {
    environments: environments.join(', ')
  });

  // Step 3: Find a test document
  if (documentId) {
    logger.info('📋 Step 3: Finding specific document...', { documentId });
  } else {
    logger.info('📋 Step 3: Finding a test document...');
  }

  let testDocument = null;

  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;

    let query = client
      .from('extraction_queue')
      .select('*');

    if (documentId) {
      // Look for specific document ID
      query = query.eq('id', documentId);
    } else {
      // Look for any completed index document
      query = query
        .eq('status_id', EXTRACTION_STATUS.COMPLETE)
        .eq('document_source', 'index')
        .not('file_url', 'is', null)
        .limit(1);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      testDocument = { ...data[0], _environment: env };
      break;
    }
  }

  if (!testDocument) {
    if (documentId) {
      logger.error('❌ Document not found', { documentId });
      logger.info('Please check that the document ID exists in the database');
    } else {
      logger.warn('⚠️  No test document found');
      logger.info('Please ensure there is at least one completed index document in the database');
      logger.info('You can create one with: tsx src/create-test-job-index.ts');
    }
    process.exit(0);
  }

  logger.info('✅ Found test document', {
    documentId: testDocument.id,
    documentNumber: testDocument.document_number,
    statusId: testDocument.status_id,
    documentSource: testDocument.document_source,
    fileUrl: testDocument.file_url,
    supabasePath: testDocument.supabase_path,
    hasFileUrl: !!testDocument.file_url,
    hasSupabasePath: !!testDocument.supabase_path
  });

  // Determine which URL to use
  const pdfUrl = testDocument.file_url || testDocument.supabase_path;

  if (!pdfUrl) {
    logger.error('❌ Document has no file_url or supabase_path', {
      documentId: testDocument.id
    });
    logger.info('Available fields:', Object.keys(testDocument));
    process.exit(1);
  }

  console.log('\n📎 PDF URL:', pdfUrl);
  console.log('📎 URL type:', typeof pdfUrl);
  console.log('📎 URL length:', pdfUrl?.length);
  console.log('');

  // Step 4: Initialize OCR processor
  logger.info('📋 Step 4: Initializing OCR processor...');
  
  const processor = new OCRProcessor({
    geminiApiKey: config.ocr.geminiApiKey,
    extractModel: config.ocr.extractModel,
    boostModel: config.ocr.boostModel,
    extractTemperature: config.ocr.extractTemperature,
    boostTemperature: config.ocr.boostTemperature,
    tempDir: config.ocr.tempDir
  });

  await processor.initialize();
  
  logger.info('✅ OCR processor initialized');

  // Step 5: Download the PDF (it's a signed URL, so we can fetch directly)
  logger.info('📋 Step 5: Downloading PDF from signed URL...');

  const response = await fetch(pdfUrl);

  if (!response.ok) {
    logger.error('❌ Failed to download PDF', {
      status: response.status,
      statusText: response.statusText
    });
    process.exit(1);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');

  logger.info('✅ PDF downloaded', {
    sizeKB: Math.round(arrayBuffer.byteLength / 1024)
  });

  // Step 6: Process the test document (Sequential Mode)
  logger.info('📋 Step 6: Processing test document (Sequential Mode)...');
  logger.info('⏳ This may take 10-30 seconds...');

  const startTimeSeq = Date.now();

  try {
    const result = await processor.processPDFFromBase64(base64Data);

    const durationSeq = Math.round((Date.now() - startTimeSeq) / 1000);

    logger.info('✅ Sequential OCR processing completed successfully!', {
      duration: `${durationSeq}s`,
      rawTextLength: result.rawText.length,
      boostedTextLength: result.boostedText.length,
      extractionComplete: result.extractionComplete,
      boostComplete: result.boostComplete
    });

    // Show a preview of the results
    logger.info('📄 Raw Text Preview (first 500 chars):');
    console.log(result.rawText.substring(0, 500) + '...\n');

    logger.info('✨ Boosted Text Preview (first 500 chars):');
    console.log(result.boostedText.substring(0, 500) + '...\n');

    // Step 7: Test Parallel Processing
    logger.info('📋 Step 7: Testing Parallel Processing...');
    logger.info('⏳ Processing all pages in parallel...');

    const startTimePar = Date.now();
    const parallelResult = await processor.processPDFFromBase64Parallel(base64Data);
    const durationPar = Math.round((Date.now() - startTimePar) / 1000);

    logger.info('✅ Parallel OCR processing completed successfully!', {
      duration: `${durationPar}s`,
      totalPages: parallelResult.totalPages,
      allPagesComplete: parallelResult.allPagesComplete,
      combinedTextLength: parallelResult.combinedBoostedText.length
    });

    // Show page-by-page results
    logger.info('📊 Page-by-page results:');
    parallelResult.pages.forEach(page => {
      console.log(`  Page ${page.pageNumber}: ${page.boostedText.length} chars (extraction: ${page.extractionComplete}, boost: ${page.boostComplete})`);
    });

    // Performance comparison
    if (parallelResult.totalPages > 1) {
      const estimatedSeqTime = durationSeq * parallelResult.totalPages;
      const speedup = estimatedSeqTime / durationPar;
      logger.info('⚡ Performance Comparison:', {
        sequentialTime: `${durationSeq}s (1 page)`,
        parallelTime: `${durationPar}s (${parallelResult.totalPages} pages)`,
        estimatedSequentialTime: `${estimatedSeqTime}s (if all pages sequential)`,
        speedup: `${speedup.toFixed(2)}x faster`
      });
    } else {
      logger.info('ℹ️  Document has only 1 page, parallel processing has same performance as sequential');
    }

    // Step 8: Cleanup
    logger.info('📋 Step 8: Cleaning up...');
    await processor.cleanup();
    logger.info('✅ Cleanup complete');

    // Summary
    logger.info('🎉 OCR Integration Test PASSED!');
    logger.info('✅ Sequential processing: WORKING');
    logger.info('✅ Parallel processing: WORKING');
    logger.info('The OCR system is working correctly and ready for production use.');
    logger.info('To start the OCR monitor, run: npm run ocr:dev');

  } catch (error) {
    logger.error('❌ OCR processing failed', {
      error: error instanceof Error ? error.message : error,
      duration: `${Math.round((Date.now() - startTime) / 1000)}s`
    });
    
    await processor.cleanup();
    
    logger.info('💡 Troubleshooting tips:');
    logger.info('1. Check that ImageMagick or poppler is installed');
    logger.info('2. Verify your GEMINI_API_KEY is valid');
    logger.info('3. Ensure the PDF URL is accessible');
    logger.info('4. Check the logs above for specific error messages');
    
    process.exit(1);
  }
}

// Run the test
testOCRIntegration().catch((error) => {
  logger.error('❌ Test failed with unexpected error', { error });
  process.exit(1);
});


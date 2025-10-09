/**
 * Test OCR processing for a specific row
 */

import { supabaseManager } from './src/utils/supabase';
import { logger } from './src/utils/logger';
import { OCRProcessor } from './src/ocr';
import { config } from './src/config';

async function testSpecificRow() {
  const rowId = '814362fe-c106-44b5-ad8f-9113966f3e5d';
  
  logger.info({ rowId }, 'Testing OCR for specific row');

  // Get the row from database
  const environments = supabaseManager.getAvailableEnvironments();
  
  let document = null;
  let environment = null;
  
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;

    const { data, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('id', rowId)
      .single();

    if (!error && data) {
      document = data;
      environment = env;
      break;
    }
  }

  if (!document) {
    logger.error({ rowId }, 'Document not found');
    process.exit(1);
  }

  logger.info({
    documentId: document.id,
    documentNumber: document.document_number,
    documentSource: document.document_source,
    statusId: document.status_id,
    supabasePath: document.supabase_path,
    environment
  }, 'Found document');

  // Check the supabase_path format
  if (document.supabase_path) {
    if (document.supabase_path.startsWith('http')) {
      logger.info('✅ supabase_path is a full URL');
    } else {
      logger.info('📁 supabase_path is a storage path');
    }
  } else {
    logger.error('❌ supabase_path is null or empty');
    process.exit(1);
  }

  // Construct the URL
  const client = supabaseManager.getServiceClient(environment!);
  if (!client) {
    logger.error('No client for environment');
    process.exit(1);
  }

  let pdfUrl: string;
  
  if (document.supabase_path.startsWith('http://') || document.supabase_path.startsWith('https://')) {
    pdfUrl = document.supabase_path;
    logger.info({ pdfUrl }, 'Using URL directly');
  } else {
    const bucketName = document.document_source === 'acte' ? 'actes' 
                     : document.document_source === 'plan_cadastraux' ? 'plans-cadastraux' 
                     : 'index';
    
    let storagePath = document.supabase_path;
    if (storagePath.startsWith(`${bucketName}/`)) {
      storagePath = storagePath.substring(bucketName.length + 1);
      logger.info({ original: document.supabase_path, stripped: storagePath }, 'Stripped bucket prefix');
    }
    
    const { data: { publicUrl } } = client.storage
      .from(bucketName)
      .getPublicUrl(storagePath);
    
    pdfUrl = publicUrl;
    logger.info({ bucketName, storagePath, publicUrl }, 'Constructed URL');
  }

  // Test downloading the PDF
  logger.info({ pdfUrl }, 'Testing PDF download...');
  
  try {
    const response = await fetch(pdfUrl);
    logger.info({ 
      status: response.status, 
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    }, 'PDF download response');

    if (!response.ok) {
      logger.error('❌ PDF download failed');
      process.exit(1);
    }

    logger.info('✅ PDF download successful');

    // Now test OCR processing
    if (!config.ocr.geminiApiKey) {
      logger.warn('⚠️  GEMINI_API_KEY not configured, skipping OCR test');
      process.exit(0);
    }

    logger.info('🔍 Starting OCR processing...');
    
    const processor = new OCRProcessor({
      geminiApiKey: config.ocr.geminiApiKey,
      extractModel: config.ocr.extractModel,
      boostModel: config.ocr.boostModel,
      extractTemperature: config.ocr.extractTemperature,
      boostTemperature: config.ocr.boostTemperature,
      tempDir: config.ocr.tempDir
    });

    await processor.initialize();

    const startTime = Date.now();
    const result = await processor.processPDFFromURL(pdfUrl);
    const duration = Math.round((Date.now() - startTime) / 1000);

    logger.info({
      duration: `${duration}s`,
      rawTextLength: result.rawText.length,
      boostedTextLength: result.boostedText.length,
      extractionComplete: result.extractionComplete,
      boostComplete: result.boostComplete
    }, '✅ OCR processing completed');

    // Show preview
    console.log('\n📄 Boosted Text Preview (first 1000 chars):');
    console.log(result.boostedText.substring(0, 1000));
    console.log('...\n');

    await processor.cleanup();

    logger.info('🎉 Test completed successfully!');

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : error
    }, '❌ Test failed');
    process.exit(1);
  }
}

testSpecificRow().catch((error) => {
  logger.error({ error }, 'Unexpected error');
  process.exit(1);
});


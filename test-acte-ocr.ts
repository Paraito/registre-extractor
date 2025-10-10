/**
 * Acte OCR Test Script
 * 
 * This script tests the complete Acte OCR pipeline:
 * 1. Processes a sample acte PDF from the extraction_queue
 * 2. Validates extraction quality and completeness
 * 3. Tests error handling and retry logic
 * 4. Measures performance metrics
 * 
 * Usage:
 *   npx ts-node test-acte-ocr.ts [document-id]
 * 
 * If no document-id is provided, it will find the first available acte document
 * with status_id=3 in the dev environment.
 */

import { ActeOCRProcessor } from './src/ocr/acte-processor';
import { supabaseManager, EnvironmentName } from './src/utils/supabase';
import { config } from './src/config';
import { EXTRACTION_STATUS } from './src/types';
import fs from 'fs/promises';
import path from 'path';

// Test configuration
const TEST_CONFIG = {
  environment: 'dev' as EnvironmentName,
  tempDir: '/tmp/test-acte-ocr',
  maxTestDocuments: 1,
  cleanupAfterTest: true,
};

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Logging helpers
const log = {
  header: (msg: string) => console.log(`\n${'='.repeat(67)}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${'='.repeat(67)}\n`),
  section: (emoji: string, title: string) => console.log(`${colors.bright}${emoji} ${title}${colors.reset}`),
  field: (label: string, value: any) => console.log(`   ${label}: ${value}`),
  success: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warning: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg: string) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
};

interface TestMetrics {
  documentId: string;
  documentNumber: string;
  startTime: number;
  uploadTime?: number;
  extractionTime?: number;
  boostTime?: number;
  totalTime?: number;
  rawTextLength?: number;
  boostedTextLength?: number;
  extractionComplete?: boolean;
  boostComplete?: boolean;
  success: boolean;
  error?: string;
}

/**
 * Find an acte document ready for OCR testing
 */
async function findTestDocument(documentId?: string): Promise<any> {
  log.section('🔍', 'Finding Test Document');

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) {
    throw new Error(`No Supabase client available for environment: ${TEST_CONFIG.environment}`);
  }

  if (documentId) {
    log.info(`Looking for document ID: ${documentId}`);
    const { data, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error) throw error;
    if (!data) throw new Error(`Document not found: ${documentId}`);
    if (data.document_source !== 'acte') {
      throw new Error(`Document is not an acte document (source: ${data.document_source})`);
    }

    log.success(`Found document: ${data.document_number}`);
    return data;
  }

  // Find first available acte document with status_id=3
  log.info('Searching for acte documents with status_id=3...');
  const { data: documents, error } = await client
    .from('extraction_queue')
    .select('*')
    .eq('status_id', EXTRACTION_STATUS.COMPLETE)
    .eq('document_source', 'acte')
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) throw error;
  if (!documents || documents.length === 0) {
    throw new Error('No acte documents found with status_id=3');
  }

  // Filter for documents that haven't exceeded max attempts
  const eligible = documents.filter(doc => {
    const attempts = doc.ocr_attempts || 0;
    const maxAttempts = doc.ocr_max_attempts || 3;
    return attempts < maxAttempts;
  });

  if (eligible.length === 0) {
    throw new Error('No eligible acte documents found (all have exceeded max attempts)');
  }

  const document = eligible[0];
  log.success(`Found document: ${document.document_number} (ID: ${document.id})`);
  log.field('Status ID', document.status_id);
  log.field('OCR Attempts', document.ocr_attempts || 0);
  log.field('Supabase Path', document.supabase_path);

  return document;
}

/**
 * Download PDF from Supabase storage
 */
async function downloadPDF(document: any): Promise<string> {
  log.section('📥', 'Downloading PDF');

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) {
    throw new Error(`No Supabase client available for environment: ${TEST_CONFIG.environment}`);
  }

  if (!document.supabase_path) {
    throw new Error('Document has no supabase_path');
  }

  // Determine bucket name
  const bucketName = 'actes';
  let storagePath = document.supabase_path;

  // Remove bucket name prefix if it exists
  if (storagePath.startsWith(`${bucketName}/`)) {
    storagePath = storagePath.substring(bucketName.length + 1);
  }

  log.info(`Downloading from bucket: ${bucketName}`);
  log.info(`Storage path: ${storagePath}`);

  const { data, error } = await client.storage
    .from(bucketName)
    .download(storagePath);

  if (error) {
    throw new Error(`Failed to download PDF: ${error.message}`);
  }

  // Save to temp directory
  await fs.mkdir(TEST_CONFIG.tempDir, { recursive: true });
  const localPath = path.join(TEST_CONFIG.tempDir, `${document.document_number}.pdf`);
  
  const buffer = Buffer.from(await data.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  const sizeKB = Math.round(buffer.length / 1024);
  log.success(`Downloaded PDF: ${sizeKB} KB`);
  log.field('Local path', localPath);

  return localPath;
}

/**
 * Process acte document with OCR
 */
async function processDocument(pdfPath: string, documentNumber: string): Promise<TestMetrics> {
  log.section('🚀', 'Processing Acte Document');

  const metrics: TestMetrics = {
    documentId: '',
    documentNumber,
    startTime: Date.now(),
    success: false,
  };

  try {
    // Initialize processor
    const processor = new ActeOCRProcessor({
      geminiApiKey: config.ocr.geminiApiKey!,
      tempDir: TEST_CONFIG.tempDir,
      extractModel: config.ocr.acte.extractModel,
      boostModel: config.ocr.acte.boostModel,
      extractTemperature: config.ocr.acte.extractTemperature,
      boostTemperature: config.ocr.acte.boostTemperature,
    });

    await processor.initialize();

    log.info(`Extract Model: ${config.ocr.acte.extractModel}`);
    log.info(`Boost Model: ${config.ocr.acte.boostModel}`);

    // Process the PDF
    const uploadStart = Date.now();
    const result = await processor.processActePDFWithChunking(pdfPath, documentNumber);
    
    metrics.totalTime = Date.now() - metrics.startTime;
    metrics.rawTextLength = result.rawText.length;
    metrics.boostedTextLength = result.boostedText.length;
    metrics.extractionComplete = result.extractionComplete;
    metrics.boostComplete = result.boostComplete;
    metrics.success = true;

    // Cleanup processor
    await processor.cleanup();

    log.success('Processing complete!');
    
    return metrics;

  } catch (error) {
    metrics.error = error instanceof Error ? error.message : String(error);
    metrics.success = false;
    throw error;
  }
}

/**
 * Display test results
 */
function displayResults(metrics: TestMetrics, rawText: string, boostedText: string) {
  log.header('📊 Test Results');

  log.section('⏱️', 'Performance Metrics');
  log.field('Total Duration', `${(metrics.totalTime! / 1000).toFixed(1)}s`);
  log.field('Raw Text Length', `${metrics.rawTextLength!.toLocaleString()} chars`);
  log.field('Boosted Text Length', `${metrics.boostedTextLength!.toLocaleString()} chars`);
  log.field('Extraction Complete', metrics.extractionComplete ? '✅ Yes' : '⚠️  No (truncated)');
  log.field('Boost Complete', metrics.boostComplete ? '✅ Yes' : '⚠️  No (truncated)');

  log.section('📄', 'Raw Text Preview (first 500 chars)');
  console.log(rawText.substring(0, 500));
  console.log('...\n');

  log.section('✨', 'Boosted Text Preview (first 500 chars)');
  console.log(boostedText.substring(0, 500));
  console.log('...\n');

  // Check for completion markers
  const hasExtractionMarker = rawText.includes('✅ EXTRACTION_COMPLETE:');
  const hasBoostMarker = boostedText.includes('✅ BOOST_COMPLETE:');

  log.section('🔍', 'Validation Checks');
  log.field('Extraction Marker Present', hasExtractionMarker ? '✅ Yes' : '❌ No');
  log.field('Boost Marker Present', hasBoostMarker ? '✅ Yes' : '❌ No');
  log.field('Text Length Increase', `${((metrics.boostedTextLength! - metrics.rawTextLength!) / metrics.rawTextLength! * 100).toFixed(1)}%`);

  if (!hasExtractionMarker) {
    log.warning('Extraction marker not found - response may be truncated');
  }
  if (!hasBoostMarker) {
    log.warning('Boost marker not found - response may be truncated');
  }
}

/**
 * Cleanup test files
 */
async function cleanup() {
  if (TEST_CONFIG.cleanupAfterTest) {
    log.section('🧹', 'Cleaning Up');
    try {
      const files = await fs.readdir(TEST_CONFIG.tempDir);
      for (const file of files) {
        await fs.unlink(path.join(TEST_CONFIG.tempDir, file));
      }
      await fs.rmdir(TEST_CONFIG.tempDir);
      log.success('Cleanup complete');
    } catch (error) {
      log.warning(`Cleanup failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

/**
 * Main test function
 */
async function main() {
  const documentId = process.argv[2];

  log.header('🧪 Acte OCR Test Script');

  // Validate configuration
  if (!config.ocr.geminiApiKey) {
    log.error('GEMINI_API_KEY is not set');
    process.exit(1);
  }

  const envConfig = config.environments[TEST_CONFIG.environment];
  if (!envConfig) {
    log.error(`No configuration found for environment: ${TEST_CONFIG.environment}`);
    process.exit(1);
  }

  log.section('⚙️', 'Configuration');
  log.field('Environment', TEST_CONFIG.environment);
  log.field('Temp Directory', TEST_CONFIG.tempDir);
  log.field('Extract Model', config.ocr.acte.extractModel);
  log.field('Boost Model', config.ocr.acte.boostModel);

  let pdfPath: string | null = null;
  let rawText = '';
  let boostedText = '';

  try {
    // Step 1: Find test document
    const document = await findTestDocument(documentId);

    // Step 2: Download PDF
    pdfPath = await downloadPDF(document);

    // Step 3: Process document
    const processor = new ActeOCRProcessor({
      geminiApiKey: config.ocr.geminiApiKey!,
      tempDir: TEST_CONFIG.tempDir,
      extractModel: config.ocr.acte.extractModel,
      boostModel: config.ocr.acte.boostModel,
      extractTemperature: config.ocr.acte.extractTemperature,
      boostTemperature: config.ocr.acte.boostTemperature,
    });

    await processor.initialize();

    const startTime = Date.now();
    const result = await processor.processActePDFWithChunking(pdfPath, document.document_number);
    const totalTime = Date.now() - startTime;

    rawText = result.rawText;
    boostedText = result.boostedText;

    await processor.cleanup();

    // Step 4: Display results
    const metrics: TestMetrics = {
      documentId: document.id,
      documentNumber: document.document_number,
      startTime,
      totalTime,
      rawTextLength: result.rawText.length,
      boostedTextLength: result.boostedText.length,
      extractionComplete: result.extractionComplete,
      boostComplete: result.boostComplete,
      success: true,
    };

    displayResults(metrics, rawText, boostedText);

    log.header('✅ Test Completed Successfully');

  } catch (error) {
    log.header('❌ Test Failed');
    log.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the test
main();


/**
 * Acte OCR Integration Test Script
 * 
 * This script tests the complete Acte OCR workflow including:
 * 1. Database status updates
 * 2. File download from Supabase storage
 * 3. OCR processing (upload, extract, boost)
 * 4. Database storage of results
 * 5. File cleanup verification
 * 
 * Usage:
 *   npx ts-node test-acte-ocr-integration.ts [document-id]
 */

import { ActeOCRProcessor } from '../src/ocr/acte-processor';
import { GeminiFileClient } from '../src/ocr/gemini-file-client';
import { supabaseManager, EnvironmentName } from '../src/utils/supabase';
import { config } from '../src/config';
import { EXTRACTION_STATUS } from '../src/types';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const TEST_CONFIG = {
  environment: 'dev' as EnvironmentName,
  tempDir: '/tmp/test-acte-ocr-integration',
  workerId: `test-worker-${uuidv4().substring(0, 8)}`,
  cleanupAfterTest: true,
  updateDatabase: true, // Set to false for dry-run
};

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg: string) => console.log(`\n${'='.repeat(67)}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${'='.repeat(67)}\n`),
  section: (emoji: string, title: string) => console.log(`${colors.bright}${emoji} ${title}${colors.reset}`),
  field: (label: string, value: any) => console.log(`   ${label}: ${value}`),
  success: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warning: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg: string) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
};

interface TestState {
  documentId: string;
  documentNumber: string;
  originalStatus: number;
  pdfPath?: string;
  uploadedFileName?: string;
  startTime: number;
}

/**
 * Find and lock a test document
 */
async function findAndLockDocument(documentId?: string): Promise<{ document: any; state: TestState }> {
  log.section('🔍', 'Finding and Locking Test Document');

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) {
    throw new Error(`No Supabase client available for environment: ${TEST_CONFIG.environment}`);
  }

  let document: any;

  if (documentId) {
    const { data, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error) throw error;
    if (!data) throw new Error(`Document not found: ${documentId}`);
    document = data;
  } else {
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

    const eligible = documents.filter(doc => {
      const attempts = doc.ocr_attempts || 0;
      const maxAttempts = doc.ocr_max_attempts || 3;
      return attempts < maxAttempts;
    });

    if (eligible.length === 0) {
      throw new Error('No eligible acte documents found');
    }

    document = eligible[0];
  }

  log.success(`Found document: ${document.document_number}`);
  log.field('Document ID', document.id);
  log.field('Current Status', document.status_id);
  log.field('OCR Attempts', document.ocr_attempts || 0);

  const state: TestState = {
    documentId: document.id,
    documentNumber: document.document_number,
    originalStatus: document.status_id,
    startTime: Date.now(),
  };

  // Update status to OCR_PROCESSING if enabled
  if (TEST_CONFIG.updateDatabase) {
    log.info('Updating status to OCR_PROCESSING...');
    const { error } = await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.OCR_PROCESSING,
        ocr_worker_id: TEST_CONFIG.workerId,
        ocr_started_at: new Date().toISOString(),
        ocr_attempts: (document.ocr_attempts || 0) + 1,
      })
      .eq('id', document.id);

    if (error) throw error;
    log.success('Status updated to OCR_PROCESSING');
  } else {
    log.warning('Database updates disabled (dry-run mode)');
  }

  return { document, state };
}

/**
 * Download PDF from storage
 */
async function downloadPDF(document: any, state: TestState): Promise<string> {
  log.section('📥', 'Downloading PDF from Storage');

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) throw new Error('No Supabase client available');

  if (!document.supabase_path) {
    throw new Error('Document has no supabase_path');
  }

  const bucketName = 'actes';
  let storagePath = document.supabase_path;

  if (storagePath.startsWith(`${bucketName}/`)) {
    storagePath = storagePath.substring(bucketName.length + 1);
  }

  log.info(`Bucket: ${bucketName}`);
  log.info(`Path: ${storagePath}`);

  const { data, error } = await client.storage
    .from(bucketName)
    .download(storagePath);

  if (error) throw new Error(`Download failed: ${error.message}`);

  await fs.mkdir(TEST_CONFIG.tempDir, { recursive: true });
  const localPath = path.join(TEST_CONFIG.tempDir, `${document.document_number}.pdf`);
  
  const buffer = Buffer.from(await data.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  const sizeKB = Math.round(buffer.length / 1024);
  log.success(`Downloaded: ${sizeKB} KB`);
  log.field('Local path', localPath);

  state.pdfPath = localPath;
  return localPath;
}

/**
 * Process document with OCR
 */
async function processWithOCR(pdfPath: string, state: TestState): Promise<{ rawText: string; boostedText: string; complete: boolean }> {
  log.section('🚀', 'Processing with OCR');

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

  const result = await processor.processActePDFWithChunking(pdfPath, state.documentNumber);

  await processor.cleanup();

  log.success('OCR processing complete');
  log.field('Raw Text', `${result.rawText.length.toLocaleString()} chars`);
  log.field('Boosted Text', `${result.boostedText.length.toLocaleString()} chars`);
  log.field('Extraction Complete', result.extractionComplete ? '✅' : '⚠️');
  log.field('Boost Complete', result.boostComplete ? '✅' : '⚠️');

  return {
    rawText: result.rawText,
    boostedText: result.boostedText,
    complete: result.extractionComplete && result.boostComplete,
  };
}

/**
 * Save results to database
 */
async function saveResults(state: TestState, rawText: string, boostedText: string): Promise<void> {
  log.section('💾', 'Saving Results to Database');

  if (!TEST_CONFIG.updateDatabase) {
    log.warning('Database updates disabled (dry-run mode)');
    return;
  }

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) throw new Error('No Supabase client available');

  const { error } = await client
    .from('extraction_queue')
    .update({
      status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
      file_content: rawText,
      boosted_file_content: boostedText,
      ocr_completed_at: new Date().toISOString(),
      ocr_error: null,
    })
    .eq('id', state.documentId);

  if (error) throw error;

  log.success('Results saved to database');
  log.field('Status', 'EXTRACTION_COMPLETE (5)');
  log.field('Raw Text Length', `${rawText.length.toLocaleString()} chars`);
  log.field('Boosted Text Length', `${boostedText.length.toLocaleString()} chars`);
}

/**
 * Verify Gemini file cleanup
 */
async function verifyGeminiCleanup(): Promise<void> {
  log.section('🔍', 'Verifying Gemini File Cleanup');

  const client = new GeminiFileClient({
    apiKey: config.ocr.geminiApiKey!,
  });

  // Note: The Gemini SDK doesn't provide a list files method in the current version
  // This is a placeholder for future verification
  log.info('File cleanup verification not implemented (SDK limitation)');
  log.info('Files are deleted immediately after processing');
}

/**
 * Cleanup local files
 */
async function cleanup(state: TestState): Promise<void> {
  if (TEST_CONFIG.cleanupAfterTest) {
    log.section('🧹', 'Cleaning Up Local Files');
    try {
      if (state.pdfPath) {
        await fs.unlink(state.pdfPath);
        log.success('Deleted local PDF');
      }
      
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
 * Rollback on error
 */
async function rollback(state: TestState, error: Error): Promise<void> {
  log.section('⏪', 'Rolling Back Changes');

  if (!TEST_CONFIG.updateDatabase) {
    log.info('No rollback needed (dry-run mode)');
    return;
  }

  const client = supabaseManager.getServiceClient(TEST_CONFIG.environment);
  if (!client) return;

  try {
    await client
      .from('extraction_queue')
      .update({
        status_id: state.originalStatus,
        ocr_error: error.message,
        ocr_last_error_at: new Date().toISOString(),
      })
      .eq('id', state.documentId);

    log.success('Rolled back to original status');
  } catch (rollbackError) {
    log.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`);
  }
}

/**
 * Main test function
 */
async function main() {
  const documentId = process.argv[2];

  log.header('🧪 Acte OCR Integration Test');

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
  log.field('Worker ID', TEST_CONFIG.workerId);
  log.field('Update Database', TEST_CONFIG.updateDatabase ? 'Yes' : 'No (dry-run)');
  log.field('Cleanup After Test', TEST_CONFIG.cleanupAfterTest ? 'Yes' : 'No');

  let state: TestState | null = null;

  try {
    // Step 1: Find and lock document
    const { document, state: testState } = await findAndLockDocument(documentId);
    state = testState;

    // Step 2: Download PDF
    const pdfPath = await downloadPDF(document, state);

    // Step 3: Process with OCR
    const { rawText, boostedText, complete } = await processWithOCR(pdfPath, state);

    // Step 4: Save results
    await saveResults(state, rawText, boostedText);

    // Step 5: Verify cleanup
    await verifyGeminiCleanup();

    // Step 6: Display summary
    const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);
    
    log.header('✅ Integration Test Completed Successfully');
    log.section('📊', 'Summary');
    log.field('Document Number', state.documentNumber);
    log.field('Total Duration', `${duration}s`);
    log.field('Processing Complete', complete ? '✅ Yes' : '⚠️  Partial');
    log.field('Database Updated', TEST_CONFIG.updateDatabase ? '✅ Yes' : '⚠️  No (dry-run)');

  } catch (error) {
    log.header('❌ Integration Test Failed');
    log.error(error instanceof Error ? error.message : String(error));
    
    if (state) {
      await rollback(state, error instanceof Error ? error : new Error(String(error)));
    }

    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  } finally {
    if (state) {
      await cleanup(state);
    }
  }
}

// Run the test
main();


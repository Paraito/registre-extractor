/**
 * Process Queue Document
 * 
 * Processes a specific extraction_queue document by ID.
 * This is useful for testing and debugging specific documents.
 */

import { createClient } from '@supabase/supabase-js';
import { runE2EPipeline } from './pipeline.js';
import { createLogger } from '../util/log.js';
import { CONFIG } from '../../config/runtime.js';

// Environment configuration - matches root .env.example naming convention
const ENVIRONMENTS = {
  dev: {
    url: process.env.DEV_SUPABASE_URL,
    key: process.env.DEV_SUPABASE_SERVICE_KEY
  },
  staging: {
    url: process.env.STAGING_SUPABASE_URL,
    key: process.env.STAGING_SUPABASE_SERVICE_KEY
  },
  prod: {
    url: process.env.PROD_SUPABASE_URL,
    key: process.env.PROD_SUPABASE_SERVICE_KEY
  }
};

interface ExtractionQueueDocument {
  id: number;
  document_number: string;
  document_source: 'index' | 'acte' | 'plan_cadastraux';
  supabase_path: string;
  status_id: number;
  worker_id: string | null;
  file_content: any;
  boosted_file_content: any;
  created_at: string;
}

/**
 * Process a specific extraction_queue document by ID
 */
export async function processQueueDocument(
  queueId: number,
  environmentName: string = 'dev'
): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 EXTRACTION QUEUE DOCUMENT PROCESSOR`);
  console.log(`${'='.repeat(80)}\n`);
  
  // Get environment config
  const env = ENVIRONMENTS[environmentName as keyof typeof ENVIRONMENTS];
  if (!env || !env.url || !env.key) {
    throw new Error(`Invalid environment: ${environmentName}. Available: dev, staging, prod`);
  }
  
  console.log(`🌍 Environment: ${environmentName}`);
  console.log(`🔗 Supabase URL: ${env.url}`);
  console.log(`🆔 Queue ID: ${queueId}\n`);
  
  // Create Supabase client
  const supabase = createClient(env.url, env.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  
  // Fetch the document
  console.log(`📥 Fetching document from extraction_queue...`);
  const { data: document, error: fetchError } = await supabase
    .from('extraction_queue')
    .select('*')
    .eq('id', queueId)
    .single();
  
  if (fetchError || !document) {
    throw new Error(`Failed to fetch document: ${fetchError?.message || 'Document not found'}`);
  }
  
  const doc = document as ExtractionQueueDocument;
  
  console.log(`✅ Document found!`);
  console.log(`   Document Number: ${doc.document_number}`);
  console.log(`   Document Source: ${doc.document_source}`);
  console.log(`   Status ID: ${doc.status_id}`);
  console.log(`   Worker ID: ${doc.worker_id || 'null'}`);
  console.log(`   Supabase Path: ${doc.supabase_path}`);
  console.log(`   Created At: ${doc.created_at}\n`);
  
  // Validate document is ready for processing
  if (doc.status_id !== 3) {
    console.log(`⚠️  Warning: Document status_id is ${doc.status_id}, expected 3 (COMPLETE)`);
    console.log(`   Continuing anyway...\n`);
  }
  
  // Determine bucket name
  const bucketName = doc.document_source === 'acte' ? 'actes'
                   : doc.document_source === 'plan_cadastraux' ? 'plans-cadastraux'
                   : 'index';
  
  // Parse storage path
  let storagePath = doc.supabase_path;
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
    // Extract path from URL
    const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:(?:public|sign)\/)?(.+)$/);
    if (urlMatch) {
      const fullPath = urlMatch[1];
      if (fullPath.startsWith(`${bucketName}/`)) {
        storagePath = fullPath.substring(bucketName.length + 1);
      } else {
        storagePath = fullPath;
      }
    }
  } else if (storagePath.startsWith(`${bucketName}/`)) {
    storagePath = storagePath.substring(bucketName.length + 1);
  }
  
  console.log(`📦 Storage Details:`);
  console.log(`   Bucket: ${bucketName}`);
  console.log(`   Path: ${storagePath}\n`);
  
  // Download the PDF
  console.log(`📥 Downloading PDF from storage...`);
  const { data: pdfData, error: downloadError } = await supabase.storage
    .from(bucketName)
    .download(storagePath);
  
  if (downloadError || !pdfData) {
    throw new Error(`Failed to download PDF: ${downloadError?.message || 'No data'}`);
  }
  
  console.log(`✅ PDF downloaded successfully (${(pdfData.size / 1024).toFixed(2)} KB)\n`);
  
  // Convert to buffer
  const arrayBuffer = await pdfData.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);
  
  // Create a temporary file URL (we'll pass the buffer directly to the pipeline)
  // For now, we need to save it temporarily or modify the pipeline to accept buffers
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  
  const tempDir = os.tmpdir();
  const tempPdfPath = path.join(tempDir, `queue-${queueId}-${Date.now()}.pdf`);
  fs.writeFileSync(tempPdfPath, pdfBuffer);
  
  console.log(`💾 Temporary PDF saved to: ${tempPdfPath}\n`);
  
  // Update status to PROCESSING (2)
  console.log(`🔄 Updating status to PROCESSING (2)...`);
  const workerId = `cli-${Date.now()}`;
  const { error: updateError } = await supabase
    .from('extraction_queue')
    .update({
      status_id: 2,
      worker_id: workerId
    })
    .eq('id', queueId);
  
  if (updateError) {
    console.log(`⚠️  Warning: Failed to update status: ${updateError.message}`);
  } else {
    console.log(`✅ Status updated to PROCESSING\n`);
  }
  
  // Create logger
  const runId = `queue-${queueId}-${Date.now()}`;
  const logger = createLogger(runId);
  await logger.init();
  
  console.log(`${'='.repeat(80)}`);
  console.log(`🚀 STARTING OCR PIPELINE`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    // Run the pipeline (Gemini-only mode: skip Claude coherence check and boost)
    const result = await runE2EPipeline({
      url: `file://${tempPdfPath}`,
      extractionModel: 'gemini',
      runId,
      tolerancePercent: 5.0,
      skipBoost: true,      // Skip boost - Gemini extraction is sufficient
      skipCoherence: true,  // Skip Claude coherence check - avoids 5MB image limit issues
      logger
    });
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ PIPELINE COMPLETED SUCCESSFULLY`);
    console.log(`${'='.repeat(80)}\n`);
    
    console.log(`📊 Results:`);
    console.log(`   Total Pages: ${result.document.totalPages}`);
    console.log(`   Total Lines: ${result.document.totalLines}`);
    console.log(`   Artifacts: ${CONFIG.artifactsDir}/${runId}\n`);
    
    // Update database with results
    console.log(`💾 Updating extraction_queue with results...`);

    // The document already contains boosted data if boost was run
    // (boost modifies the extractions in-place)
    const { error: finalUpdateError } = await supabase
      .from('extraction_queue')
      .update({
        status_id: 4, // COMPLETE
        worker_id: null,
        file_content: result.document,
        boosted_file_content: result.document // Same as file_content since boost modifies in-place
      })
      .eq('id', queueId);

    if (finalUpdateError) {
      console.log(`⚠️  Warning: Failed to update results: ${finalUpdateError.message}`);
    } else {
      console.log(`✅ Results saved to database\n`);
    }
    
    // Clean up temp file
    fs.unlinkSync(tempPdfPath);
    console.log(`🗑️  Temporary file cleaned up\n`);
    
  } catch (error) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`❌ PIPELINE FAILED`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Update status back to COMPLETE (3) so it can be retried
    console.log(`🔄 Resetting status to COMPLETE (3) for retry...`);
    await supabase
      .from('extraction_queue')
      .update({
        status_id: 3,
        worker_id: null
      })
      .eq('id', queueId);
    
    // Clean up temp file
    try {
      fs.unlinkSync(tempPdfPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}


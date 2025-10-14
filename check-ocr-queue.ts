/**
 * Diagnostic script to check documents waiting for OCR processing
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { supabaseManager } from './dist/utils/supabase.js';
import { EXTRACTION_STATUS } from './dist/types/index.js';

async function checkOCRQueue() {
  console.log('\n='.repeat(80));
  console.log('📊 OCR Queue Diagnostic');
  console.log('='.repeat(80));

  // Check which environments are enabled for OCR
  const ocrProd = process.env.OCR_PROD === 'true';
  const ocrStaging = process.env.OCR_STAGING === 'true';
  const ocrDev = process.env.OCR_DEV === 'true';

  console.log('\n⚙️  OCR Configuration:');
  console.log(`   OCR_PROD: ${ocrProd}`);
  console.log(`   OCR_STAGING: ${ocrStaging}`);
  console.log(`   OCR_DEV: ${ocrDev}`);

  const environments = supabaseManager.getAvailableEnvironments();
  console.log(`\n🌍 Available Environments: ${environments.join(', ')}`);

  for (const env of environments) {
    const isEnabled = (env === 'prod' && ocrProd) || 
                      (env === 'staging' && ocrStaging) || 
                      (env === 'dev' && ocrDev);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📁 Environment: ${env.toUpperCase()} ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log('='.repeat(80));

    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.log('   ⚠️  No client available for this environment');
      continue;
    }

    // Query for documents with status_id = 3
    const { data: documents, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.COMPLETE)
      .in('document_source', ['index', 'acte'])
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.log(`   ❌ Error querying: ${error.message}`);
      continue;
    }

    if (!documents || documents.length === 0) {
      console.log('   ℹ️  No documents with status_id = 3 found');
      continue;
    }

    console.log(`\n   Found ${documents.length} document(s) with status_id = 3:`);
    console.log('   ' + '-'.repeat(76));

    for (const doc of documents) {
      const attempts = doc.ocr_attempts || 0;
      const maxAttempts = doc.ocr_max_attempts || 3;
      const hasPath = !!doc.supabase_path;
      const isEligible = attempts < maxAttempts && hasPath;

      console.log(`\n   📄 Document: ${doc.document_number}`);
      console.log(`      ID: ${doc.id}`);
      console.log(`      Source: ${doc.document_source}`);
      console.log(`      Created: ${doc.created_at}`);
      console.log(`      OCR Attempts: ${attempts}/${maxAttempts}`);
      console.log(`      Has PDF Path: ${hasPath ? '✅' : '❌'}`);
      console.log(`      PDF Path: ${doc.supabase_path || 'NULL'}`);
      console.log(`      Eligible for OCR: ${isEligible ? '✅ YES' : '❌ NO'}`);
      
      if (!isEligible) {
        const reasons = [];
        if (attempts >= maxAttempts) reasons.push(`Max attempts reached (${attempts}/${maxAttempts})`);
        if (!hasPath) reasons.push('No PDF path');
        console.log(`      ⚠️  Blocked: ${reasons.join(', ')}`);
      }

      // Check if file_content already exists
      if (doc.file_content) {
        console.log(`      ⚠️  file_content already exists (${doc.file_content.length} chars)`);
        console.log(`      ⚠️  This should be status_id = 5, not 3!`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Diagnostic Complete');
  console.log('='.repeat(80) + '\n');
}

checkOCRQueue().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});


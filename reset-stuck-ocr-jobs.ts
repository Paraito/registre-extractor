import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';
import { logger } from './src/utils/logger';

/**
 * Script to reset OCR jobs stuck in "OCR en traitement" status (status_id = 6)
 * Run this to immediately fix stuck OCR jobs
 */
async function resetStuckOCRJobs() {
  console.log('🔍 Checking for stuck OCR jobs in all environments...\n');
  
  const environments = supabaseManager.getAvailableEnvironments();
  let totalReset = 0;
  
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.log(`⚠️  Skipping ${env} - no client available`);
      continue;
    }
    
    console.log(`\n📊 Checking ${env} environment...`);
    
    // Find OCR jobs stuck in processing for more than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: stuckJobs, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
      .lt('ocr_started_at', tenMinutesAgo);
    
    if (error) {
      console.error(`❌ Error querying ${env}:`, error);
      continue;
    }
    
    if (!stuckJobs || stuckJobs.length === 0) {
      console.log(`✅ No stuck OCR jobs found in ${env}`);
      continue;
    }
    
    console.log(`⚠️  Found ${stuckJobs.length} stuck OCR job(s) in ${env}:`);
    stuckJobs.forEach(job => {
      console.log(`   - Job ID: ${job.id}`);
      console.log(`     OCR Worker: ${job.ocr_worker_id}`);
      console.log(`     OCR Started: ${job.ocr_started_at}`);
      console.log(`     OCR Attempts: ${job.ocr_attempts || 0}`);
      console.log(`     Document: ${job.document_source} - ${job.document_number}`);
    });
    
    // Reset the stuck OCR jobs
    const { error: updateError } = await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.COMPLETE, // Reset to ready for OCR retry
        ocr_worker_id: null,
        ocr_error: 'Reset from stuck OCR state by admin script',
        ocr_last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
      .lt('ocr_started_at', tenMinutesAgo);
    
    if (updateError) {
      console.error(`❌ Error resetting stuck OCR jobs in ${env}:`, updateError);
      continue;
    }
    
    totalReset += stuckJobs.length;
    console.log(`✅ Reset ${stuckJobs.length} stuck OCR job(s) in ${env}`);
    console.log(`   Status changed: OCR_PROCESSING (6) → COMPLETE (3)`);
    console.log(`   Jobs are now ready for automatic retry by OCR Monitor`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total stuck OCR jobs reset: ${totalReset}`);
  console.log(`\n✅ Done!`);
}

/**
 * Check status of a specific job by ID
 */
async function checkJobStatus(jobId: string) {
  console.log(`\n🔍 Checking status of job ${jobId}...\n`);
  
  const environments = supabaseManager.getAvailableEnvironments();
  
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;
    
    const { data: job } = await client
      .from('extraction_queue')
      .select('*')
      .eq('id', jobId)
      .single();
      
    if (job) {
      console.log(`\n📋 Job ${jobId} found in ${env}:`);
      console.log(`   Status ID: ${job.status_id} (${getStatusName(job.status_id)})`);
      console.log(`   OCR Worker: ${job.ocr_worker_id || 'none'}`);
      console.log(`   OCR Started: ${job.ocr_started_at || 'N/A'}`);
      console.log(`   OCR Completed: ${job.ocr_completed_at || 'N/A'}`);
      console.log(`   OCR Attempts: ${job.ocr_attempts || 0}`);
      console.log(`   OCR Error: ${job.ocr_error || 'none'}`);
      
      if (job.status_id === EXTRACTION_STATUS.OCR_PROCESSING) {
        console.log(`   ⚠️  Still stuck in OCR processing! Resetting...`);
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE,
            ocr_worker_id: null,
            ocr_error: 'Reset from stuck OCR state by admin script',
            ocr_last_error_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);
        console.log(`   ✅ Reset complete`);
      }
    }
  }
  
  console.log('\n✅ Done!');
}

function getStatusName(statusId: number): string {
  const statusNames: Record<number, string> = {
    1: 'En attente',
    2: 'En traitement',
    3: 'Complété',
    4: 'Erreur',
    5: 'Extraction Complété',
    6: 'OCR en traitement'
  };
  return statusNames[statusId] || 'Unknown';
}

// Main execution
const args = process.argv.slice(2);

if (args.length > 0 && args[0] === '--job-id') {
  const jobId = args[1];
  if (!jobId) {
    console.error('❌ Please provide a job ID: --job-id <job-id>');
    process.exit(1);
  }
  checkJobStatus(jobId)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
} else {
  resetStuckOCRJobs()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error:', err);
      process.exit(1);
    });
}


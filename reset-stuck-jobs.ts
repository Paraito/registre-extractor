import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';
import { logger } from './src/utils/logger';

/**
 * Script to reset jobs stuck in "En traitement" status
 * Run this to immediately fix stuck jobs
 */
async function resetStuckJobs() {
  console.log('🔍 Checking for stuck jobs in all environments...\n');
  
  const environments = supabaseManager.getAvailableEnvironments();
  let totalReset = 0;
  
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.log(`⚠️  Skipping ${env} - no client available`);
      continue;
    }
    
    console.log(`\n📊 Checking ${env} environment...`);
    
    // Find jobs stuck in processing for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data: stuckJobs, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
      .lt('processing_started_at', fiveMinutesAgo);
    
    if (error) {
      console.error(`❌ Error querying ${env}:`, error);
      continue;
    }
    
    if (!stuckJobs || stuckJobs.length === 0) {
      console.log(`✅ No stuck jobs found in ${env}`);
      continue;
    }
    
    console.log(`⚠️  Found ${stuckJobs.length} stuck job(s) in ${env}:`);
    stuckJobs.forEach(job => {
      console.log(`   - Job ID: ${job.id}`);
      console.log(`     Worker: ${job.worker_id}`);
      console.log(`     Started: ${job.processing_started_at}`);
      console.log(`     Document: ${job.document_source} - ${job.document_number}`);
    });
    
    // Reset the stuck jobs
    const { error: updateError } = await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.EN_ATTENTE,
        worker_id: null,
        processing_started_at: null,
        error_message: 'Reset from stuck state by admin script'
      })
      .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
      .lt('processing_started_at', fiveMinutesAgo);
    
    if (updateError) {
      console.error(`❌ Error resetting jobs in ${env}:`, updateError);
      continue;
    }
    
    console.log(`✅ Reset ${stuckJobs.length} job(s) in ${env}`);
    totalReset += stuckJobs.length;
  }
  
  console.log(`\n✨ Total jobs reset across all environments: ${totalReset}`);
  
  // Also check for specific job IDs mentioned by user
  console.log('\n🔍 Checking specific job IDs mentioned...');
  const specificJobIds = [
    'c0641b62-d4b4-41d4-bda6-a4d7f2379c66',
    '1f3a232a-e15b-4e7a-b032-d37dcf12cc54',
    '1746eb79-981e-4c74-a925-b9dfd991c29d',
    '956f6751-a493-4b36-88bb-e48ecced5f5f'
  ];
  
  for (const jobId of specificJobIds) {
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
        console.log(`   Worker: ${job.worker_id || 'none'}`);
        console.log(`   Started: ${job.processing_started_at || 'N/A'}`);
        console.log(`   Error: ${job.error_message || 'none'}`);
        
        if (job.status_id === EXTRACTION_STATUS.EN_TRAITEMENT) {
          console.log(`   ⚠️  Still stuck! Resetting...`);
          await client
            .from('extraction_queue')
            .update({
              status_id: EXTRACTION_STATUS.EN_ATTENTE,
              worker_id: null,
              processing_started_at: null,
              error_message: 'Reset from stuck state by admin script'
            })
            .eq('id', jobId);
          console.log(`   ✅ Reset complete`);
        }
      }
    }
  }
  
  console.log('\n✅ Done!');
}

function getStatusName(statusId: number): string {
  const statusMap: Record<number, string> = {
    1: 'En attente',
    2: 'En traitement',
    3: 'Complété',
    4: 'Erreur',
    5: 'Extraction complété'
  };
  return statusMap[statusId] || 'Unknown';
}

// Run the script
resetStuckJobs()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });


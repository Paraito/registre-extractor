import { supabase } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

async function assignJobToWorker(jobId: string, workerId: string) {
  console.log(`🎯 Assigning job ${jobId} to worker ${workerId}...`);
  
  try {
    // Reset the job to "En attente" and assign to specific worker
    const { data, error } = await supabase
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.EN_ATTENTE,
        worker_id: null, // Clear any existing assignment first
        processing_started_at: null,
        error_message: null
      })
      .eq('id', jobId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating job:', error);
      return;
    }

    console.log('✅ Job reset successfully');
    console.log('📋 Job details:', data);
    console.log('🔄 Your worker should pick it up next!');
    
  } catch (error) {
    console.error('❌ Failed to assign job:', error);
  }
}

// Usage: npx tsx assign-job-to-worker.ts JOB_ID WORKER_ID
const jobId = process.argv[2];
const workerId = process.argv[3];

if (!jobId || !workerId) {
  console.log('Usage: npx tsx assign-job-to-worker.ts <JOB_ID> <WORKER_ID>');
  console.log('Example: npx tsx assign-job-to-worker.ts 123e4567-e89b-12d3-a456-426614174000 debug-worker');
  process.exit(1);
}

assignJobToWorker(jobId, workerId);
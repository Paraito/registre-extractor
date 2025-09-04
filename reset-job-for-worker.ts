import { supabase } from './src/utils/supabase';

async function resetJobForWorker() {
  const jobId = '5ccddc25-fe14-4282-aa80-29975cdeb5a5';
  const workerId = 'worker-e52c2c79-92c1-476b-b431-5e10b89cf5f5';
  
  console.log(`🎯 Resetting job ${jobId} for worker ${workerId}...`);
  
  try {
    // First, reset the job completely
    const { error: resetError } = await supabase
      .from('extraction_queue')
      .update({
        status: 'En attente',
        worker_id: null,
        processing_started_at: null,
        error_message: null,
        attemtps: 0
      })
      .eq('id', jobId);

    if (resetError) {
      console.error('❌ Error resetting job:', resetError);
      return;
    }

    console.log('✅ Job reset to "En attente"');
    
    // Wait a moment then assign it specifically to your worker
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const { data, error } = await supabase
      .from('extraction_queue')
      .update({
        status: 'En traitement', // Claim it immediately
        worker_id: workerId,     // Assign to YOUR worker
        processing_started_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .eq('status', 'En attente') // Only if still available
      .select()
      .single();

    if (error) {
      console.error('❌ Error resetting job:', error);
      return;
    }

    console.log('✅ Job reset successfully!');
    console.log('📋 Job details:');
    console.log('   - ID:', data.id);
    console.log('   - Status:', data.status);
    console.log('   - Document:', data.document_source);
    console.log('   - Lot Number:', data.document_number);
    console.log('   - Circonscription:', data.circonscription_fonciere);
    console.log('   - Cadastre:', data.cadastre);
    console.log('');
    console.log('🚀 Your worker should pick this up within 5 seconds!');
    console.log('👀 Watch your browser window for action!');
    
  } catch (error) {
    console.error('❌ Failed to reset job:', error);
  }
}

resetJobForWorker();
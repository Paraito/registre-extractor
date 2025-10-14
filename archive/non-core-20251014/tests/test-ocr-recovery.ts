import { supabaseManager } from '../src/utils/supabase';
import { EXTRACTION_STATUS } from '../src/types';
import { staleOCRMonitor } from '../src/ocr/stale-ocr-monitor';

/**
 * Test script to verify OCR stuck job recovery system
 * 
 * This script:
 * 1. Finds a job with status_id = 3 (COMPLETE) ready for OCR
 * 2. Simulates it getting stuck in OCR processing
 * 3. Runs the stale OCR monitor to verify it gets reset
 * 4. Cleans up by restoring original state
 */

async function testOCRRecovery() {
  console.log('🧪 Testing OCR Stuck Job Recovery System\n');
  console.log('='.repeat(60));
  
  const environments = supabaseManager.getAvailableEnvironments();
  
  if (environments.length === 0) {
    console.error('❌ No Supabase environments configured');
    process.exit(1);
  }
  
  const env = environments[0];
  const client = supabaseManager.getServiceClient(env);
  
  if (!client) {
    console.error(`❌ No client available for ${env}`);
    process.exit(1);
  }
  
  console.log(`📊 Using environment: ${env}\n`);
  
  // Step 1: Find a test job
  console.log('Step 1: Finding a test job...');
  const { data: testJobs, error: findError } = await client
    .from('extraction_queue')
    .select('*')
    .eq('status_id', EXTRACTION_STATUS.COMPLETE)
    .eq('document_source', 'index')
    .is('file_content', null)
    .limit(1);
  
  if (findError || !testJobs || testJobs.length === 0) {
    console.log('⚠️  No suitable test job found (need status_id=3, document_source=index, file_content=null)');
    console.log('   Creating a simulated test job instead...\n');
    
    // Create a test job
    const { data: newJob, error: createError } = await client
      .from('extraction_queue')
      .insert({
        document_source: 'index',
        document_number: 'TEST-OCR-RECOVERY-' + Date.now(),
        status_id: EXTRACTION_STATUS.COMPLETE,
        supabase_path: 'test/path.pdf',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (createError || !newJob) {
      console.error('❌ Failed to create test job:', createError);
      process.exit(1);
    }
    
    console.log(`✅ Created test job: ${newJob.id}`);
    testJobs[0] = newJob;
  } else {
    console.log(`✅ Found test job: ${testJobs[0].id}`);
  }
  
  const testJob = testJobs[0];
  const originalStatus = testJob.status_id;
  
  console.log(`   Document: ${testJob.document_number}`);
  console.log(`   Original Status: ${originalStatus}\n`);
  
  // Step 2: Simulate stuck OCR job
  console.log('Step 2: Simulating stuck OCR job...');
  const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  
  const { error: updateError } = await client
    .from('extraction_queue')
    .update({
      status_id: EXTRACTION_STATUS.OCR_PROCESSING,
      ocr_worker_id: 'test-worker-recovery',
      ocr_started_at: elevenMinutesAgo,
      ocr_attempts: 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', testJob.id);
  
  if (updateError) {
    console.error('❌ Failed to simulate stuck job:', updateError);
    process.exit(1);
  }
  
  console.log(`✅ Job simulated as stuck:`);
  console.log(`   Status: ${EXTRACTION_STATUS.OCR_PROCESSING} (OCR_PROCESSING)`);
  console.log(`   OCR Started: ${elevenMinutesAgo} (11 minutes ago)`);
  console.log(`   OCR Worker: test-worker-recovery\n`);
  
  // Step 3: Run stale OCR monitor
  console.log('Step 3: Running stale OCR monitor...');
  await staleOCRMonitor.runOnce();
  console.log('✅ Stale OCR monitor completed\n');
  
  // Step 4: Verify job was reset
  console.log('Step 4: Verifying job was reset...');
  const { data: verifyJob, error: verifyError } = await client
    .from('extraction_queue')
    .select('*')
    .eq('id', testJob.id)
    .single();
  
  if (verifyError || !verifyJob) {
    console.error('❌ Failed to verify job:', verifyError);
    process.exit(1);
  }
  
  console.log(`   Current Status: ${verifyJob.status_id}`);
  console.log(`   OCR Worker: ${verifyJob.ocr_worker_id || 'null'}`);
  console.log(`   OCR Error: ${verifyJob.ocr_error || 'null'}`);
  console.log(`   OCR Last Error At: ${verifyJob.ocr_last_error_at || 'null'}\n`);
  
  // Verify expectations
  const success = 
    verifyJob.status_id === EXTRACTION_STATUS.COMPLETE &&
    verifyJob.ocr_worker_id === null &&
    verifyJob.ocr_error?.includes('Reset by stale OCR monitor');
  
  if (success) {
    console.log('✅ SUCCESS: Job was correctly reset!');
    console.log(`   Status changed: ${EXTRACTION_STATUS.OCR_PROCESSING} → ${EXTRACTION_STATUS.COMPLETE}`);
    console.log(`   OCR worker cleared`);
    console.log(`   Error message set\n`);
  } else {
    console.log('❌ FAILURE: Job was not reset correctly');
    console.log(`   Expected status_id: ${EXTRACTION_STATUS.COMPLETE}, got: ${verifyJob.status_id}`);
    console.log(`   Expected ocr_worker_id: null, got: ${verifyJob.ocr_worker_id}`);
    console.log(`   Expected ocr_error to contain "Reset by stale OCR monitor"\n`);
  }
  
  // Step 5: Cleanup
  console.log('Step 5: Cleaning up...');
  
  if (testJob.document_number.startsWith('TEST-OCR-RECOVERY-')) {
    // Delete test job we created
    const { error: deleteError } = await client
      .from('extraction_queue')
      .delete()
      .eq('id', testJob.id);
    
    if (deleteError) {
      console.error('⚠️  Failed to delete test job:', deleteError);
    } else {
      console.log('✅ Deleted test job');
    }
  } else {
    // Restore original status
    const { error: restoreError } = await client
      .from('extraction_queue')
      .update({
        status_id: originalStatus,
        ocr_worker_id: null,
        ocr_started_at: null,
        ocr_error: null,
        ocr_last_error_at: null,
        ocr_attempts: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', testJob.id);
    
    if (restoreError) {
      console.error('⚠️  Failed to restore job:', restoreError);
    } else {
      console.log('✅ Restored job to original state');
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(success ? '✅ TEST PASSED' : '❌ TEST FAILED');
  console.log('='.repeat(60));
  
  process.exit(success ? 0 : 1);
}

// Run the test
testOCRRecovery().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});


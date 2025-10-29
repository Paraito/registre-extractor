/**
 * Diagnostic script to check what jobs are available in the database
 * This helps debug polling issues by showing exactly what the worker should see
 */

import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';

async function diagnosePolling() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 POLLING DIAGNOSTICS');
  console.log('='.repeat(80));

  const environments = supabaseManager.getAvailableEnvironments();
  
  if (environments.length === 0) {
    console.error('❌ No environments configured!');
    return;
  }

  console.log(`\n📊 Checking ${environments.length} environment(s): ${environments.join(', ')}\n`);

  for (const env of environments) {
    console.log('\n' + '─'.repeat(80));
    console.log(`🌍 Environment: ${env.toUpperCase()}`);
    console.log('─'.repeat(80));

    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.error(`  ❌ No client available for ${env}`);
      continue;
    }

    // Check extraction_queue
    console.log('\n  📋 EXTRACTION QUEUE (Land Registry)');
    console.log('  ' + '─'.repeat(76));
    
    const { data: extractionJobs, error: extractionError } = await client
      .from('extraction_queue')
      .select('id, document_source, document_number, status_id, created_at, worker_id')
      .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)
      .order('created_at', { ascending: true })
      .limit(5);

    if (extractionError) {
      console.error(`  ❌ Error querying extraction_queue:`, extractionError.message);
    } else if (!extractionJobs || extractionJobs.length === 0) {
      console.log(`  ✅ No pending extraction jobs (status_id = ${EXTRACTION_STATUS.EN_ATTENTE})`);
    } else {
      console.log(`  ✅ Found ${extractionJobs.length} pending extraction job(s):`);
      extractionJobs.forEach((job, i) => {
        console.log(`     ${i + 1}. ID: ${job.id.substring(0, 8)}... | ${job.document_source}:${job.document_number} | Created: ${job.created_at}`);
      });
    }

    // Check search_sessions (REQ)
    console.log('\n  🔍 SEARCH SESSIONS (REQ)');
    console.log('  ' + '─'.repeat(76));
    
    const { data: reqJobs, error: reqError } = await client
      .from('search_sessions')
      .select('id, initial_search_query, status, req_completed, created_at')
      .eq('status', 'pending_company_selection')
      .eq('req_completed', false)
      .order('created_at', { ascending: true })
      .limit(5);

    if (reqError) {
      console.error(`  ❌ Error querying search_sessions:`, reqError.message);
    } else if (!reqJobs || reqJobs.length === 0) {
      console.log(`  ✅ No pending REQ jobs (status = 'pending_company_selection' AND req_completed = false)`);
      
      // Check if there are any with different criteria
      const { data: allSessions } = await client
        .from('search_sessions')
        .select('id, status, req_completed')
        .limit(10);
      
      if (allSessions && allSessions.length > 0) {
        console.log(`  ℹ️  Found ${allSessions.length} total search_sessions (showing status breakdown):`);
        const statusCounts: Record<string, number> = {};
        allSessions.forEach(s => {
          const key = `${s.status} (req_completed=${s.req_completed})`;
          statusCounts[key] = (statusCounts[key] || 0) + 1;
        });
        Object.entries(statusCounts).forEach(([status, count]) => {
          console.log(`     - ${status}: ${count}`);
        });
      }
    } else {
      console.log(`  ✅ Found ${reqJobs.length} pending REQ job(s):`);
      reqJobs.forEach((job, i) => {
        console.log(`     ${i + 1}. ID: ${job.id.substring(0, 8)}... | Query: "${job.initial_search_query}" | Created: ${job.created_at}`);
      });
    }

    // Check rdprm_searches
    console.log('\n  🔎 RDPRM SEARCHES');
    console.log('  ' + '─'.repeat(76));
    
    const { data: rdprmJobs, error: rdprmError } = await client
      .from('rdprm_searches')
      .select('id, search_name, status, created_at, search_session_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (rdprmError) {
      console.error(`  ❌ Error querying rdprm_searches:`, rdprmError.message);
    } else if (!rdprmJobs || rdprmJobs.length === 0) {
      console.log(`  ✅ No pending RDPRM jobs (status = 'pending')`);
    } else {
      console.log(`  ✅ Found ${rdprmJobs.length} pending RDPRM job(s):`);
      rdprmJobs.forEach((job, i) => {
        console.log(`     ${i + 1}. ID: ${job.id.substring(0, 8)}... | Name: "${job.search_name}" | Session: ${job.search_session_id?.substring(0, 8)}... | Created: ${job.created_at}`);
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Diagnostics complete');
  console.log('='.repeat(80) + '\n');
}

// Run diagnostics
diagnosePolling()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });


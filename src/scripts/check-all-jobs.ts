#!/usr/bin/env tsx
/**
 * Check all jobs across all environments and statuses
 */

import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';

const STATUS_NAMES: Record<number, string> = {
  [EXTRACTION_STATUS.EN_ATTENTE]: 'EN_ATTENTE (Waiting)',
  [EXTRACTION_STATUS.EN_TRAITEMENT]: 'EN_TRAITEMENT (Processing)',
  [EXTRACTION_STATUS.COMPLETE]: 'COMPLETE',
  [EXTRACTION_STATUS.ERREUR]: 'ERREUR (Error)',
  [EXTRACTION_STATUS.EXTRACTION_COMPLETE]: 'EXTRACTION_COMPLETE (OCR Done)',
  [EXTRACTION_STATUS.OCR_PROCESSING]: 'OCR_PROCESSING',
};

async function checkAllJobs() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPLETE JOB STATUS REPORT');
  console.log('='.repeat(80));

  const environments = supabaseManager.getAvailableEnvironments();

  for (const env of environments) {
    console.log('\n' + '─'.repeat(80));
    console.log(`🌍 Environment: ${env.toUpperCase()}`);
    console.log('─'.repeat(80));

    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.error(`  ❌ No client available for ${env}`);
      continue;
    }

    // Get job counts by status
    console.log('\n  📋 EXTRACTION QUEUE STATUS BREAKDOWN');
    console.log('  ' + '─'.repeat(76));

    const { data: statusCounts, error: countError } = await client
      .from('extraction_queue')
      .select('status_id')
      .then(async (result) => {
        if (result.error) return result;
        
        const counts: Record<number, number> = {};
        result.data?.forEach((job: any) => {
          counts[job.status_id] = (counts[job.status_id] || 0) + 1;
        });

        return { data: counts, error: null };
      });

    if (countError) {
      console.error(`  ❌ Error fetching job counts: ${countError.message}`);
      continue;
    }

    if (!statusCounts || Object.keys(statusCounts).length === 0) {
      console.log('  ℹ️  No jobs found in extraction_queue');
    } else {
      Object.entries(statusCounts).forEach(([statusId, count]) => {
        const statusName = STATUS_NAMES[parseInt(statusId)] || `Unknown (${statusId})`;
        console.log(`  ${statusName}: ${count}`);
      });
    }

    // Get recent jobs (last 10)
    console.log('\n  📝 RECENT JOBS (Last 10)');
    console.log('  ' + '─'.repeat(76));

    const { data: recentJobs, error: jobsError } = await client
      .from('extraction_queue')
      .select('id, document_source, document_number, status_id, created_at, worker_id, error_message')
      .order('created_at', { ascending: false })
      .limit(10);

    if (jobsError) {
      console.error(`  ❌ Error fetching recent jobs: ${jobsError.message}`);
    } else if (!recentJobs || recentJobs.length === 0) {
      console.log('  ℹ️  No jobs found');
    } else {
      recentJobs.forEach((job: any, idx: number) => {
        const statusName = STATUS_NAMES[job.status_id] || `Unknown (${job.status_id})`;
        console.log(`  ${idx + 1}. ${job.document_source} #${job.document_number}`);
        console.log(`     Status: ${statusName}`);
        console.log(`     Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`     Worker: ${job.worker_id || 'None'}`);
        if (job.error_message) {
          console.log(`     Error: ${job.error_message.substring(0, 100)}...`);
        }
        console.log('');
      });
    }

    // Check worker status
    console.log('  👷 WORKER STATUS');
    console.log('  ' + '─'.repeat(76));

    const { data: workers, error: workerError } = await client
      .from('worker_status')
      .select('worker_id, status, last_heartbeat, jobs_completed, jobs_failed')
      .order('last_heartbeat', { ascending: false })
      .limit(10);

    if (workerError) {
      console.error(`  ❌ Error fetching workers: ${workerError.message}`);
    } else if (!workers || workers.length === 0) {
      console.log('  ℹ️  No workers registered');
    } else {
      workers.forEach((worker: any, idx: number) => {
        const lastHeartbeat = new Date(worker.last_heartbeat);
        const minutesAgo = Math.floor((Date.now() - lastHeartbeat.getTime()) / 60000);
        const isAlive = minutesAgo < 2;
        
        console.log(`  ${idx + 1}. ${worker.worker_id}`);
        console.log(`     Status: ${worker.status} ${isAlive ? '✅' : '💀 (dead)'}`);
        console.log(`     Last heartbeat: ${minutesAgo} minutes ago`);
        console.log(`     Completed: ${worker.jobs_completed}, Failed: ${worker.jobs_failed}`);
        console.log('');
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Report complete');
  console.log('='.repeat(80) + '\n');
}

checkAllJobs().catch(console.error);


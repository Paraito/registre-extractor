import { supabaseManager } from '../src/utils/supabase';
import { EXTRACTION_STATUS } from '../src/types';
import { logger } from '../src/utils/logger';
import Redis from 'ioredis';
import { config } from '../src/config';

/**
 * Comprehensive system diagnostic script
 * Checks workers, jobs, Redis, and database health
 */
async function diagnoseSystem() {
  console.log('🔍 SYSTEM DIAGNOSTIC REPORT\n');
  console.log('='.repeat(60));
  console.log('\n');

  // 1. Check Supabase Environments
  console.log('📊 SUPABASE ENVIRONMENTS');
  console.log('-'.repeat(60));
  const environments = supabaseManager.getAvailableEnvironments();
  console.log(`Available environments: ${environments.join(', ') || 'NONE'}`);
  
  if (environments.length === 0) {
    console.log('❌ No environments configured!');
    console.log('   Please set up environment credentials in .env\n');
    return;
  }
  console.log('');

  // 2. Check Workers
  console.log('👷 WORKER STATUS');
  console.log('-'.repeat(60));
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;

    console.log(`\nEnvironment: ${env}`);
    
    const { data: workers, error } = await client
      .from('worker_status')
      .select('*')
      .order('last_heartbeat', { ascending: false });

    if (error) {
      console.log(`   ❌ Error fetching workers: ${error.message}`);
      continue;
    }

    if (!workers || workers.length === 0) {
      console.log('   ⚠️  No workers found');
      continue;
    }

    const now = Date.now();
    workers.forEach(worker => {
      const lastHeartbeat = new Date(worker.last_heartbeat).getTime();
      const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 60000);
      const isAlive = minutesSinceHeartbeat < 2;
      
      console.log(`   ${isAlive ? '✅' : '❌'} Worker: ${worker.worker_id}`);
      console.log(`      Status: ${worker.status}`);
      console.log(`      Last heartbeat: ${minutesSinceHeartbeat}m ago`);
      console.log(`      Jobs completed: ${worker.jobs_completed}`);
      console.log(`      Jobs failed: ${worker.jobs_failed}`);
      if (worker.current_job_id) {
        console.log(`      Current job: ${worker.current_job_id}`);
      }
    });
  }
  console.log('');

  // 3. Check Job Queue Status
  console.log('📋 JOB QUEUE STATUS');
  console.log('-'.repeat(60));
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;

    console.log(`\nEnvironment: ${env}`);

    // Count jobs by status
    const statusCounts: Record<string, number> = {};
    for (const [statusName, statusId] of Object.entries(EXTRACTION_STATUS)) {
      const { count, error } = await client
        .from('extraction_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status_id', statusId);

      if (!error) {
        statusCounts[statusName] = count || 0;
      }
    }

    console.log(`   En attente: ${statusCounts['EN_ATTENTE'] || 0}`);
    console.log(`   En traitement: ${statusCounts['EN_TRAITEMENT'] || 0}`);
    console.log(`   Complété: ${statusCounts['COMPLETE'] || 0}`);
    console.log(`   Erreur: ${statusCounts['ERREUR'] || 0}`);

    // Check for stale jobs
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleJobs } = await client
      .from('extraction_queue')
      .select('id, worker_id, processing_started_at')
      .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
      .lt('processing_started_at', fiveMinutesAgo);

    if (staleJobs && staleJobs.length > 0) {
      console.log(`   ⚠️  STALE JOBS: ${staleJobs.length}`);
      staleJobs.forEach(job => {
        const startedAt = new Date(job.processing_started_at);
        const minutesStuck = Math.floor((Date.now() - startedAt.getTime()) / 60000);
        console.log(`      - ${job.id} (stuck for ${minutesStuck}m, worker: ${job.worker_id})`);
      });
    }
  }
  console.log('');

  // 4. Check Redis
  console.log('🔴 REDIS STATUS');
  console.log('-'.repeat(60));
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: () => null,
  });

  try {
    await redis.ping();
    console.log('✅ Redis is connected');
    
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    if (versionMatch) {
      console.log(`   Version: ${versionMatch[1]}`);
    }

    // Check Bull queues
    const keys = await redis.keys('bull:*');
    console.log(`   Bull queue keys: ${keys.length}`);
    
    if (keys.length > 0) {
      const queueNames = new Set<string>();
      keys.forEach(key => {
        const match = key.match(/^bull:([^:]+)/);
        if (match) queueNames.add(match[1]);
      });
      
      for (const queueName of queueNames) {
        const activeKey = `bull:${queueName}:active`;
        const activeJobs = await redis.llen(activeKey);
        const waitingKey = `bull:${queueName}:wait`;
        const waitingJobs = await redis.llen(waitingKey);
        
        console.log(`   Queue "${queueName}": ${activeJobs} active, ${waitingJobs} waiting`);
      }
    }
  } catch (error) {
    console.log('❌ Redis connection failed');
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    console.log('   ⚠️  This may cause issues with Bull queue management');
  } finally {
    redis.disconnect();
  }
  console.log('');

  // 5. Check for specific problematic jobs
  console.log('🔍 CHECKING SPECIFIC JOBS');
  console.log('-'.repeat(60));
  const specificJobIds = [
    'c0641b62-d4b4-41d4-bda6-a4d7f2379c66',
    '1f3a232a-e15b-4e7a-b032-d37dcf12cc54',
    '1746eb79-981e-4c74-a925-b9dfd991c29d',
    '956f6751-a493-4b36-88bb-e48ecced5f5f'
  ];

  for (const jobId of specificJobIds) {
    let found = false;
    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      const { data: job } = await client
        .from('extraction_queue')
        .select('*')
        .eq('id', jobId)
        .single();

      if (job) {
        found = true;
        const statusName = Object.entries(EXTRACTION_STATUS).find(([_, id]) => id === job.status_id)?.[0] || 'UNKNOWN';
        console.log(`\n📄 Job: ${jobId.substring(0, 8)}...`);
        console.log(`   Environment: ${env}`);
        console.log(`   Status: ${statusName} (${job.status_id})`);
        console.log(`   Worker: ${job.worker_id || 'none'}`);
        console.log(`   Document: ${job.document_source} - ${job.document_number}`);
        if (job.processing_started_at) {
          const minutesProcessing = Math.floor((Date.now() - new Date(job.processing_started_at).getTime()) / 60000);
          console.log(`   Processing time: ${minutesProcessing}m`);
        }
        if (job.error_message) {
          console.log(`   Error: ${job.error_message.substring(0, 100)}...`);
        }
      }
    }
    if (!found) {
      console.log(`\n⚠️  Job ${jobId.substring(0, 8)}... not found in any environment`);
    }
  }
  console.log('');

  // 6. Recommendations
  console.log('💡 RECOMMENDATIONS');
  console.log('-'.repeat(60));
  
  // Check for stale jobs across all environments
  let hasStaleJobs = false;
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) continue;
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleJobs } = await client
      .from('extraction_queue')
      .select('id')
      .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
      .lt('processing_started_at', fiveMinutesAgo);
    
    if (staleJobs && staleJobs.length > 0) {
      hasStaleJobs = true;
      break;
    }
  }

  if (hasStaleJobs) {
    console.log('⚠️  Stale jobs detected!');
    console.log('   Run: npm run reset-stuck-jobs');
  } else {
    console.log('✅ No stale jobs detected');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Diagnostic complete!\n');
}

// Run the diagnostic
diagnoseSystem()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });


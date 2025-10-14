#!/usr/bin/env tsx
/**
 * Fix Inconsistent OCR Status Script
 * 
 * This script finds and fixes jobs that have OCR content (file_content) populated
 * but are still marked with status_id=3 instead of status_id=5.
 * 
 * This can happen if the OCR processing completes but the final status update fails.
 */

import { supabaseManager, EnvironmentName } from '../src/utils/supabase';
import { EXTRACTION_STATUS } from '../src/types';
import { logger } from '../src/utils/logger';

interface InconsistentJob {
  id: string;
  document_number: string;
  status_id: number;
  file_content: string | null;
  boosted_file_content?: string | null;
  ocr_completed_at: string | null;
  updated_at: string;
}

async function findInconsistentJobs(env: EnvironmentName): Promise<InconsistentJob[]> {
  const client = supabaseManager.getServiceClient(env);
  if (!client) {
    logger.warn({ environment: env }, 'No client available for environment');
    return [];
  }

  // Try with boosted_file_content first
  let { data, error } = await client
    .from('extraction_queue')
    .select('id, document_number, status_id, file_content, boosted_file_content, ocr_completed_at, updated_at')
    .eq('status_id', EXTRACTION_STATUS.COMPLETE)
    .eq('document_source', 'index')
    .not('file_content', 'is', null);

  // If boosted_file_content column doesn't exist, retry without it
  if (error && error.message?.includes('boosted_file_content')) {
    const result = await client
      .from('extraction_queue')
      .select('id, document_number, status_id, file_content, ocr_completed_at, updated_at')
      .eq('status_id', EXTRACTION_STATUS.COMPLETE)
      .eq('document_source', 'index')
      .not('file_content', 'is', null);
    
    data = result.data;
    error = result.error;
  }

  if (error) {
    logger.error({ error, environment: env }, 'Error querying for inconsistent jobs');
    return [];
  }

  return data || [];
}

async function fixJob(jobId: string, env: EnvironmentName): Promise<boolean> {
  const client = supabaseManager.getServiceClient(env);
  if (!client) {
    return false;
  }

  const { error } = await client
    .from('extraction_queue')
    .update({
      status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
      ocr_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) {
    logger.error({ error, jobId, environment: env }, 'Failed to fix job');
    return false;
  }

  return true;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🔧 OCR Status Consistency Checker & Fixer');
  console.log('='.repeat(80));
  console.log();

  const environments = supabaseManager.getAvailableEnvironments();
  
  if (environments.length === 0) {
    console.log('❌ No Supabase environments configured');
    process.exit(1);
  }

  let totalFixed = 0;
  let totalFound = 0;

  for (const env of environments) {
    console.log(`📍 Checking environment: ${env.toUpperCase()}`);
    
    const inconsistentJobs = await findInconsistentJobs(env);
    
    if (inconsistentJobs.length === 0) {
      console.log('   ✅ No inconsistent jobs found');
      console.log();
      continue;
    }

    totalFound += inconsistentJobs.length;
    console.log(`   ⚠️  Found ${inconsistentJobs.length} jobs with status_id=3 but file_content present`);
    console.log();

    for (const job of inconsistentJobs) {
      console.log(`   📄 Document: ${job.document_number}`);
      console.log(`      ID: ${job.id}`);
      console.log(`      file_content: ${job.file_content?.length || 0} chars`);
      if (job.boosted_file_content !== undefined) {
        console.log(`      boosted_file_content: ${job.boosted_file_content?.length || 0} chars`);
      }
      console.log(`      ocr_completed_at: ${job.ocr_completed_at || 'NULL'}`);
      console.log(`      updated_at: ${job.updated_at}`);
      
      console.log('      🔧 Fixing...');
      const success = await fixJob(job.id, env);
      
      if (success) {
        console.log('      ✅ Fixed successfully');
        totalFixed++;
      } else {
        console.log('      ❌ Failed to fix');
      }
      console.log();
    }
  }

  console.log('='.repeat(80));
  console.log('📊 Summary');
  console.log('='.repeat(80));
  console.log(`   Total inconsistent jobs found: ${totalFound}`);
  console.log(`   Total jobs fixed: ${totalFixed}`);
  console.log(`   Failed to fix: ${totalFound - totalFixed}`);
  console.log();

  if (totalFixed > 0) {
    console.log('✅ All inconsistent jobs have been fixed!');
  } else if (totalFound > 0) {
    console.log('⚠️  Some jobs could not be fixed. Check the logs above.');
  } else {
    console.log('✅ No inconsistent jobs found. Database is healthy!');
  }
  
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


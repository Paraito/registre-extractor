#!/usr/bin/env ts-node
import { supabase } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';
import { logger } from '../utils/logger';

/**
 * Script to retry all failed extraction jobs
 * 
 * This will reset jobs with status_id = 4 (Erreur) back to status_id = 1 (En attente)
 * so they can be picked up by workers again.
 * 
 * Usage:
 *   npx tsx src/scripts/retry-failed-jobs.ts
 *   npx tsx src/scripts/retry-failed-jobs.ts --dry-run
 *   npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
 */

interface RetryOptions {
  dryRun: boolean;
  excludeNonexistent: boolean;
}

async function retryFailedJobs(options: RetryOptions = { dryRun: false, excludeNonexistent: false }) {
  try {
    logger.info('='.repeat(60));
    logger.info('🔄 RETRY FAILED JOBS SCRIPT');
    logger.info('='.repeat(60));
    logger.info('');

    // Get all failed jobs
    const { data: failedJobs, error: queryError } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.ERREUR)
      .order('created_at', { ascending: false });

    if (queryError) {
      throw new Error(`Failed to query failed jobs: ${queryError.message}`);
    }

    if (!failedJobs || failedJobs.length === 0) {
      logger.info('✅ No failed jobs found!');
      return;
    }

    logger.info(`📊 Found ${failedJobs.length} failed jobs`);
    logger.info('');

    // Display error summary
    const errorSummary = failedJobs.reduce((acc: any, job: any) => {
      const errorKey = job.error_message?.substring(0, 100) || 'Unknown error';
      acc[errorKey] = (acc[errorKey] || 0) + 1;
      return acc;
    }, {});

    logger.info('📋 Error Summary:');
    Object.entries(errorSummary)
      .sort(([, a]: any, [, b]: any) => b - a)
      .forEach(([error, count]) => {
        logger.info(`   ${count}x: ${error}`);
      });
    logger.info('');

    // Filter out jobs with "document doesn't exist" errors if requested
    let jobsToRetry = failedJobs;
    if (options.excludeNonexistent) {
      jobsToRetry = failedJobs.filter((job: any) => {
        const error = job.error_message || '';
        return !error.includes('inexistant') && 
               !error.includes('Aucune information') &&
               !error.includes('n\'existe pas');
      });
      logger.info(`🔍 Excluding "document doesn't exist" errors: ${failedJobs.length - jobsToRetry.length} jobs filtered out`);
      logger.info(`   Jobs to retry: ${jobsToRetry.length}`);
      logger.info('');
    }

    if (jobsToRetry.length === 0) {
      logger.info('✅ No jobs to retry after filtering!');
      return;
    }

    if (options.dryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be made');
      logger.info('');
      logger.info('Jobs that would be retried:');
      jobsToRetry.slice(0, 10).forEach((job: any) => {
        logger.info(`   - ${job.document_source}: ${job.document_number} (${job.error_message?.substring(0, 50)}...)`);
      });
      if (jobsToRetry.length > 10) {
        logger.info(`   ... and ${jobsToRetry.length - 10} more`);
      }
      logger.info('');
      logger.info('Run without --dry-run to actually retry these jobs');
      return;
    }

    // Reset jobs back to "En attente" status
    logger.info(`🔄 Resetting ${jobsToRetry.length} jobs to "En attente" status...`);

    const jobIds = jobsToRetry.map((job: any) => job.id);
    const { error: updateError } = await supabase
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.EN_ATTENTE,
        worker_id: null,
        processing_started_at: null,
        error_message: null,
        attemtps: 0, // Reset attempt counter
      })
      .in('id', jobIds);

    if (updateError) {
      throw new Error(`Failed to update jobs: ${updateError.message}`);
    }

    logger.info('');
    logger.info('='.repeat(60));
    logger.info('✅ JOBS RESET SUCCESSFULLY!');
    logger.info('='.repeat(60));
    logger.info(`   Total jobs reset: ${jobsToRetry.length}`);
    logger.info(`   Status changed: Erreur → En attente`);
    logger.info('');
    logger.info('Workers will now pick up these jobs automatically.');
    logger.info('');

  } catch (error) {
    logger.error({ error }, '❌ Failed to retry jobs');
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: RetryOptions = {
  dryRun: args.includes('--dry-run'),
  excludeNonexistent: args.includes('--exclude-nonexistent'),
};

// Run the script
retryFailedJobs(options).then(() => {
  process.exit(0);
});


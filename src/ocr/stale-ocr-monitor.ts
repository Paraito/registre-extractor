import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import { OCRLogger } from './ocr-logger';

/**
 * Background monitor that periodically checks for and resets stale OCR jobs
 * This provides a safety net in case OCR workers crash or jobs get stuck
 * 
 * Monitors jobs with status_id = 6 (OCR_PROCESSING) and resets them to
 * status_id = 3 (COMPLETE) if they've been stuck for too long
 */
export class StaleOCRMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private staleThresholdMs: number;
  private isRunning: boolean = false;

  constructor(
    checkIntervalMs: number = 60000, // Check every 60 seconds
    staleThresholdMs: number = 10 * 60 * 1000 // 10 minutes threshold - OCR processing can be lengthy, especially for multi-page documents
  ) {
    this.checkIntervalMs = checkIntervalMs;
    this.staleThresholdMs = staleThresholdMs;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Stale OCR job monitor is already running');
      return;
    }

    this.isRunning = true;

    // Get list of environments with OCR enabled
    const enabledEnvs = Object.entries(config.ocr.enabledEnvironments)
      .filter(([_, enabled]) => enabled)
      .map(([env]) => env);

    // Use structured logging
    OCRLogger.incrementMessageCounter();
    const messageNum = OCRLogger.getMessageCounter();
    const SEPARATOR = '='.repeat(80);

    console.log('\n' + SEPARATOR);
    console.log(`🔍 Stale OCR Monitor Started - Message #${messageNum}`);
    console.log(SEPARATOR);
    console.log('\n⚙️  Configuration');
    console.log(`   Enabled Environments: ${enabledEnvs.join(', ') || 'none'}`);
    console.log(`   Check Interval: ${this.checkIntervalMs / 1000}s`);
    console.log(`   Stale Threshold: ${this.staleThresholdMs / 1000 / 60} minutes`);
    console.log('\n' + SEPARATOR + '\n');

    // Run immediately on start
    this.checkAndResetStaleOCRJobs();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkAndResetStaleOCRJobs();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Stale OCR job monitor stopped');
  }

  private async checkAndResetStaleOCRJobs(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      const staleThreshold = new Date(Date.now() - this.staleThresholdMs).toISOString();
      let totalReset = 0;

      for (const env of environments) {
        // Check if OCR is enabled for this environment
        const isOCREnabled = config.ocr.enabledEnvironments[env];
        if (!isOCREnabled) {
          logger.debug({ environment: env }, 'OCR disabled for environment, skipping stale job check');
          continue;
        }

        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Find stale OCR jobs (status_id = 6, stuck for > threshold)
        const { data: staleJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, ocr_worker_id, ocr_started_at, document_source, document_number, ocr_attempts')
          .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
          .lt('ocr_started_at', staleThreshold);

        if (queryError) {
          // Check if error is due to missing column (migration not applied)
          if (queryError.code === '42703') {
            // Column doesn't exist - migration 005 not applied yet
            // This is expected for environments without OCR tracking columns
            logger.debug({
              environment: env,
              missingColumn: queryError.message.match(/column (.*?) does not exist/)?.[1] || 'unknown'
            }, 'OCR tracking columns not available in this environment - skipping stale job check');
            continue;
          }

          // For other errors, log as error
          logger.error({ error: queryError, environment: env }, 'Error querying for stale OCR jobs');
          continue;
        }

        if (!staleJobs || staleJobs.length === 0) {
          continue;
        }

        logger.warn({
          environment: env,
          count: staleJobs.length,
          jobs: staleJobs.map(j => ({
            id: j.id,
            document: j.document_number,
            worker: j.ocr_worker_id,
            started: j.ocr_started_at,
            attempts: j.ocr_attempts
          }))
        }, `Found ${staleJobs.length} stale OCR job(s)`);

        // Reset stale OCR jobs back to COMPLETE status so they can be retried
        const { error: updateError } = await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE, // Reset to ready for OCR retry
            ocr_worker_id: null,
            ocr_error: 'Reset by stale OCR monitor - job exceeded processing time limit',
            ocr_last_error_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
          .lt('ocr_started_at', staleThreshold);

        if (updateError) {
          logger.error({ error: updateError, environment: env }, 'Error resetting stale OCR jobs');
          continue;
        }

        totalReset += staleJobs.length;

        logger.info({
          environment: env,
          count: staleJobs.length,
          statusChange: 'OCR_PROCESSING (6) → COMPLETE (3)',
          readyFor: 'Automatic retry by OCR Monitor'
        }, `Reset ${staleJobs.length} stale OCR job(s)`);
      }

      if (totalReset > 0) {
        logger.info({
          totalReset,
          nextCheckSeconds: this.checkIntervalMs / 1000
        }, 'Stale OCR monitor cycle complete');
      }
    } catch (error) {
      logger.error({ error }, 'Error in stale OCR job monitor');
    }
  }

  /**
   * Run a single check immediately (useful for testing)
   */
  async runOnce(): Promise<void> {
    await this.checkAndResetStaleOCRJobs();
  }
}

// Export a singleton instance
export const staleOCRMonitor = new StaleOCRMonitor();


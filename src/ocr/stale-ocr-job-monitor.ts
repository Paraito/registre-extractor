import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Background monitor that periodically checks for and resets stale OCR jobs
 * This provides a safety net in case OCR workers crash or jobs get stuck
 */
export class StaleOCRJobMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private staleThresholdMs: number;
  private isRunning: boolean = false;

  constructor(
    checkIntervalMs: number = 30000, // Check every 30 seconds
    staleThresholdMs: number = 3 * 60 * 1000 // 3 minutes threshold
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
    logger.info({
      checkIntervalMs: this.checkIntervalMs,
      staleThresholdMs: this.staleThresholdMs,
    }, 'Starting stale OCR job monitor');

    // Run immediately on start
    this.checkAndResetStaleJobs();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkAndResetStaleJobs();
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

  private async checkAndResetStaleJobs(): Promise<void> {
    try {
      // Get OCR-enabled environments
      const allEnvs = supabaseManager.getAvailableEnvironments();
      const enabledEnvs = allEnvs.filter(env => config.ocr.enabledEnvironments[env] === true);

      const staleThreshold = new Date(Date.now() - this.staleThresholdMs).toISOString();
      let totalReset = 0;

      for (const env of enabledEnvs) {
        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Find stale OCR jobs
        const { data: staleJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, ocr_worker_id, ocr_started_at, document_source, document_number')
          .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
          .lt('ocr_started_at', staleThreshold);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying for stale OCR jobs');
          continue;
        }

        if (!staleJobs || staleJobs.length === 0) {
          continue;
        }

        logger.warn({
          environment: env,
          count: staleJobs.length,
          jobs: staleJobs.map(j => ({ id: j.id, worker: j.ocr_worker_id })),
        }, 'Found stale OCR jobs');

        // Reset stale jobs
        const { error: updateError } = await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE,
            ocr_worker_id: null,
            ocr_started_at: null,
            ocr_error: 'Reset by stale OCR job monitor - job exceeded processing time limit',
            ocr_last_error_at: new Date().toISOString(),
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
        }, 'Reset stale OCR jobs');
      }

      if (totalReset > 0) {
        logger.info({ totalReset }, 'Stale OCR job monitor completed reset cycle');
      }
    } catch (error) {
      logger.error({ error }, 'Error in stale OCR job monitor');
    }
  }

  /**
   * Run a single check immediately (useful for testing)
   */
  async runOnce(): Promise<void> {
    await this.checkAndResetStaleJobs();
  }
}

// Export a singleton instance
export const staleOCRJobMonitor = new StaleOCRJobMonitor();


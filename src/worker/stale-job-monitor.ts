import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';
import { logger } from '../utils/logger';

/**
 * Background monitor that periodically checks for and resets stale jobs
 * This provides a safety net in case workers crash or jobs get stuck
 */
export class StaleJobMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private staleThresholdMs: number;
  private isRunning: boolean = false;

  constructor(
    checkIntervalMs: number = 30000, // Check every 30 seconds (more aggressive)
    staleThresholdMs: number = 3 * 60 * 1000 // 3 minutes threshold (reduced from 5)
  ) {
    this.checkIntervalMs = checkIntervalMs;
    this.staleThresholdMs = staleThresholdMs;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Stale job monitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ 
      checkIntervalMs: this.checkIntervalMs,
      staleThresholdMs: this.staleThresholdMs 
    }, 'Starting stale job monitor');

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
    logger.info('Stale job monitor stopped');
  }

  private async checkAndResetStaleJobs(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      const staleThreshold = new Date(Date.now() - this.staleThresholdMs).toISOString();
      let totalReset = 0;

      for (const env of environments) {
        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Find stale jobs
        const { data: staleJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, worker_id, processing_started_at, document_source, document_number')
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
          .lt('processing_started_at', staleThreshold);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying for stale jobs');
          continue;
        }

        if (!staleJobs || staleJobs.length === 0) {
          continue;
        }

        logger.warn({ 
          environment: env,
          count: staleJobs.length,
          jobs: staleJobs.map(j => ({ id: j.id, worker: j.worker_id }))
        }, 'Found stale jobs');

        // Reset stale jobs
        const { error: updateError } = await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
            error_message: 'Reset by stale job monitor - job exceeded processing time limit'
          })
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
          .lt('processing_started_at', staleThreshold);

        if (updateError) {
          logger.error({ error: updateError, environment: env }, 'Error resetting stale jobs');
          continue;
        }

        totalReset += staleJobs.length;
        logger.info({ 
          environment: env,
          count: staleJobs.length 
        }, 'Reset stale jobs');
      }

      if (totalReset > 0) {
        logger.info({ totalReset }, 'Stale job monitor completed reset cycle');
      }
    } catch (error) {
      logger.error({ error }, 'Error in stale job monitor');
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
export const staleJobMonitor = new StaleJobMonitor();


import { supabaseManager } from '../utils/supabase';
import { EXTRACTION_STATUS } from '../types';
import { logger } from '../utils/logger';

/**
 * Standalone health monitoring service
 * Runs independently to monitor and auto-heal the system
 * 
 * Features:
 * - Auto-reset stuck jobs
 * - Detect and cleanup dead workers
 * - Monitor system health
 * - Alert on anomalies
 */
export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private checkIntervalMs: number;
  private staleJobThresholdMs: number;
  private deadWorkerThresholdMs: number;

  constructor(
    checkIntervalMs: number = 30000, // Check every 30 seconds
    staleJobThresholdMs: number = 3 * 60 * 1000, // 3 minutes for stuck jobs
    deadWorkerThresholdMs: number = 2 * 60 * 1000 // 2 minutes for dead workers
  ) {
    this.checkIntervalMs = checkIntervalMs;
    this.staleJobThresholdMs = staleJobThresholdMs;
    this.deadWorkerThresholdMs = deadWorkerThresholdMs;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Health monitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ 
      checkIntervalMs: this.checkIntervalMs,
      staleJobThresholdMs: this.staleJobThresholdMs,
      deadWorkerThresholdMs: this.deadWorkerThresholdMs
    }, '🏥 Health monitor started');

    // Run immediately on start
    this.runHealthCheck();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runHealthCheck();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Health monitor stopped');
  }

  private async runHealthCheck(): Promise<void> {
    try {
      await Promise.all([
        this.resetStuckJobs(),
        this.cleanupDeadWorkers(),
        this.checkSystemHealth()
      ]);
    } catch (error) {
      logger.error({ error }, 'Error in health check cycle');
    }
  }

  /**
   * Auto-reset jobs stuck in processing
   */
  private async resetStuckJobs(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      const staleThreshold = new Date(Date.now() - this.staleJobThresholdMs).toISOString();
      let totalReset = 0;

      for (const env of environments) {
        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Find and reset stuck jobs in one query
        const { data: stuckJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, worker_id, processing_started_at, document_source, document_number')
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
          .lt('processing_started_at', staleThreshold);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying stuck jobs');
          continue;
        }

        if (!stuckJobs || stuckJobs.length === 0) {
          continue;
        }

        // Reset all stuck jobs
        const { error: updateError } = await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
            error_message: 'Auto-reset by health monitor - exceeded processing time limit'
          })
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
          .lt('processing_started_at', staleThreshold);

        if (updateError) {
          logger.error({ error: updateError, environment: env }, 'Error resetting stuck jobs');
          continue;
        }

        totalReset += stuckJobs.length;
        
        logger.warn({ 
          environment: env,
          count: stuckJobs.length,
          jobs: stuckJobs.map(j => ({ 
            id: j.id.substring(0, 8), 
            worker: j.worker_id?.substring(0, 8),
            doc: `${j.document_source}:${j.document_number}`
          }))
        }, '🔄 Auto-reset stuck jobs');
      }

      if (totalReset > 0) {
        logger.info({ totalReset }, '✅ Stuck jobs auto-reset completed');
      }
    } catch (error) {
      logger.error({ error }, 'Error in resetStuckJobs');
    }
  }

  /**
   * Cleanup workers that haven't sent heartbeat
   */
  private async cleanupDeadWorkers(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      const deadThreshold = new Date(Date.now() - this.deadWorkerThresholdMs).toISOString();
      let totalCleaned = 0;

      for (const env of environments) {
        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Find dead workers
        const { data: deadWorkers, error: queryError } = await client
          .from('worker_status')
          .select('worker_id, last_heartbeat, current_job_id')
          .lt('last_heartbeat', deadThreshold);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying dead workers');
          continue;
        }

        if (!deadWorkers || deadWorkers.length === 0) {
          continue;
        }

        // Release any jobs held by dead workers
        for (const worker of deadWorkers) {
          if (worker.current_job_id) {
            await client
              .from('extraction_queue')
              .update({
                status_id: EXTRACTION_STATUS.EN_ATTENTE,
                worker_id: null,
                processing_started_at: null,
                error_message: `Released by health monitor - worker ${worker.worker_id} is dead`
              })
              .eq('id', worker.current_job_id)
              .eq('worker_id', worker.worker_id);
          }
        }

        // Mark workers as offline
        const { error: updateError } = await client
          .from('worker_status')
          .update({ status: 'offline' })
          .lt('last_heartbeat', deadThreshold);

        if (updateError) {
          logger.error({ error: updateError, environment: env }, 'Error updating dead workers');
          continue;
        }

        totalCleaned += deadWorkers.length;
        
        logger.warn({ 
          environment: env,
          count: deadWorkers.length,
          workers: deadWorkers.map(w => w.worker_id.substring(0, 8))
        }, '💀 Cleaned up dead workers');
      }

      if (totalCleaned > 0) {
        logger.info({ totalCleaned }, '✅ Dead workers cleanup completed');
      }
    } catch (error) {
      logger.error({ error }, 'Error in cleanupDeadWorkers');
    }
  }

  /**
   * Check overall system health and log warnings
   */
  private async checkSystemHealth(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      
      for (const env of environments) {
        const client = supabaseManager.getServiceClient(env);
        if (!client) continue;

        // Count active workers
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { count: activeWorkers } = await client
          .from('worker_status')
          .select('*', { count: 'exact', head: true })
          .gt('last_heartbeat', twoMinutesAgo);

        // Count jobs by status
        const { count: pendingJobs } = await client
          .from('extraction_queue')
          .select('*', { count: 'exact', head: true })
          .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE);

        const { count: processingJobs } = await client
          .from('extraction_queue')
          .select('*', { count: 'exact', head: true })
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT);

        const { count: errorJobs } = await client
          .from('extraction_queue')
          .select('*', { count: 'exact', head: true })
          .eq('status_id', EXTRACTION_STATUS.ERREUR);

        // Log health status every 5 minutes (10 checks * 30s)
        if (Math.random() < 0.1) { // ~10% chance = roughly every 5 minutes
          logger.info({
            environment: env,
            activeWorkers: activeWorkers || 0,
            pendingJobs: pendingJobs || 0,
            processingJobs: processingJobs || 0,
            errorJobs: errorJobs || 0
          }, '📊 System health status');
        }

        // Alert on anomalies
        if ((activeWorkers || 0) === 0 && (pendingJobs || 0) > 0) {
          logger.warn({
            environment: env,
            pendingJobs: pendingJobs || 0
          }, '⚠️  No active workers but jobs are pending!');
        }

        if ((processingJobs || 0) > (activeWorkers || 0) * 2) {
          logger.warn({
            environment: env,
            processingJobs: processingJobs || 0,
            activeWorkers: activeWorkers || 0
          }, '⚠️  More processing jobs than expected for active workers');
        }

        if ((errorJobs || 0) > 10) {
          logger.warn({
            environment: env,
            errorJobs: errorJobs || 0
          }, '⚠️  High number of failed jobs');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error in checkSystemHealth');
    }
  }
}

// Create and export singleton instance
export const healthMonitor = new HealthMonitor();


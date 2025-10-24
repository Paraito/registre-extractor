import { supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ExtractionQueueJob, EXTRACTION_STATUS } from '../types';
import { GeminiClient } from './gemini-client';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface OCRJobWithEnv extends ExtractionQueueJob {
  _environment: EnvironmentName;
}

/**
 * OCR Worker for processing documents from extraction_queue
 * Picks up jobs with status_id = 3 (COMPLETE) and performs OCR extraction
 */
export class OCRWorker {
  private workerId: string;
  private geminiClient: GeminiClient;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  private tempDir: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(workerId?: string) {
    this.workerId = workerId || `ocr-worker-${uuidv4().substring(0, 8)}`;
    this.tempDir = config.ocr.tempDir || path.join(os.tmpdir(), 'ocr-processing');

    // Initialize Gemini client
    if (!config.ocr.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for OCR worker');
    }

    this.geminiClient = new GeminiClient(
      config.ocr.geminiApiKey,
      config.ocr.extractModel.gemini
    );

    logger.info({ workerId: this.workerId }, 'OCR Worker created');
  }

  async initialize(): Promise<void> {
    try {
      // Create temp directory
      await fs.mkdir(this.tempDir, { recursive: true });

      // Log available environments
      const environments = this.getEnabledEnvironments();
      logger.info({
        workerId: this.workerId,
        environments: environments.join(', ') || 'none',
        tempDir: this.tempDir,
      }, 'OCR Worker starting');

      if (environments.length === 0) {
        throw new Error('No OCR-enabled environments configured');
      }

      // Reset stuck jobs on startup
      await this.resetStuckJobsOnStartup(environments);

      // Start heartbeat
      this.startHeartbeat();

      // Start continuous processing
      this.processContinuously();

      logger.info({ workerId: this.workerId }, 'OCR Worker initialized and ready');
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to initialize OCR worker');
      throw error;
    }
  }

  /**
   * Get list of environments where OCR is enabled
   */
  private getEnabledEnvironments(): EnvironmentName[] {
    const allEnvs = supabaseManager.getAvailableEnvironments();
    return allEnvs.filter(env => {
      const enabled = config.ocr.enabledEnvironments[env];
      return enabled === true;
    });
  }

  /**
   * Reset stuck OCR jobs on startup
   */
  private async resetStuckJobsOnStartup(environments: EnvironmentName[]): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Checking for stuck OCR jobs on startup...');

    let totalReset = 0;
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      try {
        const { data: stuckJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, ocr_worker_id, document_source, document_number, ocr_started_at')
          .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
          .lt('ocr_started_at', twoMinutesAgo);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying stuck OCR jobs');
          continue;
        }

        if (stuckJobs && stuckJobs.length > 0) {
          const { error: updateError } = await client
            .from('extraction_queue')
            .update({
              status_id: EXTRACTION_STATUS.COMPLETE,
              ocr_worker_id: null,
              ocr_started_at: null,
              ocr_error: 'Reset by OCR worker on startup - job exceeded processing time limit',
              ocr_last_error_at: new Date().toISOString(),
            })
            .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
            .lt('ocr_started_at', twoMinutesAgo);

          if (updateError) {
            logger.error({ error: updateError, environment: env }, 'Error resetting stuck OCR jobs');
            continue;
          }

          totalReset += stuckJobs.length;
          logger.warn({
            environment: env,
            count: stuckJobs.length,
            jobs: stuckJobs.map(j => ({
              id: j.id.substring(0, 8),
              worker: j.ocr_worker_id?.substring(0, 8),
              doc: `${j.document_source}:${j.document_number}`,
            })),
          }, '🔄 Reset stuck OCR jobs on startup');
        }
      } catch (error) {
        logger.error({ error, environment: env }, 'Error in resetStuckJobsOnStartup');
      }
    }

    if (totalReset > 0) {
      logger.info({ totalReset }, `✅ Reset ${totalReset} stuck OCR job(s) on startup`);
    } else {
      logger.info('✅ No stuck OCR jobs found');
    }
  }

  /**
   * Start heartbeat to track worker health
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      logger.debug({ workerId: this.workerId, isProcessing: this.isProcessing }, 'OCR Worker heartbeat');
    }, 30000); // Every 30 seconds
  }

  /**
   * Continuously process jobs
   */
  private async processContinuously(): Promise<void> {
    while (!this.shouldStop) {
      let currentJob: OCRJobWithEnv | null = null;

      try {
        const job = await this.getNextJob();
        currentJob = job;

        if (!job) {
          // No jobs available, wait before checking again
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Process the job
        await this.processJob(job);
      } catch (error) {
        logger.error({
          error,
          workerId: this.workerId,
          jobId: currentJob?.id,
        }, 'Error in OCR processing loop');

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Get next available OCR job
   */
  private async getNextJob(): Promise<OCRJobWithEnv | null> {
    const environments = this.getEnabledEnvironments();

    if (environments.length === 0) {
      return null;
    }

    // Check for stale jobs and reset them
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      // Reset stale jobs
      const { data: staleJobs } = await client
        .from('extraction_queue')
        .select('*')
        .eq('status_id', EXTRACTION_STATUS.OCR_PROCESSING)
        .lt('ocr_started_at', fiveMinutesAgo)
        .limit(1);

      if (staleJobs && staleJobs.length > 0) {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE,
            ocr_worker_id: null,
            ocr_started_at: null,
          })
          .eq('id', staleJobs[0].id);

        logger.warn({ jobId: staleJobs[0].id, environment: env }, 'Reset stale OCR job');
      }
    }

    // Poll all enabled environments for pending OCR jobs
    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) {
        logger.debug({ environment: env, workerId: this.workerId }, 'No client available for environment');
        continue;
      }

      logger.debug({ environment: env, workerId: this.workerId }, 'Polling for OCR jobs');

      // Find jobs ready for OCR: status_id=3, has supabase_path, ocr_attempts < ocr_max_attempts
      const { data, error } = await client
        .from('extraction_queue')
        .select('*')
        .eq('status_id', EXTRACTION_STATUS.COMPLETE)
        .not('supabase_path', 'is', null)
        .or('ocr_attempts.is.null,ocr_attempts.lt.' + (3)) // Default max attempts is 3
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        logger.error({
          error,
          environment: env,
          workerId: this.workerId,
          errorMessage: error.message,
          errorDetails: error.details,
          errorHint: error.hint,
        }, 'Error querying for OCR jobs');
        continue;
      }

      if (!data || data.length === 0) {
        logger.debug({ environment: env, workerId: this.workerId }, 'No OCR jobs found in environment');
        continue;
      }

      const job = data[0];
      logger.debug({
        jobId: job.id,
        environment: env,
        workerId: this.workerId,
        documentNumber: job.document_number,
        documentSource: job.document_source,
        ocrAttempts: job.ocr_attempts,
        ocrMaxAttempts: job.ocr_max_attempts,
      }, 'Found OCR job, attempting to claim');

      // Try to claim the job atomically
      const { data: claimedJob, error: claimError } = await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_PROCESSING,
          ocr_worker_id: this.workerId,
          ocr_started_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status_id', EXTRACTION_STATUS.COMPLETE) // Ensure it's still available
        .select()
        .single();

      if (claimError) {
        logger.warn({
          error: claimError,
          jobId: job.id,
          environment: env,
          workerId: this.workerId,
          errorMessage: claimError.message,
        }, 'Error claiming OCR job');
        continue;
      }

      if (!claimedJob) {
        logger.debug({
          jobId: job.id,
          environment: env,
          workerId: this.workerId,
        }, 'Job was claimed by another worker');
        continue;
      }

      logger.info({ jobId: claimedJob.id, environment: env }, 'Claimed OCR job');

      return {
        ...claimedJob,
        _environment: env,
      };
    }

    logger.debug({ workerId: this.workerId }, 'No OCR jobs available in any environment');
    return null;
  }

  /**
   * Process a single OCR job
   */
  private async processJob(job: OCRJobWithEnv): Promise<void> {
    const environment = job._environment;
    const client = supabaseManager.getServiceClient(environment);

    if (!client) {
      logger.error({ environment }, 'No Supabase client for environment');
      return;
    }

    this.isProcessing = true;

    logger.info('='.repeat(60));
    logger.info('📄 OCR JOB STARTED');
    logger.info('='.repeat(60));
    logger.info(`   Job ID: ${job.id}`);
    logger.info(`   Document: ${job.document_source} - ${job.document_number}`);
    logger.info(`   Environment: ${environment}`);
    logger.info(`   Worker: ${this.workerId}`);
    logger.info(`   Attempt: ${(job.ocr_attempts || 0) + 1}/${job.ocr_max_attempts || 3}`);
    logger.info('');

    // Skip OCR for plan_cadastraux - just mark as complete
    if (job.document_source === 'plan_cadastraux') {
      logger.info({ jobId: job.id }, '⏭️  Skipping OCR for plan_cadastraux (not supported)');

      await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
          ocr_completed_at: new Date().toISOString(),
          file_content: null, // No OCR content for plans
        })
        .eq('id', job.id);

      logger.info('='.repeat(60));
      logger.info('✅ OCR JOB SKIPPED (plan_cadastraux)');
      logger.info('='.repeat(60));
      logger.info('');

      this.isProcessing = false;
      return;
    }

    try {
      // Download file from Supabase Storage
      const localFilePath = await this.downloadFile(job, client);

      // Load appropriate prompt
      const prompt = await GeminiClient.loadPrompt(job.document_source);

      // Process with Gemini
      logger.info({ jobId: job.id }, '🤖 Starting Gemini OCR extraction...');
      const result = await this.geminiClient.processFile(
        localFilePath,
        prompt
      );

      // Cleanup local file
      await fs.unlink(localFilePath);

      if (!result.success) {
        throw new Error(result.error || 'OCR extraction failed');
      }

      // Update job with success
      await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
          file_content: result.content,
          ocr_completed_at: new Date().toISOString(),
          ocr_attempts: (job.ocr_attempts || 0) + 1,
        })
        .eq('id', job.id);

      logger.info('='.repeat(60));
      logger.info('✅ OCR JOB COMPLETED SUCCESSFULLY');
      logger.info('='.repeat(60));
      logger.info(`   Job ID: ${job.id}`);
      logger.info(`   Content Length: ${result.content.length} characters`);
      logger.info('');
    } catch (error) {
      await this.handleJobError(job, error, client);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Download file from Supabase Storage to local temp directory
   */
  private async downloadFile(job: ExtractionQueueJob, client: any): Promise<string> {
    if (!job.supabase_path) {
      throw new Error('No supabase_path found for job');
    }

    // Parse bucket and file path from supabase_path
    // Format: "bucket/filename.pdf" or just "filename.pdf" (legacy)
    let bucketName: string;
    let filePath: string;

    if (job.supabase_path.includes('/')) {
      // New format: "bucket/filename.pdf"
      const parts = job.supabase_path.split('/');
      bucketName = parts[0];
      filePath = parts.slice(1).join('/');
    } else {
      // Legacy format: just "filename.pdf" - determine bucket from document_source
      const bucketMap: Record<string, string> = {
        'index': 'index',
        'acte': 'actes',
        'plan_cadastraux': 'plans-cadastraux',
      };
      bucketName = bucketMap[job.document_source];
      filePath = job.supabase_path;

      if (!bucketName) {
        throw new Error(`Unknown document_source: ${job.document_source}`);
      }
    }

    logger.info({ bucket: bucketName, path: filePath }, 'Downloading file from Supabase');

    const { data, error } = await client.storage
      .from(bucketName)
      .download(filePath);

    if (error || !data) {
      throw new Error(`Failed to download file: ${error?.message || 'Unknown error'}`);
    }

    // Save to temp file
    const localFilePath = path.join(this.tempDir, `${job.id}.pdf`);
    const buffer = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(localFilePath, buffer);

    logger.info({ localFilePath, size: buffer.length }, 'File downloaded successfully');

    return localFilePath;
  }

  /**
   * Handle job processing error
   */
  private async handleJobError(job: OCRJobWithEnv, error: unknown, client: any): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const attempts = (job.ocr_attempts || 0) + 1;
    const maxAttempts = job.ocr_max_attempts || 3;

    logger.error({
      error,
      jobId: job.id,
      attempts,
      maxAttempts,
    }, 'OCR job failed');

    await client
      .from('extraction_queue')
      .update({
        status_id: attempts >= maxAttempts ? EXTRACTION_STATUS.ERREUR : EXTRACTION_STATUS.COMPLETE,
        ocr_error: errorMessage,
        ocr_last_error_at: new Date().toISOString(),
        ocr_attempts: attempts,
        ocr_worker_id: attempts >= maxAttempts ? this.workerId : null,
        ocr_started_at: attempts >= maxAttempts ? job.ocr_started_at : null,
      })
      .eq('id', job.id);

    logger.info('='.repeat(60));
    logger.info(attempts >= maxAttempts ? '❌ OCR JOB FAILED (MAX ATTEMPTS REACHED)' : '⚠️  OCR JOB FAILED (WILL RETRY)');
    logger.info('='.repeat(60));
    logger.info(`   Job ID: ${job.id}`);
    logger.info(`   Error: ${errorMessage}`);
    logger.info(`   Attempts: ${attempts}/${maxAttempts}`);
    logger.info('');
  }

  /**
   * Shutdown worker gracefully
   */
  async shutdown(): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Shutting down OCR worker');

    this.shouldStop = true;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Wait for current job to finish
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info({ workerId: this.workerId }, 'OCR worker shutdown complete');
  }
}


/**
 * Unified Worker System
 * Handles all job types: Land Registry (extraction), REQ, and RDPRM
 */

import { AIRegistreExtractor as RegistreExtractor } from './extractor-ai';
import { supabase, supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ExtractionQueueJob, WorkerAccount, WorkerStatus, EXTRACTION_STATUS } from '../types';
import type { SearchSession, RDPRMSearch, UnifiedWorkerJob } from '../types/req-rdprm';
import { scrapeRegistreEntreprise } from '../req/scraper';
import { scrapeRDPRM } from '../rdprm/scraper';
import { convertToExtractionConfig } from '../queue/manager';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

/**
 * Unified Worker Class
 * Can process extraction jobs, REQ searches, and RDPRM searches
 */
export class UnifiedWorker {
  private workerId: string;
  private extractor: RegistreExtractor | null = null;
  private workerStatus: WorkerStatus;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentAccount: WorkerAccount | null = null;
  private shouldStop: boolean = false;
  private lastJobTime: number = Date.now();
  private idleTimeoutMs: number = 2 * 60 * 1000; // 2 minutes idle before closing browser

  constructor(workerId?: string) {
    this.workerId = workerId || `unified-worker-${uuidv4()}`;
    this.workerStatus = {
      id: uuidv4(),
      worker_id: this.workerId,
      status: 'idle',
      last_heartbeat: new Date().toISOString(),
      started_at: new Date().toISOString(),
      jobs_completed: 0,
      jobs_failed: 0,
    };
  }

  async initialize(): Promise<void> {
    try {
      const environments = supabaseManager.getAvailableEnvironments();
      logger.info({
        workerId: this.workerId,
        environments: environments.join(', ') || 'none',
      }, '🚀 Unified Worker starting with environments');

      if (environments.length === 0) {
        throw new Error('No Supabase environments configured. Please set up environment credentials in .env');
      }

      // Reset stuck jobs on startup
      await this.resetStuckJobsOnStartup(environments);

      // Register worker
      await this.registerWorker();

      // Start heartbeat
      this.startHeartbeat();

      // Get account (for land registry extraction)
      this.currentAccount = await this.getAvailableAccount();
      this.workerStatus.account_id = this.currentAccount.id;

      logger.info({
        workerId: this.workerId,
        account: this.currentAccount.username,
        environments: environments.join(', '),
      }, '✅ Unified Worker registered and ready');

      // Start continuous job processing
      this.processContinuously();
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to initialize unified worker');
      throw error;
    }
  }

  /**
   * Initialize extractor for land registry jobs
   */
  private async initializeExtractor(): Promise<void> {
    if (!this.currentAccount) {
      throw new Error('No account available');
    }

    logger.info({ workerId: this.workerId }, 'Initializing land registry extractor');

    this.extractor = new RegistreExtractor(
      this.currentAccount,
      this.workerId,
      config.headless  // Use config.headless instead of config.isProduction
    );

    await this.extractor.initialize();

    // Login to the registry
    logger.info({ workerId: this.workerId }, 'Logging in to land registry');
    await this.extractor.login();

    logger.info({ workerId: this.workerId }, 'Land registry extractor initialized and logged in');
  }

  /**
   * Close extractor to free resources
   */
  private async closeExtractor(): Promise<void> {
    if (this.extractor) {
      logger.info({ workerId: this.workerId }, 'Closing land registry extractor');
      await this.extractor.close();
      this.extractor = null;
    }
  }

  /**
   * Reset stuck jobs on startup
   */
  private async resetStuckJobsOnStartup(environments: EnvironmentName[]): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Checking for stuck jobs on startup');

    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      try {
        // Reset stuck extraction jobs
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

        const { data: stuckJobs, error: queryError } = await client
          .from('extraction_queue')
          .select('id, worker_id, document_source, document_number, processing_started_at')
          .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
          .lt('processing_started_at', twoMinutesAgo);

        if (queryError) {
          logger.error({ error: queryError, environment: env }, 'Error querying stuck jobs on startup');
          continue;
        }

        if (stuckJobs && stuckJobs.length > 0) {
          logger.warn({
            environment: env,
            count: stuckJobs.length,
            jobs: stuckJobs.map(j => ({ id: j.id.substring(0, 8), worker: j.worker_id }))
          }, 'Found stuck extraction jobs on startup, resetting them');

          for (const job of stuckJobs) {
            await client
              .from('extraction_queue')
              .update({
                status_id: EXTRACTION_STATUS.EN_ATTENTE,
                worker_id: null,
                processing_started_at: null,
                error_message: 'Reset by worker on startup - previous worker may have crashed'
              })
              .eq('id', job.id);
          }
        }
      } catch (error) {
        logger.error({ error, environment: env }, 'Error resetting stuck jobs on startup');
      }
    }
  }

  /**
   * Register worker in database
   */
  private async registerWorker(): Promise<void> {
    const { error } = await supabase
      .from('worker_status')
      .upsert(this.workerStatus);

    if (error) {
      throw new Error(`Failed to register worker: ${error.message}`);
    }
  }

  /**
   * Start heartbeat to keep worker status updated
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        this.workerStatus.last_heartbeat = new Date().toISOString();
        await supabase
          .from('worker_status')
          .update({
            last_heartbeat: this.workerStatus.last_heartbeat,
            status: this.workerStatus.status,
            jobs_completed: this.workerStatus.jobs_completed,
            jobs_failed: this.workerStatus.jobs_failed,
            current_job_id: this.workerStatus.current_job_id,
          })
          .eq('worker_id', this.workerId);
      } catch (error) {
        logger.error({ error, workerId: this.workerId }, 'Heartbeat failed');
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get available account for land registry extraction
   */
  private async getAvailableAccount(): Promise<WorkerAccount> {
    const { data: accounts, error } = await supabase
      .from('worker_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (error || !accounts || accounts.length === 0) {
      throw new Error('No available worker accounts');
    }

    const account = accounts[0];

    // Mark account as in use
    await supabase
      .from('worker_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', account.id);

    return account;
  }

  /**
   * Continuous job processing
   */
  private async processContinuously(): Promise<void> {
    while (!this.shouldStop) {
      let currentJob: UnifiedWorkerJob | null = null;

      try {
        // Get next job from any source
        const job = await this.getNextJob();
        currentJob = job;

        if (!job) {
          // Check idle timeout
          const idleTime = Date.now() - this.lastJobTime;

          if (idleTime > this.idleTimeoutMs && this.extractor) {
            logger.info(
              {
                workerId: this.workerId,
                idleMinutes: Math.round(idleTime / 60000),
              },
              'Worker idle timeout - closing browser'
            );
            await this.closeExtractor();
          }

          // No jobs available, wait
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Update last job time
        this.lastJobTime = Date.now();

        // Process the job based on type
        await this.processJob(job);
      } catch (error) {
        logger.error(
          {
            error,
            workerId: this.workerId,
            jobId: currentJob?.id,
            jobType: currentJob?._job_type,
            environment: currentJob?._environment,
          },
          'Error in continuous processing'
        );

        // Reset job if stuck
        if (currentJob) {
          await this.resetJobOnError(currentJob, error);
        }

        // Close extractor on browser errors
        if (
          error instanceof Error &&
          (error.message.includes('browser') ||
            error.message.includes('closed') ||
            error.message.includes('Target closed'))
        ) {
          await this.closeExtractor();
        }

        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  /**
   * Get next job from any source (extraction, REQ, or RDPRM)
   */
  private async getNextJob(): Promise<UnifiedWorkerJob | null> {
    this.workerStatus.status = 'idle';

    const environments = supabaseManager.getAvailableEnvironments();
    if (environments.length === 0) {
      logger.error('No Supabase environments configured');
      return null;
    }

    logger.debug({ environments: environments.join(', ') }, '🔄 Polling for jobs across environments');

    // Poll all environments for any job type
    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) {
        logger.warn({ environment: env }, '⚠️ No client available for environment');
        continue;
      }

      // Priority 1: Check for pending extraction jobs
      const extractionJob = await this.getNextExtractionJob(client, env);
      if (extractionJob) return extractionJob;

      // Priority 2: Check for pending REQ jobs
      const reqJob = await this.getNextREQJob(client, env);
      if (reqJob) return reqJob;

      // Priority 3: Check for pending RDPRM jobs
      const rdprmJob = await this.getNextRDPRMJob(client, env);
      if (rdprmJob) return rdprmJob;
    }

    logger.debug('💤 No jobs found in any environment');
    return null;
  }

  /**
   * Get next extraction job (land registry)
   */
  private async getNextExtractionJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
    const { data, error } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)
      .order('created_at', { ascending: true })
      .limit(10); // Get multiple jobs to filter

    if (error) {
      logger.error({ error, environment: env }, '❌ Error querying extraction_queue');
      return null;
    }

    if (!data || data.length === 0) {
      logger.debug({ environment: env }, '🔍 No extraction jobs found');
      return null;
    }

    // Find first job that hasn't exceeded max attempts
    const job = data.find((j: ExtractionQueueJob) => {
      const attempts = j.attemtps || 0;
      const maxAttempts = j.max_attempts || 3;
      return attempts < maxAttempts;
    });

    if (!job) {
      // All jobs have exceeded max attempts - mark them as ERREUR
      logger.warn({
        environment: env,
        jobsFound: data.length
      }, '⚠️ All available jobs have exceeded max attempts - marking as ERREUR');

      for (const failedJob of data) {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.ERREUR,
            error_message: 'Max attempts exceeded',
          })
          .eq('id', failedJob.id)
          .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE);
      }

      return null;
    }

    // Claim the job
    const { data: claimedJob, error: claimError } = await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.EN_TRAITEMENT,
        worker_id: this.workerId,
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)
      .select()
      .single();

    if (claimError || !claimedJob) {
      logger.debug({ error: claimError, jobId: job.id.substring(0, 8), environment: env }, '⚠️ Failed to claim extraction job (likely race condition)');
      return null;
    }

    logger.info(
      {
        jobId: job.id.substring(0, 8),
        type: 'extraction',
        document: `${job.document_source}:${job.document_number}`,
        environment: env,
      },
      '📋 Claimed extraction job'
    );

    return {
      ...claimedJob,
      _job_type: 'extraction',
      _environment: env,
    };
  }

  /**
   * Get next REQ job
   */
  private async getNextREQJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
    const { data, error} = await client
      .from('search_sessions')
      .select('*')
      .eq('status', 'pending_company_selection')
      .eq('req_completed', false)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      logger.error({ error, environment: env }, '❌ Error querying search_sessions');
      return null;
    }

    if (!data || data.length === 0) {
      logger.debug({ environment: env }, '🔍 No REQ jobs found');
      return null;
    }

    const session = data[0];

    // Claim the job by updating status
    const { data: claimedSession, error: claimError } = await client
      .from('search_sessions')
      .update({
        status: 'scraping_company_data',
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .eq('status', 'pending_company_selection')
      .eq('req_completed', false)  // Ensure we only claim jobs that haven't been completed
      .select()
      .single();

    if (claimError || !claimedSession) {
      logger.debug({ error: claimError, sessionId: session.id.substring(0, 8), environment: env }, '⚠️ Failed to claim REQ job (likely race condition)');
      return null;
    }

    logger.info(
      {
        sessionId: session.id.substring(0, 8),
        type: 'req',
        company: session.initial_search_query,
        environment: env,
      },
      '📋 Claimed REQ job'
    );

    return {
      ...claimedSession,
      _job_type: 'req',
      _environment: env,
    };
  }

  /**
   * Get next RDPRM job
   */
  private async getNextRDPRMJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
    const { data, error } = await client
      .from('rdprm_searches')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      logger.error({ error, environment: env }, '❌ Error querying rdprm_searches');
      return null;
    }

    if (!data || data.length === 0) {
      logger.debug({ environment: env }, '🔍 No RDPRM jobs found');
      return null;
    }

    const search = data[0];

    // Claim the job
    const { data: claimedSearch, error: claimError } = await client
      .from('rdprm_searches')
      .update({
        status: 'in_progress',
      })
      .eq('id', search.id)
      .eq('status', 'pending')
      .select()
      .single();

    if (claimError || !claimedSearch) {
      logger.debug({ error: claimError, searchId: search.id.substring(0, 8), environment: env }, '⚠️ Failed to claim RDPRM job (likely race condition)');
      return null;
    }

    logger.info(
      {
        searchId: search.id.substring(0, 8),
        type: 'rdprm',
        company: search.search_name,
        environment: env,
      },
      '📋 Claimed RDPRM job'
    );

    return {
      ...claimedSearch,
      _job_type: 'rdprm',
      _environment: env,
      _session_id: search.search_session_id,
    };
  }

  /**
   * Process job based on type
   */
  private async processJob(job: UnifiedWorkerJob): Promise<void> {
    this.workerStatus.status = 'busy';
    this.workerStatus.current_job_id = job.id;

    try {
      if (job._job_type === 'extraction') {
        await this.processExtractionJob(job as unknown as ExtractionQueueJob & { _environment: EnvironmentName });
      } else if (job._job_type === 'req') {
        await this.processREQJob(job as unknown as SearchSession & { _environment: EnvironmentName });
      } else if (job._job_type === 'rdprm') {
        await this.processRDPRMJob(job as unknown as RDPRMSearch & { _environment: EnvironmentName; _session_id: string });
      }

      this.workerStatus.jobs_completed++;
      this.workerStatus.current_job_id = undefined;
    } catch (error) {
      this.workerStatus.jobs_failed++;
      this.workerStatus.current_job_id = undefined;
      throw error;
    }
  }

  /**
   * Process extraction job (land registry)
   */
  private async processExtractionJob(job: ExtractionQueueJob & { _environment: EnvironmentName }): Promise<void> {
    logger.info({ jobId: job.id.substring(0, 8), type: 'extraction' }, 'Processing extraction job');

    // Initialize extractor if needed
    if (!this.extractor) {
      await this.initializeExtractor();
    }

    const client = supabaseManager.getServiceClient(job._environment);
    if (!client) throw new Error(`No client for environment: ${job._environment}`);

    try {
      const extractionConfig = convertToExtractionConfig(job);
      await this.extractor!.navigateToSearch(extractionConfig.document_type);
      const localFilePath = await this.extractor!.extractDocument(extractionConfig);

      // Upload to Supabase with proper bucket and filename format (legacy format for OCR compatibility)
      const fileBuffer = await fs.readFile(localFilePath);

      // Get bucket name and filename using legacy format
      const { bucketName, fileName } = this.getStorageInfo(job);

      logger.info({
        jobId: job.id.substring(0, 8),
        fileName,
        fileSize: fileBuffer.length,
        environment: job._environment,
        bucket: bucketName
      }, 'Uploading PDF to Supabase');

      const { error: uploadError } = await client.storage
        .from(bucketName)
        .upload(fileName, fileBuffer, {
          upsert: true,
          contentType: 'application/pdf'  // Explicitly set MIME type
        });

      if (uploadError) {
        logger.error({
          jobId: job.id.substring(0, 8),
          uploadError,
          fileName,
          bucketName,
          environment: job._environment
        }, 'Failed to upload to Supabase');
        throw uploadError;
      }

      logger.info({
        jobId: job.id.substring(0, 8),
        fileName,
        bucketName,
        environment: job._environment,
        supabasePath: fileName
      }, 'PDF uploaded successfully');

      // Determine final status based on document source
      // plan_cadastraux doesn't need OCR, so set to EXTRACTION_COMPLETE (5)
      // index and acte need OCR, so set to COMPLETE (3)
      const finalStatus = job.document_source === 'plan_cadastraux'
        ? EXTRACTION_STATUS.EXTRACTION_COMPLETE
        : EXTRACTION_STATUS.COMPLETE;

      logger.info({
        jobId: job.id.substring(0, 8),
        documentSource: job.document_source,
        finalStatus,
        needsOCR: job.document_source !== 'plan_cadastraux'
      }, 'Setting final status');

      // Update job status
      const { data: updateData, error: updateError } = await client
        .from('extraction_queue')
        .update({
          status_id: finalStatus,
          supabase_path: fileName,
        })
        .eq('id', job.id)
        .select();

      if (updateError) {
        logger.error({
          jobId: job.id.substring(0, 8),
          updateError
        }, 'Failed to update job status');
        throw updateError;
      }

      // Verify the update
      const { data: verifyData, error: verifyError } = await client
        .from('extraction_queue')
        .select('id, status_id, supabase_path')
        .eq('id', job.id)
        .single();

      if (verifyError) {
        logger.error({ jobId: job.id.substring(0, 8), verifyError }, 'Failed to verify update');
      } else {
        logger.info({
          jobId: job.id.substring(0, 8),
          verifiedStatus: verifyData.status_id,
          verifiedPath: verifyData.supabase_path,
          expectedStatus: finalStatus,
          expectedPath: fileName
        }, 'Update verification');
      }

      logger.info({
        jobId: job.id.substring(0, 8),
        status: finalStatus,
        supabasePath: fileName,
        updateResult: updateData,
        ocrRequired: job.document_source !== 'plan_cadastraux'
      }, '✅ Extraction job completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const currentAttempts = (job.attemtps || 0) + 1;
      const maxAttempts = job.max_attempts || 3;
      const hasReachedMaxAttempts = currentAttempts >= maxAttempts;

      logger.error({
        jobId: job.id.substring(0, 8),
        error: errorMessage,
        currentAttempts,
        maxAttempts,
        hasReachedMaxAttempts,
        documentSource: job.document_source,
        documentNumber: job.document_number
      }, '❌ Extraction job failed');

      // Update job with error info and increment attempts
      const updatePayload: any = {
        attemtps: currentAttempts,
        error_message: errorMessage,
        worker_id: null, // Release the job
        processing_started_at: null,
      };

      // If max attempts reached, mark as ERREUR (4)
      // Otherwise, reset to EN_ATTENTE (1) for retry
      if (hasReachedMaxAttempts) {
        updatePayload.status_id = EXTRACTION_STATUS.ERREUR;
        logger.error({
          jobId: job.id.substring(0, 8),
          attempts: currentAttempts,
          maxAttempts
        }, '🚫 Max attempts reached - marking job as ERREUR');
      } else {
        updatePayload.status_id = EXTRACTION_STATUS.EN_ATTENTE;
        logger.warn({
          jobId: job.id.substring(0, 8),
          attempts: currentAttempts,
          maxAttempts,
          remainingAttempts: maxAttempts - currentAttempts
        }, '🔄 Resetting job to EN_ATTENTE for retry');
      }

      const { error: updateError } = await client
        .from('extraction_queue')
        .update(updatePayload)
        .eq('id', job.id);

      if (updateError) {
        logger.error({
          jobId: job.id.substring(0, 8),
          updateError
        }, 'Failed to update job after error - THIS IS CRITICAL');
      }

      throw error;
    }
  }

  /**
   * Process REQ job
   */
  private async processREQJob(job: SearchSession & { _environment: EnvironmentName }): Promise<void> {
    logger.info({ sessionId: job.id.substring(0, 8), type: 'req' }, 'Processing REQ job');

    const client = supabaseManager.getServiceClient(job._environment);
    if (!client) throw new Error(`No client for environment: ${job._environment}`);

    try {
      await scrapeRegistreEntreprise(job);

      await client
        .from('search_sessions')
        .update({
          status: 'pending_name_selection',
          req_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      logger.info({ sessionId: job.id.substring(0, 8) }, '✅ REQ job completed');
    } catch (error) {
      await client
        .from('search_sessions')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      throw error;
    }
  }

  /**
   * Process RDPRM job
   */
  private async processRDPRMJob(job: RDPRMSearch & { _environment: EnvironmentName; _session_id: string }): Promise<void> {
    logger.info({ searchId: job.id.substring(0, 8), type: 'rdprm' }, 'Processing RDPRM job');

    const client = supabaseManager.getServiceClient(job._environment);
    if (!client) throw new Error(`No client for environment: ${job._environment}`);

    try {
      await scrapeRDPRM(job);

      await client
        .from('rdprm_searches')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      logger.info({ searchId: job.id.substring(0, 8) }, '✅ RDPRM job completed');
    } catch (error) {
      await client
        .from('rdprm_searches')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', job.id);

      throw error;
    }
  }

  /**
   * Reset job on error
   */
  private async resetJobOnError(job: UnifiedWorkerJob, error: any): Promise<void> {
    const client = supabaseManager.getServiceClient(job._environment as EnvironmentName);
    if (!client) return;

    try {
      if (job._job_type === 'extraction') {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', job.id);
      } else if (job._job_type === 'req') {
        await client
          .from('search_sessions')
          .update({
            status: 'pending_company_selection',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      } else if (job._job_type === 'rdprm') {
        await client
          .from('rdprm_searches')
          .update({
            status: 'pending',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    } catch (resetError) {
      logger.error({ resetError, jobId: job.id }, 'Failed to reset job on error');
    }
  }

  /**
   * Get storage bucket and filename info (legacy format for OCR compatibility)
   */
  private getStorageInfo(job: ExtractionQueueJob): { bucketName: string; fileName: string } {
    const docNumber = (job.document_number_normalized || job.document_number).replace(/\s+/g, '');
    // Sanitize special characters for S3/Storage compatibility
    const circonscription = job.circonscription_fonciere?.replace(/[^a-zA-Z0-9-_]/g, '_') || '';
    const cadastre = job.cadastre?.replace(/[^a-zA-Z0-9-_]/g, '_') || '';
    const timestamp = Date.now();

    let bucketName: string;
    let fileName: string;

    switch (job.document_source) {
      case 'acte':
        bucketName = 'actes';
        fileName = `${docNumber}-${circonscription}-${timestamp}.pdf`;
        break;
      case 'plan_cadastraux':
        bucketName = 'plans-cadastraux';
        fileName = `${docNumber}-${circonscription}-${cadastre}-${timestamp}.pdf`;
        break;
      case 'index':
      default:
        bucketName = 'index';
        fileName = `${docNumber}-${circonscription}-${cadastre}-${timestamp}.pdf`;
        break;
    }

    return { bucketName, fileName };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Shutting down unified worker');
    this.shouldStop = true;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    await this.closeExtractor();

    await supabase
      .from('worker_status')
      .update({ status: 'stopped' })
      .eq('worker_id', this.workerId);
  }
}

// Main entry point
if (require.main === module) {
  const worker = new UnifiedWorker();

  process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  worker.initialize().catch((error) => {
    logger.error({ error }, 'Failed to start unified worker');
    process.exit(1);
  });
}


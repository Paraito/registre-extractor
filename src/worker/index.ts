import { AIRegistreExtractor as RegistreExtractor } from './extractor-ai';
import { supabase, supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ExtractionQueueJob, WorkerAccount, WorkerStatus, EXTRACTION_STATUS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { convertToExtractionConfig } from '../queue/manager';

// Extend ExtractionQueueJob to track which environment it came from
interface ExtractionQueueJobWithEnv extends ExtractionQueueJob {
  _environment: EnvironmentName;
}

export class ExtractionWorker {
  private workerId: string;
  private extractor: RegistreExtractor | null = null;
  private workerStatus: WorkerStatus;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentAccount: WorkerAccount | null = null;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  private lastJobTime: number = Date.now();
  private idleTimeoutMs: number = 2 * 60 * 1000; // 2 minutes of idle time before closing browser
  private currentJobEnvironment: EnvironmentName | null = null; // Track which environment current job is from

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${uuidv4()}`;
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
      // Log available environments
      const environments = supabaseManager.getAvailableEnvironments();
      logger.info({
        workerId: this.workerId,
        environments: environments.join(', ') || 'none'
      }, 'Worker starting with environments');

      if (environments.length === 0) {
        throw new Error('No Supabase environments configured. Please set up environment credentials in .env');
      }

      // Register worker in database
      await this.registerWorker();

      // Start heartbeat
      this.startHeartbeat();

      // Get an account
      this.currentAccount = await this.getAvailableAccount();
      this.workerStatus.account_id = this.currentAccount.id;

      // Don't initialize extractor here - do it on demand
      logger.info({
        workerId: this.workerId,
        account: this.currentAccount.username,
        environments: environments.join(', ')
      }, 'Worker registered and ready');

      // Start continuous job processing
      this.processContinuously();

    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to initialize worker');
      throw error;
    }
  }
  
  private async initializeExtractor(): Promise<void> {
    if (!this.currentAccount) {
      throw new Error('No account available');
    }
    
    logger.info({ workerId: this.workerId }, 'Initializing extractor and browser');
    
    // Initialize extractor with account
    this.extractor = new RegistreExtractor(
      this.currentAccount,
      this.workerId,
      config.isProduction
    );
    
    await this.extractor.initialize();
    await this.extractor.login();
    
    logger.info({ workerId: this.workerId, account: this.currentAccount.username }, 
      'Extractor initialized and logged in');
  }
  
  private async closeExtractor(): Promise<void> {
    if (this.extractor) {
      logger.info({ workerId: this.workerId }, 'Closing extractor and browser');
      try {
        await this.extractor.close();
      } catch (error) {
        logger.error({ error, workerId: this.workerId }, 'Error closing extractor');
      }
      this.extractor = null;
    }
  }

  private async registerWorker(): Promise<void> {
    const { error } = await supabase
      .from('worker_status')
      .upsert({
        worker_id: this.workerId,
        status: 'idle',
        last_heartbeat: new Date().toISOString(),
        started_at: new Date().toISOString(),
      }, {
        onConflict: 'worker_id',
      });

    if (error) {
      throw new Error(`Failed to register worker: ${error.message}`);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await supabase
          .from('worker_status')
          .update({
            last_heartbeat: new Date().toISOString(),
            status: this.workerStatus.status,
            jobs_completed: this.workerStatus.jobs_completed,
            jobs_failed: this.workerStatus.jobs_failed,
          })
          .eq('worker_id', this.workerId);
      } catch (error) {
        logger.error({ error, workerId: this.workerId }, 'Heartbeat failed');
      }
    }, 10000); // Every 10 seconds
  }

  private async getAvailableAccount(): Promise<WorkerAccount> {
    const { data: accounts, error } = await supabase
      .from('worker_accounts')
      .select('*')
      .eq('is_active', true)
      .lt('failure_count', 3)
      .order('last_used', { ascending: true, nullsFirst: true })
      .limit(1);

    if (error || !accounts || accounts.length === 0) {
      throw new Error('No available accounts');
    }

    const account = accounts[0];
    
    // Mark account as in use
    await supabase
      .from('worker_accounts')
      .update({ last_used: new Date().toISOString() })
      .eq('id', account.id);

    return account;
  }

  private async processContinuously(): Promise<void> {
    while (!this.shouldStop) {
      let currentJob: ExtractionQueueJobWithEnv | null = null;

      try {
        // Get next job with status "En attente"
        const job = await this.getNextJob();
        currentJob = job; // Track current job for error handling

        if (!job) {
          // Check if we've been idle too long
          const idleTime = Date.now() - this.lastJobTime;

          if (idleTime > this.idleTimeoutMs && this.extractor) {
            logger.info({
              workerId: this.workerId,
              idleMinutes: Math.round(idleTime / 60000)
            }, 'Worker idle timeout - closing browser to prevent session timeout');

            // Close the browser and clean up
            await this.closeExtractor();
          }

          // No jobs available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Ensure extractor is initialized before processing
        if (!this.extractor) {
          await this.initializeExtractor();
        }

        // Update last job time
        this.lastJobTime = Date.now();

        // Process the job
        await this.processJob(job);

      } catch (error) {
        logger.error({
          error,
          workerId: this.workerId,
          jobId: currentJob?.id,
          environment: currentJob?._environment
        }, 'Error in continuous processing');

        // CRITICAL: If we have a current job that might be stuck, reset it
        if (currentJob) {
          try {
            const client = supabaseManager.getServiceClient(currentJob._environment);
            if (client) {
              logger.warn({
                jobId: currentJob.id,
                workerId: this.workerId
              }, 'Resetting job due to unhandled error in processing loop');

              await client
                .from('extraction_queue')
                .update({
                  status_id: EXTRACTION_STATUS.EN_ATTENTE,
                  worker_id: null,
                  processing_started_at: null,
                  error_message: `Worker error in processing loop: ${error instanceof Error ? error.message : 'Unknown error'}`
                })
                .eq('id', currentJob.id)
                .eq('worker_id', this.workerId); // Only reset if we still own it
            }
          } catch (resetError) {
            logger.error({
              resetError,
              jobId: currentJob.id
            }, 'Failed to reset job after processing error');
          }
        }

        // If it's a browser/connection error, close and reinitialize
        if (error instanceof Error &&
            (error.message.includes('browser') ||
             error.message.includes('closed') ||
             error.message.includes('Target closed'))) {
          await this.closeExtractor();
        }

        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private async getNextJob(): Promise<ExtractionQueueJobWithEnv | null> {
    // Set worker to idle while looking for jobs
    this.workerStatus.status = 'idle';

    // Get all available environments
    const environments = supabaseManager.getAvailableEnvironments();

    if (environments.length === 0) {
      logger.error('No Supabase environments configured');
      return null;
    }

    // Check for stale jobs and reset them in all environments
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      const { data: staleJobs } = await client
        .from('extraction_queue')
        .select('*')
        .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
        .lt('processing_started_at', fiveMinutesAgo)
        .limit(1);

      if (staleJobs && staleJobs.length > 0) {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
          })
          .eq('id', staleJobs[0].id);

        logger.warn({ jobId: staleJobs[0].id, environment: env }, 'Reset stale job');
      }
    }

    // Poll all environments for pending jobs
    for (const env of environments) {
      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      const { data, error } = await client
        .from('extraction_queue')
        .select('*')
        .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)
        .order('created_at', { ascending: true })
        .limit(1);

      if (error || !data || data.length === 0) {
        continue; // Try next environment
      }

      const job = data[0];

      // Try to claim the job by updating it to "En traitement"
      const { data: claimedJob, error: claimError } = await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EN_TRAITEMENT,
          worker_id: this.workerId,
          processing_started_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE) // Ensure it's still available
        .select()
        .single();

      if (claimError || !claimedJob) {
        // Another worker probably claimed it, try next environment
        continue;
      }

      // Successfully claimed a job - add environment metadata
      logger.info({ jobId: claimedJob.id, environment: env }, 'Claimed job from environment');

      return {
        ...claimedJob,
        _environment: env,
      };
    }

    // No jobs available in any environment
    return null;
  }

  private async processJob(job: ExtractionQueueJobWithEnv): Promise<void> {
    const environment = job._environment;
    const client = supabaseManager.getServiceClient(environment);

    if (!client) {
      logger.error({ jobId: job.id, environment }, 'No Supabase client for environment');
      return;
    }

    logger.info({
      jobId: job.id,
      workerId: this.workerId,
      environment,
      documentSource: job.document_source,
      documentNumber: job.document_number
    }, 'Processing job');

    this.isProcessing = true;
    this.workerStatus.status = 'busy';
    this.workerStatus.current_job_id = job.id;
    this.currentJobEnvironment = environment;

    // Set a timeout for the entire job processing (5 minutes)
    const jobTimeout = 5 * 60 * 1000; // 5 minutes
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Job processing timeout after ${jobTimeout / 1000} seconds`));
      }, jobTimeout);
    });

    try {
      if (!this.extractor) {
        throw new Error('Extractor not initialized');
      }

      // Convert job to extraction config format
      const extractionConfig = convertToExtractionConfig(job);

      // Race between actual processing and timeout
      const localFilePath = await Promise.race([
        (async () => {
          // Navigate to the correct search page
          await this.extractor!.navigateToSearch(extractionConfig.document_type);

          // Extract document
          return await this.extractor!.extractDocument(extractionConfig);
        })(),
        timeoutPromise
      ]);

      // Upload to Supabase Storage with correct bucket and naming
      const { bucketName, fileName } = this.getStorageInfo(job);
      const fileContent = await fs.readFile(localFilePath);

      const storagePath = `${fileName}`;

      const { error: uploadError } = await client.storage
        .from(bucketName)
        .upload(storagePath, fileContent, {
          contentType: 'application/pdf',
          upsert: true, // Allow overwriting if file exists
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = client.storage
        .from(bucketName)
        .getPublicUrl(storagePath);

      // Update job as completed
      await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.COMPLETE,
          supabase_path: publicUrl,
          attemtps: (job.attemtps || 0) + 1,
        })
        .eq('id', job.id);

      // Clean up local file
      await fs.unlink(localFilePath);

      // Update worker stats
      this.workerStatus.jobs_completed++;

      logger.info({
        jobId: job.id,
        workerId: this.workerId,
        environment,
        documentUrl: publicUrl,
        bucketName,
        fileName
      }, 'Job completed successfully');
      
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error, 
        jobId: job.id, 
        workerId: this.workerId 
      }, 'Job processing failed');
      
      // Check if this is a worker/browser availability issue
      const isWorkerUnavailable = error instanceof Error && (
        error.message.includes('not initialized') ||
        error.message.includes('browser') ||
        error.message.includes('closed') ||
        error.message.includes('Target closed') ||
        error.message.includes('Connection closed') ||
        error.message.includes('Protocol error')
      );
      
      if (isWorkerUnavailable) {
        // Worker/browser issue - release the job back to queue without marking as error
        logger.warn({
          jobId: job.id,
          workerId: this.workerId,
          environment
        }, 'Worker unavailable, releasing job back to queue');

        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
            // Keep the error message for debugging but don't increment attempts
            error_message: `Worker unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`
          })
          .eq('id', job.id);

        // Don't count this as a failed job
        return;
      }

      // For actual extraction errors, use the retry logic
      const attempts = (job.attemtps || 0) + 1;
      const maxAttempts = job.max_attempts || 3;

      await client
        .from('extraction_queue')
        .update({
          status_id: attempts >= maxAttempts ? EXTRACTION_STATUS.ERREUR : EXTRACTION_STATUS.EN_ATTENTE,
          error_message: error instanceof Error ? error.message : 'Unknown error',
          attemtps: attempts,
          worker_id: attempts >= maxAttempts ? this.workerId : null,
          processing_started_at: attempts >= maxAttempts ? job.processing_started_at : null,
        })
        .eq('id', job.id);

      // Update worker stats
      this.workerStatus.jobs_failed++;
      
      // If login error, might need to get a new account
      if (error instanceof Error && error.message.includes('Login')) {
        logger.error('Login error detected, may need new account');
        // In a real implementation, you might want to mark the account as failed
        // and restart the worker with a new account
      }
    } finally {
      this.isProcessing = false;
      this.workerStatus.status = 'idle';
      this.workerStatus.current_job_id = undefined;
      this.currentJobEnvironment = null;
    }
  }

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

  async shutdown(): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Shutting down worker');

    this.shouldStop = true;

    // If currently processing a job, release it back to queue
    if (this.isProcessing && this.workerStatus.current_job_id && this.currentJobEnvironment) {
      const client = supabaseManager.getServiceClient(this.currentJobEnvironment);

      if (client) {
        logger.info({
          jobId: this.workerStatus.current_job_id,
          workerId: this.workerId,
          environment: this.currentJobEnvironment
        }, 'Releasing current job back to queue due to shutdown');

        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.EN_ATTENTE,
            worker_id: null,
            processing_started_at: null,
            error_message: 'Worker shutdown - job released'
          })
          .eq('id', this.workerStatus.current_job_id)
          .eq('worker_id', this.workerId); // Only update if we still own it
      }
    }
    
    // Wait a moment for the update to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close extractor using our helper method
    await this.closeExtractor();

    // Update worker status
    await supabase
      .from('worker_status')
      .update({ status: 'offline' })
      .eq('worker_id', this.workerId);
  }
}

// Main entry point
if (require.main === module) {
  const worker = new ExtractionWorker(process.env.WORKER_ID);
  
  process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
  });
  
  worker.initialize().catch((error) => {
    logger.error({ error }, 'Worker failed to initialize');
    process.exit(1);
  });
}
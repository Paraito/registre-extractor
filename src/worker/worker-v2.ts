import { AIRegistreExtractor as RegistreExtractor } from './extractor-ai';
import { supabase, supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { ExtractionQueueJob, WorkerAccount, WorkerStatus, DataValidationError, EXTRACTION_STATUS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

interface ExtractionQueueJobWithEnv extends ExtractionQueueJob {
  _environment: EnvironmentName;
}

export class ExtractionWorkerV2 {
  private workerId: string;
  private extractor: RegistreExtractor | null = null;
  private workerStatus: WorkerStatus;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentAccount: WorkerAccount | null = null;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;

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
      // Register worker in database
      await this.registerWorker();
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Get an account and initialize extractor
      this.currentAccount = await this.getAvailableAccount();
      this.workerStatus.account_id = this.currentAccount.id;
      
      // Initialize extractor with account (visible browser in development)
      this.extractor = new RegistreExtractor(
        this.currentAccount,
        this.workerId,
        false  // headless = false for debugging (visible browser)
      );
      
      await this.extractor.initialize();
      await this.extractor.login();
      
      logger.info({ workerId: this.workerId }, 'Worker initialized and logged in');
      
      // Start continuous job processing
      this.processContinuously();
      
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to initialize worker');
      throw error;
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
      try {
        // Get next job with status "En attente"
        const job = await this.getNextJob();
        
        if (!job) {
          // No jobs available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        // Process the job
        await this.processJob(job);
        
      } catch (error) {
        logger.error({ error, workerId: this.workerId }, 'Error in continuous processing');
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
    
    try {
      if (!this.extractor) {
        throw new Error('Extractor not initialized');
      }

      // Navigate to the correct search page based on document source
      const documentType = this.mapDocumentSourceToType(job.document_source);
      await this.extractor.navigateToSearch(documentType);
      
      // Convert job to extraction config
      const extractionConfig = this.convertToExtractionConfig(job);
      
      // Extract document
      const localFilePath = await this.extractor.extractDocument(extractionConfig);

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
      
      // Check if this is a data validation error (contValErr)
      if (error instanceof DataValidationError) {
        logger.error({ 
          jobId: job.id,
          workerId: this.workerId,
          errorMessage: error.message,
          originalMessage: error.originalMessage
        }, 'Data validation error - invalid data from Supabase');
        
        // For data validation errors, immediately set status to 'Erreur' without retrying
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.ERREUR,
            error_message: error.message,
            attemtps: (job.attemtps || 0) + 1,
            worker_id: this.workerId,
            processing_started_at: job.processing_started_at,
          })
          .eq('id', job.id);
      } else {
        // Regular error handling with retry logic
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
      }

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
    }
  }

  private mapDocumentSourceToType(source: 'acte' | 'index' | 'plan_cadastraux'): 'index' | 'actes' | 'plans_cadastraux' {
    switch (source) {
      case 'acte':
        return 'actes';
      case 'plan_cadastraux':
        return 'plans_cadastraux';
      default:
        return 'index';
    }
  }

  private convertToExtractionConfig(job: ExtractionQueueJob): any {
    const config: any = {
      document_type: this.mapDocumentSourceToType(job.document_source),
      circumscription: job.circonscription_fonciere || 'Montréal',
      cadastre: job.cadastre,
      designation_secondaire: job.designation_secondaire,
    };

    if (job.document_source === 'acte') {
      config.type_document = job.acte_type;
      config.numero_inscription = job.document_number;
    } else {
      config.lot_number = job.document_number;
    }

    return config;
  }

  private getStorageInfo(job: ExtractionQueueJob): { bucketName: string; fileName: string } {
    const docNumber = (job.document_number_normalized || job.document_number).replace(/\s+/g, '');
    const circonscription = job.circonscription_fonciere?.replace(/\s+/g, '_') || '';
    const cadastre = job.cadastre?.replace(/\s+/g, '_') || '';
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
    
    // Wait for current job to finish
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close extractor
    if (this.extractor) {
      await this.extractor.close();
    }

    // Update worker status
    await supabase
      .from('worker_status')
      .update({ status: 'offline' })
      .eq('worker_id', this.workerId);
  }
}

// Main entry point
if (require.main === module) {
  const worker = new ExtractionWorkerV2(process.env.WORKER_ID);
  
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
import { AIRegistreExtractor as RegistreExtractor } from './extractor-ai';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ExtractionQueueJob, WorkerAccount, WorkerStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { convertToExtractionConfig } from '../queue/manager';

export class ExtractionWorker {
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
      
      // Initialize extractor with account
      this.extractor = new RegistreExtractor(
        this.currentAccount,
        this.workerId,
        config.isProduction
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

  private async getNextJob(): Promise<ExtractionQueueJob | null> {
    // Set worker to idle while looking for jobs
    this.workerStatus.status = 'idle';
    
    // First, check for stale jobs (stuck in processing for more than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleJobs } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('status', 'En traitement')
      .lt('processing_started_at', fiveMinutesAgo)
      .limit(1);
    
    if (staleJobs && staleJobs.length > 0) {
      // Reset stale job
      await supabase
        .from('extraction_queue')
        .update({
          status: 'En attente',
          worker_id: null,
          processing_started_at: null,
        })
        .eq('id', staleJobs[0].id);
      
      logger.warn({ jobId: staleJobs[0].id }, 'Reset stale job');
    }
    
    const { data, error } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('status', 'En attente')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const job = data[0];
    
    // Try to claim the job by updating it to "En traitement"
    const { data: claimedJob, error: claimError } = await supabase
      .from('extraction_queue')
      .update({
        status: 'En traitement',
        worker_id: this.workerId,
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'En attente') // Ensure it's still available
      .select()
      .single();

    if (claimError || !claimedJob) {
      // Another worker probably claimed it
      return null;
    }

    return claimedJob;
  }

  private async processJob(job: ExtractionQueueJob): Promise<void> {
    logger.info({ 
      jobId: job.id, 
      workerId: this.workerId,
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

      // Convert job to extraction config format
      const extractionConfig = convertToExtractionConfig(job);
      
      // Navigate to the correct search page
      await this.extractor.navigateToSearch(extractionConfig.document_type);
      
      // Extract document
      const localFilePath = await this.extractor.extractDocument(extractionConfig);

      // Upload to Supabase Storage with correct bucket and naming
      const { bucketName, fileName } = this.getStorageInfo(job);
      const fileContent = await fs.readFile(localFilePath);
      
      const storagePath = `${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, fileContent, {
          contentType: 'application/pdf',
          upsert: true, // Allow overwriting if file exists
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(storagePath);

      // Update job as completed
      await supabase
        .from('extraction_queue')
        .update({
          status: 'Complété',
          supabase_path: `${bucketName}/${storagePath}`,
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
      
      // Update job as failed
      const attempts = (job.attemtps || 0) + 1;
      const maxAttempts = job.max_attempts || 3;
      
      await supabase
        .from('extraction_queue')
        .update({
          status: attempts >= maxAttempts ? 'Erreur' : 'En attente',
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
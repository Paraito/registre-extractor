/**
 * Index OCR Worker
 * 
 * Continuously polls extraction_queue for documents ready for OCR processing.
 * Supports multi-environment (dev, staging, prod) and distributed workers.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger, Logger } from '../util/log.js';
import { runE2EPipeline } from '../server/pipeline.js';
import { SharedRateLimiter, WorkerInfo } from './rate-limiter.js';
import { CONFIG } from '../../config/runtime.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Status IDs
const EXTRACTION_STATUS = {
  EN_ATTENTE: 1,        // Waiting (not used for index OCR)
  EN_TRAITEMENT: 2,     // Processing
  COMPLETE: 3,          // Complete (ready for OCR)
  OCR_COMPLETE: 4,      // OCR Complete
  ERREUR: 5             // Error
};

interface ExtractionQueueDocument {
  id: number;
  document_number: string;
  document_source: 'index' | 'acte' | 'plan_cadastraux';
  supabase_path: string;
  status_id: number;
  worker_id: string | null;
  file_content: any;
  boosted_file_content: any;
  created_at: string;
  _environment?: string;
}

interface EnvironmentConfig {
  url: string;
  key: string;
  client?: SupabaseClient;
}

export class IndexOCRWorker {
  private workerId: string;
  private logger: Logger;
  private rateLimiter: SharedRateLimiter;
  private environments: Map<string, EnvironmentConfig>;
  private shouldStop: boolean = false;
  private isProcessing: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;
  private resetInterval?: NodeJS.Timeout;
  private pollInterval: number = 5000; // 5 seconds
  private heartbeatFrequency: number = 10000; // 10 seconds
  
  constructor(workerId?: string, redisUrl?: string) {
    this.workerId = workerId || `index-ocr-${os.hostname()}-${process.pid}`;
    this.logger = createLogger(this.workerId);
    this.rateLimiter = new SharedRateLimiter(this.logger, redisUrl);
    this.environments = new Map();
  }
  
  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    await this.logger.init();
    await this.logger.info('worker', 'Initializing Index OCR Worker', {
      workerId: this.workerId,
      pollInterval: this.pollInterval
    });
    
    // Connect to Redis
    await this.rateLimiter.connect();
    
    // Initialize Supabase clients for each environment
    this.initializeEnvironments();
    
    // Register worker
    const workerInfo: WorkerInfo = {
      workerId: this.workerId,
      type: 'index',
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      environment: 'multi' // Polls all environments
    };
    
    await this.rateLimiter.registerWorker(workerInfo);
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start rate limit auto-reset
    this.resetInterval = this.rateLimiter.startAutoReset();
    
    await this.logger.success('worker', 'Worker initialized successfully', {
      workerId: this.workerId,
      environments: Array.from(this.environments.keys())
    });
  }
  
  /**
   * Initialize Supabase clients for all environments
   */
  private initializeEnvironments(): void {
    const envConfigs = {
      dev: {
        url: process.env.DEV_SUPABASE_URL,
        key: process.env.DEV_SUPABASE_SERVICE_KEY
      },
      staging: {
        url: process.env.STAGING_SUPABASE_URL,
        key: process.env.STAGING_SUPABASE_SERVICE_KEY
      },
      prod: {
        url: process.env.PROD_SUPABASE_URL,
        key: process.env.PROD_SUPABASE_SERVICE_KEY
      }
    };
    
    for (const [envName, config] of Object.entries(envConfigs)) {
      if (config.url && config.key) {
        const client = createClient(config.url, config.key, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });
        
        this.environments.set(envName, {
          url: config.url,
          key: config.key,
          client
        });
        
        this.logger.info('worker', `Initialized ${envName} environment`, {
          url: config.url
        });
      }
    }
    
    if (this.environments.size === 0) {
      throw new Error('No environments configured. Please set environment variables.');
    }
  }
  
  /**
   * Start heartbeat to keep worker alive in Redis
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.rateLimiter.updateWorkerHeartbeat(this.workerId);
    }, this.heartbeatFrequency);
  }
  
  /**
   * Start continuous processing
   */
  async start(): Promise<void> {
    await this.logger.info('worker', 'Starting continuous processing', {
      workerId: this.workerId
    });
    
    while (!this.shouldStop) {
      try {
        // Get next job from any environment
        const job = await this.getNextJob();
        
        if (!job) {
          // No jobs available, wait before polling again
          await new Promise(resolve => setTimeout(resolve, this.pollInterval));
          continue;
        }
        
        // Process the job
        this.isProcessing = true;
        await this.processJob(job);
        this.isProcessing = false;
        
      } catch (error) {
        await this.logger.error('worker', 'Error in processing loop', error);
        this.isProcessing = false;
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    await this.logger.info('worker', 'Worker stopped');
  }
  
  /**
   * Get next job from any environment
   */
  private async getNextJob(): Promise<ExtractionQueueDocument | null> {
    // Poll all environments in priority order (prod, staging, dev)
    const envOrder = ['prod', 'staging', 'dev'];
    
    for (const envName of envOrder) {
      const env = this.environments.get(envName);
      if (!env || !env.client) continue;
      
      const { data, error } = await env.client
        .from('extraction_queue')
        .select('*')
        .eq('status_id', EXTRACTION_STATUS.COMPLETE) // Ready for OCR
        .is('worker_id', null) // Not claimed by another worker
        .order('created_at', { ascending: true })
        .limit(1);
      
      if (error || !data || data.length === 0) {
        continue; // Try next environment
      }
      
      const job = data[0];
      
      // Try to claim the job atomically
      const { data: claimedJob, error: claimError } = await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EN_TRAITEMENT,
          worker_id: this.workerId
        })
        .eq('id', job.id)
        .eq('status_id', EXTRACTION_STATUS.COMPLETE) // Ensure still available
        .is('worker_id', null) // Ensure not claimed
        .select()
        .single();
      
      if (claimError || !claimedJob) {
        // Another worker claimed it, try next
        continue;
      }
      
      // Successfully claimed!
      await this.logger.info('worker', 'Claimed job', {
        jobId: claimedJob.id,
        environment: envName,
        documentNumber: claimedJob.document_number
      });
      
      return {
        ...claimedJob,
        _environment: envName
      };
    }
    
    return null; // No jobs available in any environment
  }
  
  /**
   * Process a job
   */
  private async processJob(job: ExtractionQueueDocument): Promise<void> {
    const env = this.environments.get(job._environment!);
    if (!env || !env.client) {
      throw new Error(`Environment ${job._environment} not found`);
    }
    
    await this.logger.info('worker', 'Processing job', {
      jobId: job.id,
      documentNumber: job.document_number,
      environment: job._environment
    });
    
    let tempPdfPath: string | null = null;
    
    try {
      // Download PDF from Supabase Storage
      const bucketName = job.document_source === 'acte' ? 'actes'
                       : job.document_source === 'plan_cadastraux' ? 'plans-cadastraux'
                       : 'index';
      
      let storagePath = job.supabase_path;
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:(?:public|sign)\/)?(.+)$/);
        if (urlMatch) {
          const fullPath = urlMatch[1];
          storagePath = fullPath.startsWith(`${bucketName}/`) 
            ? fullPath.substring(bucketName.length + 1) 
            : fullPath;
        }
      } else if (storagePath.startsWith(`${bucketName}/`)) {
        storagePath = storagePath.substring(bucketName.length + 1);
      }
      
      const { data: pdfData, error: downloadError } = await env.client.storage
        .from(bucketName)
        .download(storagePath);
      
      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF: ${downloadError?.message || 'No data'}`);
      }
      
      // Save to temp file
      const tempDir = os.tmpdir();
      tempPdfPath = path.join(tempDir, `ocr-${job.id}-${Date.now()}.pdf`);
      const arrayBuffer = await pdfData.arrayBuffer();
      fs.writeFileSync(tempPdfPath, Buffer.from(arrayBuffer));
      
      // Run OCR pipeline
      const runId = `job-${job.id}-${Date.now()}`;
      const result = await runE2EPipeline({
        url: `file://${tempPdfPath}`,
        extractionModel: 'gemini',
        runId,
        tolerancePercent: 5.0,
        skipBoost: true,
        skipCoherence: true,
        logger: this.logger
      });
      
      // Update database with results
      const { error: updateError } = await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_COMPLETE,
          worker_id: null,
          file_content: result.document,
          boosted_file_content: result.document
        })
        .eq('id', job.id);
      
      if (updateError) {
        throw new Error(`Failed to update results: ${updateError.message}`);
      }
      
      await this.logger.success('worker', 'Job completed successfully', {
        jobId: job.id,
        totalPages: result.document.totalPages,
        totalLines: result.document.totalLines
      });
      
    } catch (error) {
      await this.logger.error('worker', 'Job processing failed', error, {
        jobId: job.id
      });
      
      // Reset status to COMPLETE so it can be retried
      await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.COMPLETE,
          worker_id: null
        })
        .eq('id', job.id);
      
      throw error;
      
    } finally {
      // Clean up temp file
      if (tempPdfPath && fs.existsSync(tempPdfPath)) {
        fs.unlinkSync(tempPdfPath);
      }
    }
  }
  
  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    await this.logger.info('worker', 'Stopping worker', {
      workerId: this.workerId
    });
    
    this.shouldStop = true;
    
    // Wait for current job to finish
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Stop rate limit reset
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
    }
    
    // Unregister worker
    await this.rateLimiter.unregisterWorker(this.workerId);
    
    // Disconnect from Redis
    await this.rateLimiter.disconnect();
    
    await this.logger.success('worker', 'Worker stopped successfully');
  }
}


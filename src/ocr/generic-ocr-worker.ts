/**
 * Generic OCR Worker
 * 
 * Can process BOTH index and acte documents.
 * Dynamically switches between modes based on pool manager allocation.
 */

import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { SharedRateLimiter } from '../shared/rate-limiter';
import { ServerCapacityManager, WorkerType } from '../shared/capacity-manager';
import { WorkerPoolManager } from '../shared/worker-pool-manager';
import { ActeOCRProcessor } from './acte-processor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Status IDs
const EXTRACTION_STATUS = {
  EN_ATTENTE: 1,        // Waiting
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

export class GenericOCRWorker {
  private workerId: string;
  private currentMode: 'index' | 'acte' | 'idle';
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  
  // Managers
  private rateLimiter: SharedRateLimiter;
  private capacityManager: ServerCapacityManager;
  private poolManager: WorkerPoolManager;
  
  // Processors
  private acteProcessor?: ActeOCRProcessor;
  
  // Supabase clients
  private environments: Map<string, EnvironmentConfig>;
  
  // Intervals
  private heartbeatInterval?: NodeJS.Timeout;
  private modeCheckInterval?: NodeJS.Timeout;
  
  private pollInterval: number = 5000; // 5 seconds
  private heartbeatFrequency: number = 10000; // 10 seconds
  private modeCheckFrequency: number = 5000; // 5 seconds
  
  constructor(
    workerId: string,
    rateLimiter: SharedRateLimiter,
    capacityManager: ServerCapacityManager,
    poolManager: WorkerPoolManager
  ) {
    this.workerId = workerId;
    this.currentMode = 'idle';
    this.rateLimiter = rateLimiter;
    this.capacityManager = capacityManager;
    this.poolManager = poolManager;
    this.environments = new Map();
  }
  
  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Initializing Generic OCR Worker');
    
    // Initialize Supabase clients for each environment
    this.initializeEnvironments();
    
    // Initialize acte processor
    if (process.env.GEMINI_API_KEY) {
      this.acteProcessor = new ActeOCRProcessor({
        geminiApiKey: process.env.GEMINI_API_KEY,
        tempDir: path.join(os.tmpdir(), 'ocr-acte-processing')
      });
      
      await this.acteProcessor.ensureTempDir();
    }
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start mode checking
    this.startModeChecking();
    
    logger.info({ workerId: this.workerId }, 'Generic OCR Worker initialized');
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
        const client = createSupabaseClient(config.url, config.key, {
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
        
        logger.info({ workerId: this.workerId, environment: envName }, 'Initialized environment');
      }
    }
  }
  
  /**
   * Start heartbeat to update rate limiter
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.rateLimiter.updateWorkerHeartbeat(this.workerId);
    }, this.heartbeatFrequency);
  }
  
  /**
   * Start checking for mode changes
   */
  private startModeChecking(): void {
    this.modeCheckInterval = setInterval(async () => {
      await this.checkAndSwitchMode();
    }, this.modeCheckFrequency);
  }
  
  /**
   * Check if mode should change and switch if needed
   */
  private async checkAndSwitchMode(): Promise<void> {
    // Don't switch while processing
    if (this.isProcessing) {
      return;
    }
    
    // Get assigned mode from pool manager
    const assignedMode = await this.poolManager.getWorkerMode(this.workerId);
    
    if (!assignedMode) {
      // Not assigned yet, stay idle
      return;
    }
    
    if (assignedMode !== this.currentMode) {
      await this.switchMode(assignedMode);
    }
  }
  
  /**
   * Switch worker mode
   */
  private async switchMode(newMode: 'index' | 'acte'): Promise<void> {
    logger.info({
      workerId: this.workerId,
      oldMode: this.currentMode,
      newMode
    }, 'Switching worker mode');
    
    // Release old resources if allocated
    if (this.currentMode !== 'idle') {
      await this.capacityManager.releaseResources(this.workerId);
      await this.rateLimiter.unregisterWorker(this.workerId);
    }
    
    // Allocate new resources
    const workerType: WorkerType = newMode === 'index' ? 'index-ocr' : 'acte-ocr';
    
    // Check capacity
    const capacityCheck = await this.capacityManager.checkCapacity(workerType);
    if (!capacityCheck.allowed) {
      logger.warn({
        workerId: this.workerId,
        reason: capacityCheck.reason
      }, 'Cannot switch mode - insufficient capacity');
      return;
    }
    
    // Allocate resources
    await this.capacityManager.allocateResources(this.workerId, workerType);
    
    // Register with rate limiter
    await this.rateLimiter.registerWorker({
      workerId: this.workerId,
      type: newMode,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      environment: 'multi'
    });
    
    this.currentMode = newMode;
    
    logger.info({
      workerId: this.workerId,
      mode: newMode
    }, 'Worker mode switched successfully');
  }
  
  /**
   * Start continuous processing
   */
  async start(): Promise<void> {
    logger.info({ workerId: this.workerId }, 'Starting continuous processing');
    
    while (!this.shouldStop) {
      try {
        // Wait for mode assignment
        if (this.currentMode === 'idle') {
          await new Promise(resolve => setTimeout(resolve, this.pollInterval));
          continue;
        }
        
        // Get next job for current mode
        const job = await this.getNextJob(this.currentMode);
        
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
        logger.error({ error, workerId: this.workerId }, 'Error in processing loop');
        this.isProcessing = false;
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    logger.info({ workerId: this.workerId }, 'Worker stopped');
  }
  
  /**
   * Get next job for current mode
   */
  private async getNextJob(mode: 'index' | 'acte'): Promise<ExtractionQueueDocument | null> {
    const documentSource = mode === 'index' ? 'index' : 'acte';
    
    // Poll all environments in priority order (prod, staging, dev)
    const envOrder = ['prod', 'staging', 'dev'];
    
    for (const envName of envOrder) {
      const env = this.environments.get(envName);
      if (!env || !env.client) continue;
      
      // Try to claim a job atomically
      const { data: claimedJob, error } = await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EN_TRAITEMENT,
          worker_id: this.workerId
        })
        .eq('status_id', EXTRACTION_STATUS.COMPLETE)
        .eq('document_source', documentSource)
        .is('worker_id', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .select()
        .single();
      
      if (error || !claimedJob) {
        continue; // Try next environment
      }
      
      // Successfully claimed!
      logger.info({
        workerId: this.workerId,
        jobId: claimedJob.id,
        environment: envName,
        documentNumber: claimedJob.document_number,
        mode
      }, 'Claimed job');
      
      return {
        ...claimedJob,
        _environment: envName
      };
    }
    
    return null; // No jobs available in any environment
  }
  
  /**
   * Process a job (delegates to appropriate processor)
   */
  private async processJob(job: ExtractionQueueDocument): Promise<void> {
    if (job.document_source === 'index') {
      await this.processIndexDocument(job);
    } else if (job.document_source === 'acte') {
      await this.processActeDocument(job);
    }
  }
  
  /**
   * Process index document (placeholder - will be implemented)
   */
  private async processIndexDocument(job: ExtractionQueueDocument): Promise<void> {
    logger.info({
      workerId: this.workerId,
      jobId: job.id,
      documentNumber: job.document_number
    }, 'Processing index document');
    
    // TODO: Implement index OCR processing
    // For now, just mark as complete
    const env = this.environments.get(job._environment!);
    if (env && env.client) {
      await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_COMPLETE,
          worker_id: null
        })
        .eq('id', job.id);
    }
  }
  
  /**
   * Process acte document
   */
  private async processActeDocument(job: ExtractionQueueDocument): Promise<void> {
    const env = this.environments.get(job._environment!);
    if (!env || !env.client) {
      throw new Error(`Environment ${job._environment} not found`);
    }

    logger.info({
      workerId: this.workerId,
      jobId: job.id,
      documentNumber: job.document_number,
      environment: job._environment
    }, 'Processing acte document');

    let tempPdfPath: string | null = null;

    try {
      // Download PDF from Supabase Storage
      const bucketName = 'actes';

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
      tempPdfPath = path.join(tempDir, `ocr-acte-${job.id}-${Date.now()}.pdf`);
      const arrayBuffer = await pdfData.arrayBuffer();
      fs.writeFileSync(tempPdfPath, Buffer.from(arrayBuffer));

      // Process with acte OCR processor
      if (!this.acteProcessor) {
        throw new Error('Acte processor not initialized');
      }

      const result = await this.acteProcessor.processActePDF(
        tempPdfPath,
        job.document_number
      );

      // Update database with results
      const { error: updateError } = await env.client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_COMPLETE,
          worker_id: null,
          file_content: result.rawText,
          boosted_file_content: result.boostedText
        })
        .eq('id', job.id);

      if (updateError) {
        throw new Error(`Failed to update results: ${updateError.message}`);
      }

      logger.info({
        workerId: this.workerId,
        jobId: job.id,
        rawTextLength: result.rawText.length,
        boostedTextLength: result.boostedText.length
      }, 'Acte document processed successfully');

    } catch (error) {
      logger.error({
        error,
        workerId: this.workerId,
        jobId: job.id
      }, 'Acte document processing failed');

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
    logger.info({ workerId: this.workerId }, 'Stopping worker');
    
    this.shouldStop = true;
    
    // Wait for current job to finish
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.modeCheckInterval) {
      clearInterval(this.modeCheckInterval);
    }
    
    // Release resources
    if (this.currentMode !== 'idle') {
      await this.capacityManager.releaseResources(this.workerId);
      await this.rateLimiter.unregisterWorker(this.workerId);
    }
    
    logger.info({ workerId: this.workerId }, 'Worker stopped successfully');
  }
}


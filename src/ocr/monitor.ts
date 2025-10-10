import { supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { EXTRACTION_STATUS, ExtractionQueueJob } from '../types';
import { OCRProcessor } from './processor';
import { ActeOCRProcessor } from './acte-processor';
import { OCRLogger } from './ocr-logger';
import { staleOCRMonitor } from './stale-ocr-monitor';
import { config } from '../config';
import fs from 'fs/promises';
import path from 'path';

export interface OCRMonitorConfig {
  geminiApiKey: string;
  pollIntervalMs?: number;
  tempDir?: string;
  concurrency?: number;
  acte?: {
    extractModel?: string;
    boostModel?: string;
    extractTemperature?: number;
    boostTemperature?: number;
  };
}

/**
 * OCR Monitor Service
 * Monitors extraction_queue for completed documents (index and acte) and triggers OCR processing
 */
export class OCRMonitor {
  private indexProcessor: OCRProcessor;
  private acteProcessor: ActeOCRProcessor;
  private pollIntervalMs: number;
  private isRunning: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(config: OCRMonitorConfig) {
    // Initialize index processor (uses Vision API with PDF to image conversion)
    this.indexProcessor = new OCRProcessor({
      geminiApiKey: config.geminiApiKey,
      tempDir: config.tempDir || '/tmp/ocr-processing'
    });

    // Initialize acte processor (uses File API for direct PDF processing)
    this.acteProcessor = new ActeOCRProcessor({
      geminiApiKey: config.geminiApiKey,
      tempDir: config.tempDir ? `${config.tempDir}-acte` : '/tmp/ocr-acte-processing',
      extractModel: config.acte?.extractModel,
      boostModel: config.acte?.boostModel,
      extractTemperature: config.acte?.extractTemperature,
      boostTemperature: config.acte?.boostTemperature,
    });

    this.pollIntervalMs = config.pollIntervalMs || 10000; // Default: 10 seconds

    logger.debug({
      pollIntervalMs: this.pollIntervalMs
    }, 'OCR Monitor initialized (index + acte support)');
  }

  async initialize(): Promise<void> {
    await this.indexProcessor.initialize();
    await this.acteProcessor.initialize();
    logger.debug('OCR Monitor ready (index + acte processors initialized)');
  }

  /**
   * Start monitoring for documents that need OCR processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('OCR Monitor is already running');
      return;
    }

    this.isRunning = true;

    // Log which environments have OCR enabled
    const enabledEnvs = Object.entries(config.ocr.enabledEnvironments)
      .filter(([_, enabled]) => enabled)
      .map(([env]) => env);

    OCRLogger.monitorStarted(enabledEnvs);

    // Start the stale OCR job monitor
    staleOCRMonitor.start();

    // Start the polling loop
    this.poll();
  }

  /**
   * Stop the monitor
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // Stop the stale OCR job monitor
    staleOCRMonitor.stop();

    await this.indexProcessor.cleanup();
    await this.acteProcessor.cleanup();
    logger.info('OCR Monitor stopped');
  }

  /**
   * Poll for documents that need OCR processing
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.processNextDocument();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error
      }, 'Error in OCR monitor poll');
    }

    // Schedule next poll
    this.pollTimeout = setTimeout(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Find and process the next document that needs OCR
   */
  private async processNextDocument(): Promise<void> {
    const environments = supabaseManager.getAvailableEnvironments();

    if (environments.length === 0) {
      logger.error('No Supabase environments configured');
      return;
    }

    // Check each environment for documents needing OCR
    for (const env of environments) {
      // Check if OCR is enabled for this environment
      const isOCREnabled = config.ocr.enabledEnvironments[env];
      if (!isOCREnabled) {
        logger.debug({ environment: env }, 'OCR disabled for environment, skipping');
        continue;
      }

      const client = supabaseManager.getServiceClient(env);
      if (!client) continue;

      try {
        // Find documents with status_id=3 (COMPLETE) and document_source='index' OR 'acte'
        // Status ID is the source of truth - if it's 3, it needs OCR processing
        // We'll filter by ocr_attempts in-memory since PostgREST doesn't support column-to-column comparison
        const { data: documents, error } = await client
          .from('extraction_queue')
          .select('*')
          .eq('status_id', EXTRACTION_STATUS.COMPLETE)
          .in('document_source', ['index', 'acte'])
          .order('created_at', { ascending: true })
          .limit(10); // Get a few candidates to filter in-memory

        if (error) {
          logger.error({ error, environment: env }, 'Error querying for documents needing OCR');
          continue;
        }

        if (!documents || documents.length === 0) {
          continue; // No documents to process in this environment
        }

        // Filter documents that haven't exceeded max OCR attempts
        const eligibleDocuments = documents.filter(doc => {
          const attempts = doc.ocr_attempts || 0;
          const maxAttempts = doc.ocr_max_attempts || 3;
          return attempts < maxAttempts;
        });

        // Log if documents were skipped due to max attempts
        const skippedCount = documents.length - eligibleDocuments.length;
        if (skippedCount > 0) {
          logger.debug({
            environment: env,
            totalFound: documents.length,
            skippedDueToMaxAttempts: skippedCount,
            eligible: eligibleDocuments.length
          }, 'Some documents skipped due to max OCR attempts reached');
        }

        if (eligibleDocuments.length === 0) {
          continue; // No eligible documents in this environment
        }

        const document = eligibleDocuments[0];

        // Process this document (routing to appropriate processor based on document_source)
        await this.processDocument(document, env);

        // Only process one document per poll cycle
        return;

      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : error,
          environment: env
        }, 'Error processing document in environment');
      }
    }
  }

  /**
   * Process a single document with OCR (routes to appropriate processor)
   */
  private async processDocument(
    document: ExtractionQueueJob,
    environment: EnvironmentName
  ): Promise<void> {
    // Route to appropriate processor based on document_source
    if (document.document_source === 'acte') {
      await this.processActeDocument(document, environment);
    } else if (document.document_source === 'index') {
      await this.processIndexDocument(document, environment);
    } else {
      logger.warn({
        documentId: document.id,
        documentSource: document.document_source
      }, 'Unknown document_source, skipping OCR processing');
    }
  }

  /**
   * Process an index document with OCR (using Vision API)
   */
  private async processIndexDocument(
    document: ExtractionQueueJob,
    environment: EnvironmentName
  ): Promise<void> {
    const startTime = Date.now();
    const client = supabaseManager.getServiceClient(environment);
    if (!client) {
      logger.error({ environment }, 'No Supabase client for environment');
      return;
    }

    OCRLogger.documentStart(document.document_number, environment, document.id);

    // Generate worker ID (could be made configurable)
    const workerIdValue = process.env.OCR_WORKER_ID || 'ocr-monitor-1';

    try {
      // Mark job as OCR in-progress before processing
      const { error: updateStartError } = await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_PROCESSING,
          ocr_worker_id: workerIdValue,
          ocr_started_at: new Date().toISOString(),
          ocr_attempts: (document.ocr_attempts || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      if (updateStartError) {
        logger.error({ error: updateStartError, documentId: document.id }, 'Failed to mark job as OCR in-progress');
        // Continue anyway - this is not critical
      }

      // Validate that we have a PDF path
      if (!document.supabase_path) {
        throw new Error('Document has no supabase_path');
      }

      // Determine bucket name
      const bucketName = document.document_source === 'acte' ? 'actes'
                       : document.document_source === 'plan_cadastraux' ? 'plans-cadastraux'
                       : 'index';

      // Remove bucket name prefix if it exists in the path
      let storagePath = document.supabase_path;
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        // Extract path from URL if it's a full URL
        const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
        if (urlMatch) {
          storagePath = urlMatch[1];
        }
      } else if (storagePath.startsWith(`${bucketName}/`)) {
        // Remove bucket prefix from path
        storagePath = storagePath.substring(bucketName.length + 1);
      }

      // Download the PDF from private bucket using authenticated client
      const { data: pdfData, error: downloadError } = await client.storage
        .from(bucketName)
        .download(storagePath);

      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF from bucket: ${downloadError?.message || 'No data'}`);
      }

      // Save to temporary file
      const tempPath = path.join(
        this.indexProcessor['pdfConverter']['tempDir'],
        `download-${Date.now()}.pdf`
      );

      const arrayBuffer = await pdfData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempPath, buffer);

      logger.debug({
        documentId: document.id,
        fileSize: buffer.length
      }, 'PDF downloaded');

      // Process the PDF using PARALLEL processing with CORRECT flow:
      // Step 1: Extract raw text from all pages (parallel)
      // Step 2: CONCATENATE all raw text
      // Step 3: Apply boost to FULL concatenated raw text
      const ocrResult = await this.indexProcessor.processPDFParallel(tempPath);

      // Clean up temp file
      await fs.unlink(tempPath).catch(err => {
        logger.debug({ error: err }, 'Failed to clean up temp PDF');
      });

      // Store both raw and boosted text
      // file_content: Raw OCR output from Gemini Vision AI (concatenated from all pages)
      // boosted_file_content: Enhanced text with 60+ correction rules applied (to full concatenated text)
      const rawText = ocrResult.combinedRawText;
      const boostedText = ocrResult.combinedBoostedText;

      // Try to update with both fields first
      let updateError = null;
      let updateData: any = {
        file_content: rawText,
        boosted_file_content: boostedText,
        status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
        ocr_completed_at: new Date().toISOString(),
        ocr_error: null, // Clear any previous OCR errors
        updated_at: new Date().toISOString()
      };

      const { error: firstError } = await client
        .from('extraction_queue')
        .update(updateData)
        .eq('id', document.id);

      // If boosted_file_content column doesn't exist, fall back to just file_content
      if (firstError && firstError.code === 'PGRST204' && firstError.message?.includes('boosted_file_content')) {
        OCRLogger.warning('boosted_file_content column not found', {
          'Migration': '004 not applied',
          'Action': 'Saving only file_content'
        });

        // Retry without boosted_file_content
        updateData = {
          file_content: rawText,
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
          ocr_completed_at: new Date().toISOString(),
          ocr_error: null, // Clear any previous OCR errors
          updated_at: new Date().toISOString()
        };

        const { error: secondError } = await client
          .from('extraction_queue')
          .update(updateData)
          .eq('id', document.id);

        updateError = secondError;
      } else {
        updateError = firstError;
      }

      if (updateError) {
        throw updateError;
      }

      const totalDuration = (Date.now() - startTime) / 1000;
      OCRLogger.documentComplete(
        document.document_number,
        environment,
        ocrResult.totalPages,
        rawText.length,
        boostedText.length,
        totalDuration
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      OCRLogger.documentError(document.document_number, environment, errorMsg, document.id);

      // Update document with error information
      // Revert status to COMPLETE so it can be retried (if under max attempts)
      try {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE, // Revert to ready for retry
            ocr_error: `OCR processing failed: ${errorMsg}`,
            ocr_last_error_at: new Date().toISOString(),
            error_message: `OCR processing failed: ${errorMsg}`, // Keep for backward compatibility
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
      } catch (updateError) {
        logger.error({
          updateError,
          documentId: document.id
        }, 'Failed to update document with error message');
      }
    }
  }

  /**
   * Process an acte document with OCR (using File API)
   */
  private async processActeDocument(
    document: ExtractionQueueJob,
    environment: EnvironmentName
  ): Promise<void> {
    const startTime = Date.now();
    const client = supabaseManager.getServiceClient(environment);
    if (!client) {
      logger.error({ environment }, 'No Supabase client for environment');
      return;
    }

    OCRLogger.documentStart(document.document_number, environment, document.id);

    // Generate worker ID (could be made configurable)
    const workerIdValue = process.env.OCR_WORKER_ID || 'ocr-monitor-1';

    try {
      // Mark job as OCR in-progress before processing
      const { error: updateStartError } = await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.OCR_PROCESSING,
          ocr_worker_id: workerIdValue,
          ocr_started_at: new Date().toISOString(),
          ocr_attempts: (document.ocr_attempts || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      if (updateStartError) {
        logger.error({ error: updateStartError, documentId: document.id }, 'Failed to mark job as OCR in-progress');
        // Continue anyway - this is not critical
      }

      // Validate that we have a PDF path
      if (!document.supabase_path) {
        throw new Error('Document has no supabase_path');
      }

      // Determine bucket name
      const bucketName = 'actes';

      // Remove bucket name prefix if it exists in the path
      let storagePath = document.supabase_path;
      if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
        // Extract path from URL if it's a full URL
        const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
        if (urlMatch) {
          storagePath = urlMatch[1];
        }
      } else if (storagePath.startsWith(`${bucketName}/`)) {
        // Remove bucket prefix from path
        storagePath = storagePath.substring(bucketName.length + 1);
      }

      // Download the PDF from private bucket using authenticated client
      const { data: pdfData, error: downloadError } = await client.storage
        .from(bucketName)
        .download(storagePath);

      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF from bucket: ${downloadError?.message || 'No data'}`);
      }

      // Save to temporary file
      const tempPath = path.join(
        this.acteProcessor['tempDir'],
        `acte-download-${Date.now()}.pdf`
      );

      const arrayBuffer = await pdfData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempPath, buffer);

      logger.debug({
        documentId: document.id,
        fileSize: buffer.length
      }, 'Acte PDF downloaded');

      // Process the acte PDF using File API
      const ocrResult = await this.acteProcessor.processActePDFWithChunking(
        tempPath,
        document.document_number
      );

      // Clean up temp file
      await fs.unlink(tempPath).catch(err => {
        logger.debug({ error: err }, 'Failed to clean up temp acte PDF');
      });

      // Store both raw and boosted text
      const rawText = ocrResult.rawText;
      const boostedText = ocrResult.boostedText;

      // Try to update with both fields first
      let updateError = null;
      let updateData: any = {
        file_content: rawText,
        boosted_file_content: boostedText,
        status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
        ocr_completed_at: new Date().toISOString(),
        ocr_error: null, // Clear any previous OCR errors
        updated_at: new Date().toISOString()
      };

      const { error: firstError } = await client
        .from('extraction_queue')
        .update(updateData)
        .eq('id', document.id);

      // If boosted_file_content column doesn't exist, fall back to just file_content
      if (firstError && firstError.code === 'PGRST204' && firstError.message?.includes('boosted_file_content')) {
        OCRLogger.warning('boosted_file_content column not found', {
          'Migration': '004 not applied',
          'Action': 'Saving only file_content'
        });

        // Retry without boosted_file_content
        updateData = {
          file_content: rawText,
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
          ocr_completed_at: new Date().toISOString(),
          ocr_error: null, // Clear any previous OCR errors
          updated_at: new Date().toISOString()
        };

        const { error: secondError } = await client
          .from('extraction_queue')
          .update(updateData)
          .eq('id', document.id);

        updateError = secondError;
      } else {
        updateError = firstError;
      }

      if (updateError) {
        throw updateError;
      }

      const totalDuration = (Date.now() - startTime) / 1000;
      OCRLogger.documentComplete(
        document.document_number,
        environment,
        1, // Acte documents are typically single-page or treated as one unit
        rawText.length,
        boostedText.length,
        totalDuration
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      OCRLogger.documentError(document.document_number, environment, errorMsg, document.id);

      // Update document with error information
      // Revert status to COMPLETE so it can be retried (if under max attempts)
      try {
        await client
          .from('extraction_queue')
          .update({
            status_id: EXTRACTION_STATUS.COMPLETE, // Revert to ready for retry
            ocr_error: `OCR processing failed: ${errorMsg}`,
            ocr_last_error_at: new Date().toISOString(),
            error_message: `OCR processing failed: ${errorMsg}`, // Keep for backward compatibility
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
      } catch (updateError) {
        logger.error({
          updateError,
          documentId: document.id
        }, 'Failed to update document with error message');
      }
    }
  }
}

// Main entry point for standalone execution
if (require.main === module) {
  if (!config.ocr.geminiApiKey) {
    logger.error('GEMINI_API_KEY environment variable is required');
    process.exit(1);
  }

  const monitor = new OCRMonitor({
    geminiApiKey: config.ocr.geminiApiKey,
    pollIntervalMs: config.ocr.pollIntervalMs,
    tempDir: config.ocr.tempDir
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await monitor.stop();
    process.exit(0);
  });

  // Start the monitor
  monitor.initialize()
    .then(() => monitor.start())
    .catch((error) => {
      logger.error({ error }, 'Failed to start OCR monitor');
      process.exit(1);
    });
}


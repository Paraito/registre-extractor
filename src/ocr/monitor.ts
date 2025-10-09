import { supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { EXTRACTION_STATUS, ExtractionQueueJob } from '../types';
import { OCRProcessor } from './processor';
import { config } from '../config';
import fs from 'fs/promises';
import path from 'path';

export interface OCRMonitorConfig {
  geminiApiKey: string;
  pollIntervalMs?: number;
  tempDir?: string;
  concurrency?: number;
}

/**
 * OCR Monitor Service
 * Monitors extraction_queue for completed index documents and triggers OCR processing
 */
export class OCRMonitor {
  private processor: OCRProcessor;
  private pollIntervalMs: number;
  private isRunning: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(config: OCRMonitorConfig) {
    this.processor = new OCRProcessor({
      geminiApiKey: config.geminiApiKey,
      tempDir: config.tempDir || '/tmp/ocr-processing'
    });

    this.pollIntervalMs = config.pollIntervalMs || 10000; // Default: 10 seconds

    logger.info({
      pollIntervalMs: this.pollIntervalMs
    }, 'OCR Monitor initialized');
  }

  async initialize(): Promise<void> {
    await this.processor.initialize();
    logger.info('OCR Monitor ready');
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
    const disabledEnvs = Object.entries(config.ocr.enabledEnvironments)
      .filter(([_, enabled]) => !enabled)
      .map(([env]) => env);

    logger.info({
      enabledEnvironments: enabledEnvs,
      disabledEnvironments: disabledEnvs
    }, 'OCR Monitor started');

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

    await this.processor.cleanup();
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
        // Find documents with status_id=3 (COMPLETE) and document_source='index'
        // that haven't been OCR processed yet (file_content is null)
        const { data: documents, error } = await client
          .from('extraction_queue')
          .select('*')
          .eq('status_id', EXTRACTION_STATUS.COMPLETE)
          .eq('document_source', 'index')
          .is('file_content', null)
          .order('created_at', { ascending: true })
          .limit(1);

        if (error) {
          logger.error({ error, environment: env }, 'Error querying for documents needing OCR');
          continue;
        }

        if (!documents || documents.length === 0) {
          continue; // No documents to process in this environment
        }

        const document = documents[0];

        logger.info({
          documentId: document.id,
          documentNumber: document.document_number,
          environment: env
        }, 'Found document needing OCR processing');

        // Process this document
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
   * Process a single document with OCR
   */
  private async processDocument(
    document: ExtractionQueueJob,
    environment: EnvironmentName
  ): Promise<void> {
    const client = supabaseManager.getServiceClient(environment);
    if (!client) {
      logger.error({ environment }, 'No Supabase client for environment');
      return;
    }

    logger.info({
      documentId: document.id,
      documentNumber: document.document_number,
      supabasePath: document.supabase_path,
      environment
    }, 'Starting OCR processing for document');

    try {
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

      logger.info({
        documentId: document.id,
        bucketName,
        storagePath
      }, 'Downloading PDF from private bucket');

      // Download the PDF from private bucket using authenticated client
      const { data: pdfData, error: downloadError } = await client.storage
        .from(bucketName)
        .download(storagePath);

      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF from bucket: ${downloadError?.message || 'No data'}`);
      }

      // Save to temporary file
      const tempPath = path.join(
        this.processor['pdfConverter']['tempDir'],
        `download-${Date.now()}.pdf`
      );

      const arrayBuffer = await pdfData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempPath, buffer);

      logger.info({
        documentId: document.id,
        tempPath,
        fileSize: buffer.length
      }, 'PDF downloaded successfully');

      // Process the PDF from the local file
      const ocrResult = await this.processor.processPDF(tempPath);

      // Clean up temp file
      await fs.unlink(tempPath).catch(err => {
        logger.warn({ error: err, tempPath }, 'Failed to clean up temp PDF');
      });

      // Store both raw and boosted text
      // file_content: Raw OCR output from Gemini Vision AI (unprocessed)
      // boosted_file_content: Enhanced text with 60+ correction rules applied
      const rawText = ocrResult.rawText;
      const boostedText = ocrResult.boostedText;

      // Try to update with both fields first
      let updateError = null;
      let updateData: any = {
        file_content: rawText,
        boosted_file_content: boostedText,
        status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
        updated_at: new Date().toISOString()
      };

      const { error: firstError } = await client
        .from('extraction_queue')
        .update(updateData)
        .eq('id', document.id);

      // If boosted_file_content column doesn't exist, fall back to just file_content
      if (firstError && firstError.code === 'PGRST204' && firstError.message?.includes('boosted_file_content')) {
        logger.warn({
          documentId: document.id,
          environment
        }, 'boosted_file_content column not found, saving only file_content (migration 004 not applied)');

        // Retry without boosted_file_content
        updateData = {
          file_content: rawText,
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
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

      logger.info({
        documentId: document.id,
        documentNumber: document.document_number,
        rawTextLength: rawText.length,
        boostedTextLength: boostedText.length,
        extractionComplete: ocrResult.extractionComplete,
        boostComplete: ocrResult.boostComplete,
        environment
      }, 'OCR processing completed successfully');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : error,
        documentId: document.id,
        documentNumber: document.document_number,
        environment
      }, 'OCR processing failed for document');

      // Optionally: Update document with error information
      // For now, we'll leave it in status 3 so it can be retried
      try {
        await client
          .from('extraction_queue')
          .update({
            error_message: `OCR processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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


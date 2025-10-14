import { supabaseManager, EnvironmentName } from '../utils/supabase';
import { logger } from '../utils/logger';
import { EXTRACTION_STATUS, ExtractionQueueJob } from '../types';
import { OCRProcessor } from './processor';
import { ActeOCRProcessor } from './acte-processor';
import { UnifiedOCRProcessor } from './unified-ocr-processor';
import { OCRLogger } from './ocr-logger';
import { staleOCRMonitor } from './stale-ocr-monitor';
import { config } from '../config';
import fs from 'fs/promises';
import path from 'path';

/**
 * Extract just the path portion from a Supabase storage URL
 * Removes the full URL prefix and returns only the storage path
 */
function extractPathFromUrl(url: string): string {
  if (!url) return url;

  // If it's a full URL, extract the path after /storage/v1/object/
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/\/storage\/v1\/object\/(?:(?:public|sign)\/)?(.+)$/);
    if (match) {
      return match[1];
    }
  }

  // Otherwise return as-is
  return url;
}

export interface OCRMonitorConfig {
  geminiApiKey: string;
  claudeApiKey?: string;
  preferredProvider?: 'gemini' | 'claude';
  pollIntervalMs?: number;
  tempDir?: string;
  concurrency?: number;
  workerId?: string;
  extractModel?: {
    gemini?: string;
    claude?: string;
  };
  boostModel?: {
    gemini?: string;
    claude?: string;
  };
  extractTemperature?: number;
  boostTemperature?: number;
  acte?: {
    extractModel?: {
      gemini?: string;
      claude?: string;
    };
    boostModel?: {
      gemini?: string;
      claude?: string;
    };
    extractTemperature?: number;
    boostTemperature?: number;
  };
}

/**
 * OCR Monitor Service
 * Monitors extraction_queue for completed documents (index and acte) and triggers OCR processing
 * Uses UnifiedOCRProcessor with automatic Gemini -> Claude fallback
 */
export class OCRMonitor {
  private unifiedProcessor!: UnifiedOCRProcessor;
  private indexProcessor!: OCRProcessor; // Legacy - kept for backward compatibility
  private acteProcessor!: ActeOCRProcessor; // Legacy - kept for backward compatibility
  private pollIntervalMs: number;
  private isRunning: boolean = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private workerId: string;
  private useUnifiedProcessor: boolean;
  private tempDir: string;

  constructor(config: OCRMonitorConfig) {
    // Generate unique worker ID
    this.workerId = config.workerId || `ocr-worker-${process.pid}-${Date.now()}`;
    this.tempDir = config.tempDir || '/tmp/ocr-processing';

    logger.debug({ workerId: this.workerId }, 'OCR Worker ID assigned');

    // Use unified processor if Claude API key is provided
    this.useUnifiedProcessor = !!config.claudeApiKey;

    if (this.useUnifiedProcessor) {
      // Initialize unified processor with automatic fallback
      this.unifiedProcessor = new UnifiedOCRProcessor({
        geminiApiKey: config.geminiApiKey,
        claudeApiKey: config.claudeApiKey!,
        tempDir: this.tempDir,
        preferredProvider: config.preferredProvider || 'gemini',
        extractModel: config.extractModel,
        boostModel: config.boostModel,
        extractTemperature: config.extractTemperature,
        boostTemperature: config.boostTemperature,
      });

      // IMPORTANT: Still initialize acteProcessor for acte document processing
      // Acte documents use File API (not Vision API), so they need their own processor
      this.acteProcessor = new ActeOCRProcessor({
        geminiApiKey: config.geminiApiKey,
        tempDir: `${this.tempDir}-acte`,
        extractModel: config.acte?.extractModel?.gemini,
        boostModel: config.acte?.boostModel?.gemini,
        extractTemperature: config.acte?.extractTemperature,
        boostTemperature: config.acte?.boostTemperature,
      });

      OCRLogger.info(`🔄 Using Unified OCR Processor with automatic fallback (preferred: ${config.preferredProvider || 'gemini'})`);
    } else {
      // Fallback to legacy processors (Gemini only)
      this.indexProcessor = new OCRProcessor({
        geminiApiKey: config.geminiApiKey,
        tempDir: this.tempDir
      });

      this.acteProcessor = new ActeOCRProcessor({
        geminiApiKey: config.geminiApiKey,
        tempDir: `${this.tempDir}-acte`,
        extractModel: config.acte?.extractModel?.gemini,
        boostModel: config.acte?.boostModel?.gemini,
        extractTemperature: config.acte?.extractTemperature,
        boostTemperature: config.acte?.boostTemperature,
      });

      OCRLogger.warning('⚠️  Using legacy Gemini-only processors (no Claude fallback)');
    }

    this.pollIntervalMs = config.pollIntervalMs || 10000; // Default: 10 seconds

    logger.debug({
      pollIntervalMs: this.pollIntervalMs,
      useUnifiedProcessor: this.useUnifiedProcessor
    }, 'OCR Monitor initialized');
  }

  async initialize(): Promise<void> {
    if (this.useUnifiedProcessor) {
      await this.unifiedProcessor.initialize();
      await this.acteProcessor.initialize(); // Always initialize acte processor
      logger.debug('Unified OCR Processor and Acte Processor initialized');
    } else {
      await this.indexProcessor.initialize();
      await this.acteProcessor.initialize();
      logger.debug('Legacy OCR processors initialized');
    }
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

    // Cleanup processors
    if (this.useUnifiedProcessor) {
      await this.unifiedProcessor.cleanup();
    } else {
      await this.indexProcessor.cleanup();
    }
    await this.acteProcessor.cleanup(); // Always cleanup acte processor

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
   * Uses database-level locking to prevent race conditions between workers
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

        // Try to claim a document using atomic update (prevents race conditions)
        let claimedDocument: ExtractionQueueJob | null = null;

        for (const document of eligibleDocuments) {
          // Atomically claim the document by updating status to OCR_PROCESSING
          // This will only succeed if the document is still in COMPLETE status
          const { data: updatedDocs, error: claimError } = await client
            .from('extraction_queue')
            .update({
              status_id: EXTRACTION_STATUS.OCR_PROCESSING,
              ocr_worker_id: this.workerId,
              ocr_started_at: new Date().toISOString(),
              ocr_attempts: (document.ocr_attempts || 0) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', document.id)
            .eq('status_id', EXTRACTION_STATUS.COMPLETE) // Only update if still COMPLETE
            .select();

          if (!claimError && updatedDocs && updatedDocs.length > 0) {
            // Successfully claimed this document
            claimedDocument = updatedDocs[0] as ExtractionQueueJob;
            logger.debug({
              documentId: document.id,
              documentNumber: document.document_number,
              workerId: this.workerId,
              environment: env
            }, 'Document claimed by worker');
            break;
          } else if (claimError) {
            logger.debug({
              documentId: document.id,
              error: claimError,
              environment: env
            }, 'Failed to claim document (may have been claimed by another worker)');
          } else {
            logger.debug({
              documentId: document.id,
              environment: env
            }, 'Document already claimed by another worker');
          }
        }

        if (!claimedDocument) {
          // All documents were already claimed by other workers
          logger.debug({
            environment: env,
            attemptedDocuments: eligibleDocuments.length
          }, 'No documents available to claim (all claimed by other workers)');
          continue;
        }

        // Process the claimed document (routing to appropriate processor based on document_source)
        await this.processDocument(claimedDocument, env);

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
   * Note: Document is already claimed and marked as OCR_PROCESSING by processNextDocument
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

    try {
      // Document is already claimed and marked as OCR_PROCESSING by processNextDocument
      // No need to update status again here

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
        // Handle both formats:
        // 1. With /public/ or /sign/: /storage/v1/object/public/bucket/path or /storage/v1/object/sign/bucket/path
        // 2. Direct bucket path: /storage/v1/object/bucket/path
        const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:(?:public|sign)\/)?(.+)$/);
        if (urlMatch) {
          const fullPath = urlMatch[1];
          // Remove bucket name from the beginning if present
          if (fullPath.startsWith(`${bucketName}/`)) {
            storagePath = fullPath.substring(bucketName.length + 1);
          } else {
            storagePath = fullPath;
          }
        } else {
          logger.warn({
            documentId: document.id,
            supabasePath: extractPathFromUrl(document.supabase_path)
          }, 'Could not parse URL format, using as-is');
        }
      } else if (storagePath.startsWith(`${bucketName}/`)) {
        // Remove bucket prefix from path
        storagePath = storagePath.substring(bucketName.length + 1);
      }

      logger.debug({
        documentId: document.id,
        documentSource: document.document_source,
        originalPath: extractPathFromUrl(document.supabase_path),
        parsedPath: storagePath,
        bucket: bucketName
      }, 'Index/Plan PDF path parsing');

      // Download the PDF from private bucket using authenticated client
      const { data: pdfData, error: downloadError } = await client.storage
        .from(bucketName)
        .download(storagePath);

      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF from bucket: ${JSON.stringify(downloadError)}`);
      }

      // Save to temporary file
      const tempPath = path.join(this.tempDir, `download-${Date.now()}.pdf`);

      const arrayBuffer = await pdfData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempPath, buffer);

      logger.debug({
        documentId: document.id,
        fileSize: buffer.length
      }, 'PDF downloaded');

      // Process the PDF with automatic fallback
      // Unified processor: Tries Gemini first, falls back to Claude on failure
      // Legacy processor: Gemini only
      const ocrResult = this.useUnifiedProcessor
        ? await this.unifiedProcessor.processPDFParallel(tempPath)
        : await this.indexProcessor.processPDFParallel(tempPath);

      // Clean up temp file
      await fs.unlink(tempPath).catch(err => {
        logger.debug({ error: err }, 'Failed to clean up temp PDF');
      });

      // Store both raw and boosted text
      // file_content: Raw LLM output (boosted text with corrections applied)
      // boosted_file_content: Same as file_content (for backward compatibility)
      const rawText = ocrResult.combinedRawText;
      const boostedText = ocrResult.combinedBoostedText;

      logger.info({
        documentId: document.id,
        rawTextLength: rawText.length,
        boostedTextLength: boostedText.length
      }, 'OCR processing complete');

      // Try to update with both fields first
      let updateError = null;
      let updateData: any = {
        file_content: boostedText,                  // Store raw LLM output directly
        boosted_file_content: boostedText,          // Same content for backward compatibility
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
          file_content: boostedText,  // Store raw LLM output
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
        boostedText.length,      // Raw LLM output length
        boostedText.length,      // Same as file_content
        totalDuration
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      OCRLogger.documentError(document.document_number, environment, errorMsg, document.id);

      // Check if max attempts reached
      const currentAttempts = document.ocr_attempts || 0;
      const maxAttempts = document.ocr_max_attempts || 3;
      const hasReachedMaxAttempts = currentAttempts >= maxAttempts;

      // Update document with error information
      // If max attempts reached, set status to ERREUR (4), otherwise revert to COMPLETE (3) for retry
      try {
        await client
          .from('extraction_queue')
          .update({
            status_id: hasReachedMaxAttempts ? EXTRACTION_STATUS.ERREUR : EXTRACTION_STATUS.COMPLETE,
            ocr_error: `OCR processing failed: ${errorMsg}`,
            ocr_last_error_at: new Date().toISOString(),
            // Do NOT set error_message - that's for registre extractor errors only
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);

        if (hasReachedMaxAttempts) {
          logger.warn({
            documentId: document.id,
            documentNumber: document.document_number,
            attempts: currentAttempts,
            maxAttempts
          }, 'OCR max attempts reached - marking as ERREUR');
        }
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
   * Note: Document is already claimed and marked as OCR_PROCESSING by processNextDocument
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

    try {
      // Document is already claimed and marked as OCR_PROCESSING by processNextDocument
      // No need to update status again here

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
        // Handle both formats:
        // 1. With /public/ or /sign/: /storage/v1/object/public/bucket/path or /storage/v1/object/sign/bucket/path
        // 2. Direct bucket path: /storage/v1/object/bucket/path
        const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:(?:public|sign)\/)?(.+)$/);
        if (urlMatch) {
          const fullPath = urlMatch[1];
          // Remove bucket name from the beginning if present
          if (fullPath.startsWith(`${bucketName}/`)) {
            storagePath = fullPath.substring(bucketName.length + 1);
          } else {
            storagePath = fullPath;
          }
        } else {
          logger.warn({
            documentId: document.id,
            supabasePath: extractPathFromUrl(document.supabase_path)
          }, 'Could not parse URL format, using as-is');
        }
      } else if (storagePath.startsWith(`${bucketName}/`)) {
        // Remove bucket prefix from path
        storagePath = storagePath.substring(bucketName.length + 1);
      }

      logger.debug({
        documentId: document.id,
        originalPath: extractPathFromUrl(document.supabase_path),
        parsedPath: storagePath,
        bucket: bucketName
      }, 'Acte PDF path parsing');

      // Download the PDF from private bucket using authenticated client
      const { data: pdfData, error: downloadError } = await client.storage
        .from(bucketName)
        .download(storagePath);

      if (downloadError || !pdfData) {
        throw new Error(`Failed to download PDF from bucket: ${JSON.stringify(downloadError)}`);
      }

      // Save to temporary file
      const tempPath = path.join(
        `${this.tempDir}-acte`,
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

      // Check if max attempts reached
      const currentAttempts = document.ocr_attempts || 0;
      const maxAttempts = document.ocr_max_attempts || 3;
      const hasReachedMaxAttempts = currentAttempts >= maxAttempts;

      // Update document with error information
      // If max attempts reached, set status to ERREUR (4), otherwise revert to COMPLETE (3) for retry
      try {
        await client
          .from('extraction_queue')
          .update({
            status_id: hasReachedMaxAttempts ? EXTRACTION_STATUS.ERREUR : EXTRACTION_STATUS.COMPLETE,
            ocr_error: `OCR processing failed: ${errorMsg}`,
            ocr_last_error_at: new Date().toISOString(),
            // Do NOT set error_message - that's for registre extractor errors only
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);

        if (hasReachedMaxAttempts) {
          logger.warn({
            documentId: document.id,
            documentNumber: document.document_number,
            attempts: currentAttempts,
            maxAttempts
          }, 'OCR max attempts reached - marking as ERREUR');
        }
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

  // Log provider configuration
  if (config.ocr.claudeApiKey) {
    logger.info({
      preferredProvider: config.ocr.preferredProvider,
      hasGemini: !!config.ocr.geminiApiKey,
      hasClaude: !!config.ocr.claudeApiKey
    }, '🔄 Unified OCR with automatic fallback enabled');
  } else {
    logger.warn('⚠️  Claude API key not configured - using Gemini only (no fallback)');
  }

  const workerCount = config.ocr.workerCount || 2;
  const workers: OCRMonitor[] = [];

  logger.info({ workerCount }, 'Starting OCR workers');

  // Create and start multiple workers
  for (let i = 0; i < workerCount; i++) {
    const workerId = config.ocr.workerId || `ocr-worker-${i + 1}`;

    const monitor = new OCRMonitor({
      geminiApiKey: config.ocr.geminiApiKey,
      claudeApiKey: config.ocr.claudeApiKey,
      preferredProvider: config.ocr.preferredProvider,
      pollIntervalMs: config.ocr.pollIntervalMs,
      tempDir: `${config.ocr.tempDir}-${i + 1}`,
      workerId,
      extractModel: config.ocr.extractModel,
      boostModel: config.ocr.boostModel,
      extractTemperature: config.ocr.extractTemperature,
      boostTemperature: config.ocr.boostTemperature,
      acte: config.ocr.acte
    });

    workers.push(monitor);

    // Initialize and start this worker
    monitor.initialize()
      .then(() => monitor.start())
      .catch((error) => {
        logger.error({ error, workerId }, 'Failed to start OCR worker');
        process.exit(1);
      });
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down all OCR workers...');
    await Promise.all(workers.map(w => w.stop()));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}


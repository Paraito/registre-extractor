#!/usr/bin/env node

/**
 * Start OCR Workers
 * 
 * Starts OCR workers to process documents from extraction_queue
 * with status_id = 3 (COMPLETE) and perform OCR extraction using Gemini File API
 */

import { OCRWorker } from './ocr-worker';
import { staleOCRJobMonitor } from './stale-ocr-job-monitor';
import { logger } from '../utils/logger';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const WORKER_COUNT = config.ocr.workerCount || 2;

// Global state
let workers: Array<{ worker: OCRWorker; workerId: string }> = [];

/**
 * Start OCR workers
 */
async function startWorkers(): Promise<void> {
  logger.info('='.repeat(60));
  logger.info('🚀 OCR WORKERS STARTING');
  logger.info('='.repeat(60));
  logger.info('');

  // Check configuration
  if (!config.ocr.geminiApiKey) {
    logger.error('❌ GEMINI_API_KEY is not configured');
    logger.error('   Please set GEMINI_API_KEY in your .env file');
    process.exit(1);
  }

  // Log enabled environments
  const enabledEnvs = Object.entries(config.ocr.enabledEnvironments)
    .filter(([_, enabled]) => enabled)
    .map(([env]) => env);

  if (enabledEnvs.length === 0) {
    logger.error('❌ No OCR-enabled environments configured');
    logger.error('   Please set OCR_DEV=true, OCR_STAGING=true, or OCR_PROD=true in your .env file');
    process.exit(1);
  }

  logger.info('⚙️  Configuration:');
  logger.info(`   Worker count: ${WORKER_COUNT}`);
  logger.info(`   Enabled environments: ${enabledEnvs.join(', ')}`);
  logger.info(`   Gemini model: ${config.ocr.extractModel.gemini}`);
  logger.info(`   Temperature: ${config.ocr.extractTemperature}`);
  logger.info(`   Temp directory: ${config.ocr.tempDir}`);
  logger.info('');

  // Start stale job monitor
  logger.info('🔍 Starting stale OCR job monitor...');
  staleOCRJobMonitor.start();
  logger.info('✅ Stale job monitor started');
  logger.info('');

  // Start workers
  logger.info(`👷 Starting ${WORKER_COUNT} OCR worker(s)...`);
  logger.info('');

  for (let i = 0; i < WORKER_COUNT; i++) {
    const workerId = config.ocr.workerId
      ? `${config.ocr.workerId}-${i + 1}`
      : `ocr-worker-${i + 1}-${uuidv4().substring(0, 8)}`;

    const worker = new OCRWorker(workerId);
    workers.push({ worker, workerId });

    // Initialize worker (non-blocking)
    worker.initialize().catch((error) => {
      logger.error({ error, workerId }, 'Worker failed to initialize');
    });

    logger.info(`✅ Started ${workerId}`);
  }

  logger.info('');
  logger.info('='.repeat(60));
  logger.info('✅ OCR WORKERS STARTED SUCCESSFULLY');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info('💡 Workers will process jobs from these environments:');
  enabledEnvs.forEach(env => {
    logger.info(`   - ${env}`);
  });
  logger.info('');
  logger.info('📊 Monitoring for jobs with:');
  logger.info('   - status_id = 3 (COMPLETE)');
  logger.info('   - supabase_path is not null');
  logger.info('   - ocr_attempts < ocr_max_attempts');
  logger.info('');

  // Start status logging
  startStatusLogging();
}

/**
 * Log worker status periodically
 */
function startStatusLogging(): void {
  setInterval(() => {
    logger.info('='.repeat(60));
    logger.info('📊 OCR WORKER STATUS');
    logger.info('='.repeat(60));
    logger.info(`   Active workers: ${workers.length}`);
    workers.forEach(({ workerId }) => {
      logger.info(`   - ${workerId}: Running`);
    });
    logger.info('');
  }, 5 * 60 * 1000); // Every 5 minutes
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info(`🛑 SHUTTING DOWN OCR WORKERS (${signal})`);
  logger.info('='.repeat(60));
  logger.info('');

  // Stop stale job monitor
  logger.info('🔍 Stopping stale job monitor...');
  staleOCRJobMonitor.stop();

  // Shutdown all workers
  logger.info(`👷 Shutting down ${workers.length} worker(s)...`);
  await Promise.all(workers.map(({ worker, workerId }) => {
    logger.info(`   Stopping ${workerId}...`);
    return worker.shutdown();
  }));

  logger.info('');
  logger.info('✅ All OCR workers stopped');
  logger.info('');

  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception in OCR worker process');
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection in OCR worker process');
  shutdown('UNHANDLED_REJECTION');
});

// Start the workers
startWorkers().catch((error) => {
  logger.error({ error }, 'Failed to start OCR workers');
  process.exit(1);
});


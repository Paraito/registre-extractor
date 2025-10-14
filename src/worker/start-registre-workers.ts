#!/usr/bin/env node

/**
 * Start Registre Extractor Workers with Capacity Management
 * 
 * Integrates registre extractor workers with the shared capacity manager
 * to coordinate resources with OCR workers.
 */

import { ExtractionWorker } from './index';
import { ServerCapacityManager, ServerCapacity } from '../shared/capacity-manager';
import { logger } from '../utils/logger';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration from environment
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '1');
const SERVER_MAX_CPU = parseFloat(process.env.SERVER_MAX_CPU || '8');
const SERVER_MAX_RAM = parseFloat(process.env.SERVER_MAX_RAM || '16');
const SERVER_RESERVE_CPU_PERCENT = parseFloat(process.env.SERVER_RESERVE_CPU_PERCENT || '20');
const SERVER_RESERVE_RAM_PERCENT = parseFloat(process.env.SERVER_RESERVE_RAM_PERCENT || '20');
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Global state
let capacityManager: ServerCapacityManager;
let workers: Array<{ worker: ExtractionWorker; workerId: string }> = [];

/**
 * Initialize capacity manager
 */
async function initializeCapacityManager(): Promise<void> {
  logger.info('='.repeat(60));
  logger.info('🚀 REGISTRE EXTRACTOR WORKERS STARTING');
  logger.info('='.repeat(60));
  
  logger.info('💾 Initializing server capacity manager...');
  
  const serverCapacity: ServerCapacity = {
    maxCPU: SERVER_MAX_CPU,
    maxRAM: SERVER_MAX_RAM,
    reservedCPU: (SERVER_MAX_CPU * SERVER_RESERVE_CPU_PERCENT) / 100,
    reservedRAM: (SERVER_MAX_RAM * SERVER_RESERVE_RAM_PERCENT) / 100
  };
  
  capacityManager = new ServerCapacityManager(serverCapacity, REDIS_URL);
  await capacityManager.connect();
  
  logger.info('✅ Capacity manager initialized');
  logger.info('');
}

/**
 * Check if we have capacity for workers
 */
async function checkCapacityForWorkers(count: number): Promise<boolean> {
  logger.info(`🔍 Checking capacity for ${count} registre worker(s)...`);
  
  // Check capacity for each worker
  for (let i = 0; i < count; i++) {
    const capacityCheck = await capacityManager.checkCapacity('registre');
    
    if (!capacityCheck.allowed) {
      logger.warn({
        reason: capacityCheck.reason,
        currentCPU: capacityCheck.currentCPU,
        currentRAM: capacityCheck.currentRAM,
        availableCPU: capacityCheck.availableCPU,
        availableRAM: capacityCheck.availableRAM
      }, `Insufficient capacity for worker ${i + 1}`);
      
      return false;
    }
  }
  
  logger.info(`✅ Sufficient capacity for ${count} worker(s)`);
  return true;
}

/**
 * Start workers with capacity management
 */
async function startWorkers(): Promise<void> {
  logger.info('👷 Starting registre extractor workers...');
  logger.info('');
  
  // Check capacity first
  const hasCapacity = await checkCapacityForWorkers(WORKER_COUNT);
  
  if (!hasCapacity) {
    logger.error('❌ Insufficient server capacity to start workers');
    logger.error('   Reduce WORKER_COUNT or increase SERVER_MAX_CPU/SERVER_MAX_RAM');
    process.exit(1);
  }
  
  // Start workers
  for (let i = 0; i < WORKER_COUNT; i++) {
    const workerId = process.env.WORKER_ID
      ? `${process.env.WORKER_ID}-${i + 1}`
      : `registre-worker-${i + 1}-${uuidv4().substring(0, 8)}`;
    
    // Allocate resources in capacity manager
    await capacityManager.allocateResources(workerId, 'registre');
    
    // Create worker
    const worker = new ExtractionWorker(workerId);
    workers.push({ worker, workerId });
    
    // Initialize worker (non-blocking)
    worker.initialize().catch((error) => {
      logger.error({ error, workerId }, 'Worker failed to initialize');
      
      // Release resources on failure
      capacityManager.releaseResources(workerId).catch(err => {
        logger.error({ error: err, workerId }, 'Failed to release resources');
      });
    });
    
    logger.info(`✅ Started ${workerId}`);
  }
  
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('✅ REGISTRE WORKERS STARTED SUCCESSFULLY');
  logger.info('='.repeat(60));
  logger.info('');
  
  // Log configuration
  logger.info('⚙️  Configuration:');
  logger.info(`   Worker count: ${WORKER_COUNT}`);
  logger.info(`   Server capacity: ${SERVER_MAX_CPU} vCPUs, ${SERVER_MAX_RAM} GB RAM`);
  logger.info(`   Reserved: ${SERVER_RESERVE_CPU_PERCENT}% CPU, ${SERVER_RESERVE_RAM_PERCENT}% RAM`);
  logger.info(`   Resources per worker: 3 vCPUs, 1 GB RAM`);
  logger.info(`   Total allocated: ${WORKER_COUNT * 3} vCPUs, ${WORKER_COUNT} GB RAM`);
  logger.info('');
  
  // Start status logging
  startStatusLogging();
}

/**
 * Start periodic status logging
 */
function startStatusLogging(): void {
  setInterval(async () => {
    try {
      const capacityStatus = await capacityManager.getStatus();
      
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('📊 REGISTRE WORKERS STATUS');
      logger.info('='.repeat(60));
      
      logger.info('');
      logger.info('👷 Workers:');
      logger.info(`   Active: ${workers.length}`);
      logger.info(`   Registered in capacity manager: ${capacityStatus.workersByType['registre'] || 0}`);
      
      logger.info('');
      logger.info('💾 Server Capacity:');
      logger.info(`   CPU: ${capacityStatus.allocatedCPU.toFixed(1)} / ${capacityStatus.availableCPU.toFixed(1)} vCPUs (${capacityStatus.cpuUsagePercent.toFixed(1)}%)`);
      logger.info(`   RAM: ${capacityStatus.allocatedRAM.toFixed(2)} / ${capacityStatus.availableRAM.toFixed(2)} GB (${capacityStatus.ramUsagePercent.toFixed(1)}%)`);
      logger.info(`   Workers by type:`);
      logger.info(`     - Registre: ${capacityStatus.workersByType['registre'] || 0}`);
      logger.info(`     - Index OCR: ${capacityStatus.workersByType['index-ocr'] || 0}`);
      logger.info(`     - Acte OCR: ${capacityStatus.workersByType['acte-ocr'] || 0}`);
      
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('');
      
    } catch (error) {
      logger.error({ error }, 'Failed to log status');
    }
  }, 60000); // Log every 60 seconds
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('🛑 SHUTTING DOWN REGISTRE WORKERS');
  logger.info('='.repeat(60));
  
  // Stop all workers
  logger.info('Stopping workers...');
  await Promise.all(workers.map(({ worker }) => worker.shutdown()));
  
  // Release resources
  logger.info('Releasing resources...');
  await Promise.all(workers.map(({ workerId }) => 
    capacityManager.releaseResources(workerId)
  ));
  
  // Disconnect capacity manager
  logger.info('Disconnecting capacity manager...');
  await capacityManager.disconnect();
  
  logger.info('');
  logger.info('✅ REGISTRE WORKERS STOPPED SUCCESSFULLY');
  logger.info('='.repeat(60));
  
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Initialize capacity manager
    await initializeCapacityManager();
    
    // Start workers
    await startWorkers();
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error({ error }, 'Failed to start registre workers');
    process.exit(1);
  }
}

// Start the workers
main();


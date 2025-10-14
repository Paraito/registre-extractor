#!/usr/bin/env node

/**
 * Start Unified OCR Worker Pool
 * 
 * Starts a pool of generic OCR workers that dynamically handle both
 * index and acte documents based on queue composition.
 */

import { SharedRateLimiter } from '../shared/rate-limiter';
import { ServerCapacityManager, ServerCapacity } from '../shared/capacity-manager';
import { WorkerPoolManager } from '../shared/worker-pool-manager';
import { GenericOCRWorker } from './generic-ocr-worker';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration from environment
const POOL_SIZE = parseInt(process.env.OCR_WORKER_POOL_SIZE || '4');
const MIN_INDEX_WORKERS = parseInt(process.env.OCR_MIN_INDEX_WORKERS || '1');
const MIN_ACTE_WORKERS = parseInt(process.env.OCR_MIN_ACTE_WORKERS || '1');
const REBALANCE_INTERVAL = parseInt(process.env.OCR_REBALANCE_INTERVAL_MS || '30000');

const SERVER_MAX_CPU = parseFloat(process.env.SERVER_MAX_CPU || '8');
const SERVER_MAX_RAM = parseFloat(process.env.SERVER_MAX_RAM || '16');
const SERVER_RESERVE_CPU_PERCENT = parseFloat(process.env.SERVER_RESERVE_CPU_PERCENT || '20');
const SERVER_RESERVE_RAM_PERCENT = parseFloat(process.env.SERVER_RESERVE_RAM_PERCENT || '20');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Global state
let rateLimiter: SharedRateLimiter;
let capacityManager: ServerCapacityManager;
let poolManager: WorkerPoolManager;
let workers: GenericOCRWorker[] = [];
let resetInterval: NodeJS.Timeout;

/**
 * Initialize managers
 */
async function initializeManagers(): Promise<void> {
  logger.info('='.repeat(60));
  logger.info('🚀 UNIFIED OCR WORKER POOL STARTING');
  logger.info('='.repeat(60));
  
  // Initialize rate limiter
  logger.info('📊 Initializing shared rate limiter...');
  rateLimiter = new SharedRateLimiter(REDIS_URL);
  await rateLimiter.connect();
  
  // Start automatic rate limit reset
  resetInterval = rateLimiter.startAutoReset();
  
  // Initialize capacity manager
  logger.info('💾 Initializing server capacity manager...');
  const serverCapacity: ServerCapacity = {
    maxCPU: SERVER_MAX_CPU,
    maxRAM: SERVER_MAX_RAM,
    reservedCPU: (SERVER_MAX_CPU * SERVER_RESERVE_CPU_PERCENT) / 100,
    reservedRAM: (SERVER_MAX_RAM * SERVER_RESERVE_RAM_PERCENT) / 100
  };
  
  capacityManager = new ServerCapacityManager(serverCapacity, REDIS_URL);
  await capacityManager.connect();
  
  // Initialize pool manager
  logger.info('🎯 Initializing worker pool manager...');
  poolManager = new WorkerPoolManager(
    POOL_SIZE,
    MIN_INDEX_WORKERS,
    MIN_ACTE_WORKERS,
    REBALANCE_INTERVAL,
    REDIS_URL
  );
  await poolManager.initialize();
  
  // Start automatic rebalancing
  poolManager.startRebalancing();
  
  logger.info('✅ All managers initialized');
  logger.info('');
}

/**
 * Start worker pool
 */
async function startWorkerPool(): Promise<void> {
  logger.info('👷 Starting worker pool...');
  logger.info('');
  
  // Get initial allocation
  const allocation = await poolManager.getCurrentAllocation();
  
  logger.info('📋 Initial Worker Allocation:');
  logger.info(`   Index workers: ${allocation.indexWorkers}`);
  logger.info(`   Acte workers: ${allocation.acteWorkers}`);
  logger.info(`   Total workers: ${allocation.totalWorkers}`);
  logger.info('');
  
  // Create and start workers
  for (let i = 0; i < POOL_SIZE; i++) {
    const workerId = `ocr-worker-${i + 1}`;
    
    // Determine initial mode based on allocation
    const initialMode: 'index' | 'acte' = i < allocation.indexWorkers ? 'index' : 'acte';
    
    // Create worker
    const worker = new GenericOCRWorker(
      workerId,
      rateLimiter,
      capacityManager,
      poolManager
    );
    
    // Initialize worker
    await worker.initialize();
    
    // Assign initial mode
    await poolManager.assignWorkerMode(workerId, initialMode);
    
    // Start worker (non-blocking)
    worker.start().catch(error => {
      logger.error({ error, workerId }, 'Worker crashed');
    });
    
    workers.push(worker);
    
    logger.info(`✅ Started ${workerId} (mode: ${initialMode})`);
  }
  
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('✅ WORKER POOL STARTED SUCCESSFULLY');
  logger.info('='.repeat(60));
  logger.info('');
  
  // Log configuration
  logger.info('⚙️  Configuration:');
  logger.info(`   Pool size: ${POOL_SIZE} workers`);
  logger.info(`   Min index workers: ${MIN_INDEX_WORKERS}`);
  logger.info(`   Min acte workers: ${MIN_ACTE_WORKERS}`);
  logger.info(`   Rebalance interval: ${REBALANCE_INTERVAL}ms`);
  logger.info(`   Server capacity: ${SERVER_MAX_CPU} vCPUs, ${SERVER_MAX_RAM} GB RAM`);
  logger.info(`   Reserved: ${SERVER_RESERVE_CPU_PERCENT}% CPU, ${SERVER_RESERVE_RAM_PERCENT}% RAM`);
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
      // Get rate limiter status
      const rateLimitStatus = await rateLimiter.getStatus();
      
      // Get capacity status
      const capacityStatus = await capacityManager.getStatus();
      
      // Get pool allocation
      const allocation = await poolManager.getCurrentAllocation();
      
      logger.info('');
      logger.info('='.repeat(60));
      logger.info('📊 WORKER POOL STATUS');
      logger.info('='.repeat(60));
      
      logger.info('');
      logger.info('🎯 Worker Allocation:');
      logger.info(`   Index workers: ${allocation.indexWorkers}`);
      logger.info(`   Acte workers: ${allocation.acteWorkers}`);
      logger.info(`   Active workers: ${rateLimitStatus.activeWorkers}`);
      logger.info(`     - Index: ${rateLimitStatus.workersByType.index || 0}`);
      logger.info(`     - Acte: ${rateLimitStatus.workersByType.acte || 0}`);
      
      logger.info('');
      logger.info('📡 Gemini API Usage:');
      logger.info(`   RPM: ${rateLimitStatus.currentRPM} / ${rateLimitStatus.maxRPM} (${rateLimitStatus.rpmUsagePercent.toFixed(1)}%)`);
      logger.info(`   TPM: ${rateLimitStatus.currentTPM.toLocaleString()} / ${rateLimitStatus.maxTPM.toLocaleString()} (${rateLimitStatus.tpmUsagePercent.toFixed(1)}%)`);
      
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
  logger.info('🛑 SHUTTING DOWN WORKER POOL');
  logger.info('='.repeat(60));
  
  // Stop all workers
  logger.info('Stopping workers...');
  await Promise.all(workers.map(worker => worker.stop()));
  
  // Stop pool manager
  logger.info('Stopping pool manager...');
  await poolManager.disconnect();
  
  // Stop rate limiter
  logger.info('Stopping rate limiter...');
  if (resetInterval) {
    clearInterval(resetInterval);
  }
  await rateLimiter.disconnect();
  
  // Stop capacity manager
  logger.info('Stopping capacity manager...');
  await capacityManager.disconnect();
  
  logger.info('');
  logger.info('✅ WORKER POOL STOPPED SUCCESSFULLY');
  logger.info('='.repeat(60));
  
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Initialize managers
    await initializeManagers();
    
    // Start worker pool
    await startWorkerPool();
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error({ error }, 'Failed to start worker pool');
    process.exit(1);
  }
}

// Start the pool
main();


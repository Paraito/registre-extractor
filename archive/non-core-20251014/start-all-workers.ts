#!/usr/bin/env node

/**
 * Start ALL Workers - Unified Startup
 * 
 * Starts both registre extractor workers AND OCR worker pool
 * with coordinated capacity management.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from './utils/logger';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '1');
const OCR_WORKER_POOL_SIZE = parseInt(process.env.OCR_WORKER_POOL_SIZE || '4');
const SERVER_MAX_CPU = parseFloat(process.env.SERVER_MAX_CPU || '8');
const SERVER_MAX_RAM = parseFloat(process.env.SERVER_MAX_RAM || '16');

// Process tracking
let registreProcess: ChildProcess | null = null;
let ocrPoolProcess: ChildProcess | null = null;

/**
 * Calculate resource requirements
 */
function calculateResourceRequirements(): {
  registreCPU: number;
  registreRAM: number;
  ocrCPU: number;
  ocrRAM: number;
  totalCPU: number;
  totalRAM: number;
  availableCPU: number;
  availableRAM: number;
  fits: boolean;
} {
  // Registre workers: 3 vCPUs, 1 GB each
  const registreCPU = WORKER_COUNT * 3;
  const registreRAM = WORKER_COUNT * 1;
  
  // OCR workers: average 1.25 vCPUs, 0.625 GB each (mix of index and acte)
  const ocrCPU = OCR_WORKER_POOL_SIZE * 1.25;
  const ocrRAM = OCR_WORKER_POOL_SIZE * 0.625;
  
  // Total
  const totalCPU = registreCPU + ocrCPU;
  const totalRAM = registreRAM + ocrRAM;
  
  // Available (with 20% reserve)
  const availableCPU = SERVER_MAX_CPU * 0.8;
  const availableRAM = SERVER_MAX_RAM * 0.8;
  
  // Check if it fits
  const fits = totalCPU <= availableCPU && totalRAM <= availableRAM;
  
  return {
    registreCPU,
    registreRAM,
    ocrCPU,
    ocrRAM,
    totalCPU,
    totalRAM,
    availableCPU,
    availableRAM,
    fits
  };
}

/**
 * Start registre extractor workers
 */
function startRegistreWorkers(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('🚀 Starting registre extractor workers...');
    
    registreProcess = spawn('tsx', ['src/worker/start-registre-workers.ts'], {
      stdio: 'inherit',
      env: process.env
    });
    
    registreProcess.on('error', (error) => {
      logger.error({ error }, 'Failed to start registre workers');
      reject(error);
    });
    
    // Give it a moment to start
    setTimeout(() => {
      if (registreProcess && !registreProcess.killed) {
        logger.info('✅ Registre workers started');
        resolve();
      } else {
        reject(new Error('Registre workers failed to start'));
      }
    }, 2000);
  });
}

/**
 * Start OCR worker pool
 */
function startOCRPool(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('🚀 Starting OCR worker pool...');
    
    ocrPoolProcess = spawn('tsx', ['src/ocr/start-worker-pool.ts'], {
      stdio: 'inherit',
      env: process.env
    });
    
    ocrPoolProcess.on('error', (error) => {
      logger.error({ error }, 'Failed to start OCR pool');
      reject(error);
    });
    
    // Give it a moment to start
    setTimeout(() => {
      if (ocrPoolProcess && !ocrPoolProcess.killed) {
        logger.info('✅ OCR worker pool started');
        resolve();
      } else {
        reject(new Error('OCR worker pool failed to start'));
      }
    }, 2000);
  });
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('🛑 SHUTTING DOWN ALL WORKERS');
  logger.info('='.repeat(60));
  
  // Stop OCR pool
  if (ocrPoolProcess && !ocrPoolProcess.killed) {
    logger.info('Stopping OCR worker pool...');
    ocrPoolProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force kill if still running
    if (!ocrPoolProcess.killed) {
      ocrPoolProcess.kill('SIGKILL');
    }
  }
  
  // Stop registre workers
  if (registreProcess && !registreProcess.killed) {
    logger.info('Stopping registre workers...');
    registreProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force kill if still running
    if (!registreProcess.killed) {
      registreProcess.kill('SIGKILL');
    }
  }
  
  logger.info('');
  logger.info('✅ ALL WORKERS STOPPED SUCCESSFULLY');
  logger.info('='.repeat(60));
  
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('🚀 STARTING ALL WORKERS');
    logger.info('='.repeat(60));
    logger.info('');
    
    // Calculate resource requirements
    const resources = calculateResourceRequirements();
    
    logger.info('📊 Resource Requirements:');
    logger.info('');
    logger.info('   Registre Extractor Workers:');
    logger.info(`     - Count: ${WORKER_COUNT}`);
    logger.info(`     - CPU: ${resources.registreCPU.toFixed(1)} vCPUs (${WORKER_COUNT} × 3)`);
    logger.info(`     - RAM: ${resources.registreRAM.toFixed(1)} GB (${WORKER_COUNT} × 1)`);
    logger.info('');
    logger.info('   OCR Worker Pool:');
    logger.info(`     - Pool size: ${OCR_WORKER_POOL_SIZE}`);
    logger.info(`     - CPU: ${resources.ocrCPU.toFixed(1)} vCPUs (${OCR_WORKER_POOL_SIZE} × 1.25 avg)`);
    logger.info(`     - RAM: ${resources.ocrRAM.toFixed(2)} GB (${OCR_WORKER_POOL_SIZE} × 0.625 avg)`);
    logger.info('');
    logger.info('   Total Requirements:');
    logger.info(`     - CPU: ${resources.totalCPU.toFixed(1)} vCPUs`);
    logger.info(`     - RAM: ${resources.totalRAM.toFixed(2)} GB`);
    logger.info('');
    logger.info('   Server Capacity:');
    logger.info(`     - Available CPU: ${resources.availableCPU.toFixed(1)} vCPUs (${SERVER_MAX_CPU} × 80%)`);
    logger.info(`     - Available RAM: ${resources.availableRAM.toFixed(1)} GB (${SERVER_MAX_RAM} × 80%)`);
    logger.info('');
    
    // Check if configuration fits
    if (!resources.fits) {
      logger.error('❌ INSUFFICIENT SERVER CAPACITY');
      logger.error('');
      logger.error('   Your configuration requires:');
      logger.error(`     - ${resources.totalCPU.toFixed(1)} vCPUs (available: ${resources.availableCPU.toFixed(1)})`);
      logger.error(`     - ${resources.totalRAM.toFixed(2)} GB RAM (available: ${resources.availableRAM.toFixed(1)})`);
      logger.error('');
      logger.error('   Solutions:');
      logger.error('     1. Reduce WORKER_COUNT (registre workers)');
      logger.error('     2. Reduce OCR_WORKER_POOL_SIZE (OCR workers)');
      logger.error('     3. Increase SERVER_MAX_CPU and SERVER_MAX_RAM');
      logger.error('');
      process.exit(1);
    }
    
    logger.info('✅ Configuration fits within server capacity');
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('');
    
    // Start registre workers first
    await startRegistreWorkers();
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start OCR pool
    await startOCRPool();
    
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('✅ ALL WORKERS STARTED SUCCESSFULLY');
    logger.info('='.repeat(60));
    logger.info('');
    logger.info('💡 Tips:');
    logger.info('   - Monitor logs for both worker types');
    logger.info('   - Check Redis for capacity status');
    logger.info('   - Press Ctrl+C to gracefully shutdown all workers');
    logger.info('');
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    logger.error({ error }, 'Failed to start workers');
    await shutdown();
    process.exit(1);
  }
}

// Start all workers
main();


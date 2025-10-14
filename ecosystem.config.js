/**
 * PM2 Ecosystem Configuration - UNIFIED WORKER SYSTEM
 *
 * This configuration uses the new unified worker system with:
 * - Capacity-managed registre workers
 * - Dynamic OCR worker pool (replaces old OCR monitor)
 * - Shared Redis coordination
 *
 * IMPORTANT: Requires Redis to be running!
 */

module.exports = {
  apps: [
    // Registre Extractor Workers (downloads PDFs from Quebec registry)
    {
      name: 'registre-workers',
      script: 'dist/worker/start-registre-workers.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',  // 1 worker × 1GB + buffer
      env: {
        NODE_ENV: 'production',
        WORKER_COUNT: '1',              // 1 registre worker
        SERVER_MAX_CPU: '8',
        SERVER_MAX_RAM: '16',
        SERVER_RESERVE_CPU_PERCENT: '20',
        SERVER_RESERVE_RAM_PERCENT: '20'
      }
    },

    // OCR Worker Pool (NEW - replaces old registre-ocr)
    // Dynamically handles both index and acte OCR
    {
      name: 'ocr-pool',
      script: 'dist/ocr/start-worker-pool.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',  // 2 workers × 0.625GB avg + buffer
      env: {
        NODE_ENV: 'production',
        OCR_WORKER_POOL_SIZE: '2',      // 2 OCR workers
        OCR_MIN_INDEX_WORKERS: '1',
        OCR_MIN_ACTE_WORKERS: '1',
        OCR_REBALANCE_INTERVAL_MS: '30000',
        SERVER_MAX_CPU: '8',
        SERVER_MAX_RAM: '16',
        SERVER_RESERVE_CPU_PERCENT: '20',
        SERVER_RESERVE_RAM_PERCENT: '20',
        OCR_PROD: 'false',
        OCR_STAGING: 'false',
        OCR_DEV: 'true'
      }
    },

    // Health Monitor
    {
      name: 'registre-monitor',
      script: 'dist/monitor/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        OCR_PROD: 'false',
        OCR_STAGING: 'false',
        OCR_DEV: 'true'
      }
    },

    // API Server
    {
      name: 'registre-api',
      script: 'dist/api/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3000
      }
    }
  ]
};


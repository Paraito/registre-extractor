/**
 * PM2 Ecosystem Configuration
 *
 * Manages all registre-extractor services:
 * - Document extraction workers (3 instances for concurrency)
 * - OCR processing workers (5 workers)
 * - Health monitoring
 * - API server
 *
 * Usage:
 *   Start all services:        pm2 start ecosystem.config.js
 *   Start specific service:    pm2 start ecosystem.config.js --only registre-worker
 *   Restart all:               pm2 restart ecosystem.config.js
 *   Stop OCR only:             pm2 stop registre-ocr
 *   Scale workers:             pm2 scale registre-worker 5
 *
 * Note:
 *   - OCR workers require GEMINI_API_KEY and OCR_[ENV]=true in .env
 *   - Each registre-worker instance spawns WORKER_COUNT workers (default: 3)
 *   - Total concurrency: instances × WORKER_COUNT × WORKER_CONCURRENCY
 *   - Example: 3 instances × 3 workers × 20 concurrency = 180 potential concurrent jobs
 */

module.exports = {
  apps: [
    // Document Extractor Workers (3 instances for high concurrency)
    {
      name: 'registre-worker',
      script: 'dist/worker/index.js',
      instances: 3,  // Run 3 PM2 instances for concurrency
      exec_mode: 'cluster',  // Enable cluster mode for load balancing
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        WORKER_COUNT: 3  // Each instance spawns 3 workers (total: 9 workers)
      }
    },

    // OCR Workers (processes documents with Gemini File API)
    // Requires: GEMINI_API_KEY and OCR_PROD=true in .env
    {
      name: 'registre-ocr',
      script: 'dist/ocr/start-ocr-workers.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        OCR_WORKER_COUNT: 5
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
        NODE_ENV: 'production'
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

/**
 * PM2 Ecosystem Configuration
 *
 * Manages all registre-extractor services:
 * - Document extraction workers
 * - OCR processing workers
 * - Health monitoring
 * - API server
 *
 * Usage:
 *   Start all services:        pm2 start ecosystem.config.js
 *   Start specific service:    pm2 start ecosystem.config.js --only ocr-worker
 *   Restart all:               pm2 restart ecosystem.config.js
 *   Stop OCR only:             pm2 stop ocr-worker
 *
 * Note: OCR workers require GEMINI_API_KEY and OCR_[ENV]=true in .env
 */

module.exports = {
  apps: [
    // Document Extractor Worker
    {
      name: 'registre-worker',
      script: 'dist/worker/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    },

    // OCR Workers (processes documents with Gemini File API)
    // Requires: GEMINI_API_KEY and OCR_PROD=true in .env
    {
      name: 'ocr-worker',
      script: 'dist/ocr/start-ocr-workers.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        OCR_WORKER_COUNT: 2
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

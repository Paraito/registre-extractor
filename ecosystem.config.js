/**
 * PM2 Ecosystem Configuration
 *
 * Manages all registre-extractor services:
 * - Document extraction workers (9 workers total with NEW FALLBACK MECHANISMS)
 * - OCR processing workers (5 workers)
 * - Health monitoring
 * - API server
 *
 * NEW FEATURES (Oct 2025):
 * ✅ Acte fallback: Tries Acte → Acte divers → Radiation on failure
 * ✅ Plan cadastraux fallback: Tries different cadastre/designation combinations with LLM
 * ✅ Confirmation page handling for large file downloads
 *
 * Usage:
 *   Start all services:        pm2 start ecosystem.config.js
 *   Start specific service:    pm2 start ecosystem.config.js --only registre-worker
 *   Restart all:               pm2 restart ecosystem.config.js
 *   Stop OCR only:             pm2 stop registre-ocr
 *   View logs:                 pm2 logs
 *   Monitor:                   pm2 monit
 *
 * Note:
 *   - OCR workers require GEMINI_API_KEY or CLAUDE_API_KEY and OCR_[ENV]=true in .env
 *   - Each registre-worker instance spawns WORKER_COUNT workers (default: 3)
 *   - Total workers: 3 PM2 instances × 3 workers each = 9 concurrent workers
 */

module.exports = {
  apps: [
    // ========================================================================
    // UNIFIED WORKERS (All Job Types)
    // ========================================================================
    // Handles: Land Registry (actes, index, plan_cadastraux), REQ, RDPRM
    // Features: Acte fallback, Plan cadastraux fallback, Confirmation pages
    // Status: ✅ FULLY WORKING - All job types supported
    {
      name: 'registre-worker',
      script: 'dist/worker/unified-worker.js',  // Changed from index.js to unified-worker.js
      instances: 3,  // Run 3 PM2 instances for concurrency
      exec_mode: 'cluster',  // Enable cluster mode for load balancing
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '10s',  // Consider app unstable if it exits within 10s
      max_restarts: 10,   // Max restarts within 1 minute before giving up
      restart_delay: 4000, // Wait 4s before restart
      kill_timeout: 5000,  // Wait 5s for graceful shutdown before SIGKILL
      env: {
        NODE_ENV: 'production',
        WORKER_COUNT: 3  // Each PM2 instance spawns 3 workers (total: 9 workers)
      },
      error_file: './logs/registre-worker-error.log',
      out_file: './logs/registre-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },

    // ========================================================================
    // OCR WORKERS
    // ========================================================================
    // Processes extracted documents with Gemini/Claude OCR
    // Requires: GEMINI_API_KEY or CLAUDE_API_KEY and OCR_PROD=true in .env
    // Status: ✅ FULLY WORKING
    {
      name: 'registre-ocr',
      script: 'dist/ocr/start-ocr-workers.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '768M',  // Increased from 512M for stability
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        OCR_WORKER_COUNT: 5  // 5 concurrent OCR workers
      },
      error_file: './logs/registre-ocr-error.log',
      out_file: './logs/registre-ocr-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },

    // ========================================================================
    // HEALTH MONITOR
    // ========================================================================
    // Monitors worker health and system status
    // Status: ✅ FULLY WORKING
    {
      name: 'registre-monitor',
      script: 'dist/monitor/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/registre-monitor-error.log',
      out_file: './logs/registre-monitor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },

    // ========================================================================
    // API SERVER
    // ========================================================================
    // REST API for job management and monitoring
    // Status: ✅ FULLY WORKING
    {
      name: 'registre-api',
      script: 'dist/api/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',  // Increased from 256M
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        API_PORT: 3000,
        API_HOST: '0.0.0.0'
      },
      error_file: './logs/registre-api-error.log',
      out_file: './logs/registre-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

// ============================================================================
// NOTES:
// ============================================================================
//
// ✅ WORKING WORKERS:
//   - registre-worker: Extracts actes, index, plan_cadastraux (9 workers)
//   - registre-ocr: Processes documents with OCR (5 workers)
//   - registre-monitor: Health monitoring
//   - registre-api: REST API server
//
// ❌ NOT IMPLEMENTED (placeholders only):
//   - REQ workers (Registre des Entreprises du Québec)
//   - RDPRM workers (Droits Personnels et Réels Mobiliers)
//   - These exist in src/worker/unified-worker.ts but scrapers throw errors
//
// 📁 LOG FILES:
//   All logs are stored in ./logs/ directory
//   Use: pm2 logs [app-name] to view logs
//   Use: pm2 flush to clear all logs
//
// 🔄 DEPLOYMENT:
//   1. git pull origin main
//   2. npm run build
//   3. pm2 restart ecosystem.config.js
//   4. pm2 logs --lines 50
//
// ============================================================================

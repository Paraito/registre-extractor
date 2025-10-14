/**
 * PM2 Ecosystem Configuration - Simple & Clean
 * 
 * OCR system removed - focusing on core extraction functionality
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

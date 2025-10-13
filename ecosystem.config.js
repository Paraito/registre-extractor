module.exports = {
  apps: [
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
    {
      name: 'registre-ocr',
      script: 'dist/ocr/monitor.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        OCR_PROD: 'false',
        OCR_STAGING: 'false',
        OCR_DEV: 'true',
        OCR_WORKER_COUNT: '5'
      }
    },
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


#!/usr/bin/env node
/**
 * Worker CLI
 * 
 * Start an Index OCR worker that continuously processes documents.
 */

import { IndexOCRWorker } from './index-ocr-worker.js';
import { validateConfig } from '../../config/runtime.js';

// Parse command line arguments
const args = process.argv.slice(2);

function getOption(name: string, defaultValue?: string): string | undefined {
  const index = args.findIndex(arg => arg === `--${name}`);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Index OCR Worker - Continuous document processing

Usage:
  npm run worker [options]

Options:
  --worker-id <id>    Custom worker ID (default: auto-generated)
  --redis-url <url>   Redis URL (default: redis://localhost:6379)
  --help, -h          Show this help message

Environment Variables Required:
  GEMINI_API_KEY                Gemini API key
  
  DEV_SUPABASE_URL              Dev Supabase URL
  DEV_SUPABASE_SERVICE_KEY      Dev Supabase service key
  
  STAGING_SUPABASE_URL          Staging Supabase URL (optional)
  STAGING_SUPABASE_SERVICE_KEY  Staging Supabase service key (optional)
  
  PROD_SUPABASE_URL             Prod Supabase URL (optional)
  PROD_SUPABASE_SERVICE_KEY     Prod Supabase service key (optional)
  
  REDIS_URL                     Redis URL (optional, default: redis://localhost:6379)

Examples:
  npm run worker
  npm run worker -- --worker-id my-worker-1
  npm run worker -- --redis-url redis://my-redis:6379

Notes:
  - Worker will poll all configured environments (dev, staging, prod)
  - Priority order: prod > staging > dev
  - Worker uses shared rate limiting via Redis
  - Press Ctrl+C to stop gracefully
`);
  process.exit(0);
}

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const workerId = getOption('worker-id');
    const redisUrl = getOption('redis-url');
    
    console.log('\n' + '='.repeat(80));
    console.log('🤖 INDEX OCR WORKER');
    console.log('='.repeat(80) + '\n');
    
    if (workerId) {
      console.log(`Worker ID: ${workerId}`);
    }
    if (redisUrl) {
      console.log(`Redis URL: ${redisUrl}`);
    }
    console.log('');
    
    // Create and initialize worker
    const worker = new IndexOCRWorker(workerId, redisUrl);
    await worker.initialize();
    
    // Handle graceful shutdown
    let isShuttingDown = false;
    
    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log('\n⚠️  Force shutdown...');
        process.exit(1);
      }
      
      isShuttingDown = true;
      console.log(`\n\n📡 Received ${signal}, shutting down gracefully...`);
      
      try {
        await worker.stop();
        console.log('✅ Worker stopped successfully\n');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Start processing
    console.log('🚀 Worker started - polling for jobs...\n');
    console.log('Press Ctrl+C to stop gracefully\n');
    console.log('='.repeat(80) + '\n');
    
    await worker.start();
    
  } catch (error) {
    console.error('\n❌ Worker failed to start:', error);
    console.error('\nStack trace:', (error as Error).stack);
    process.exit(1);
  }
}

main();


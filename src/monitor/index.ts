#!/usr/bin/env node
import { healthMonitor } from './health-monitor';
import { logger } from '../utils/logger';
import { config } from '../config';

/**
 * Standalone Health Monitor Service
 * 
 * This service runs independently from workers and provides:
 * - Automatic stuck job recovery
 * - Dead worker cleanup
 * - System health monitoring
 * - Anomaly detection and alerting
 * 
 * Run with: npm run monitor
 * Or in production: node dist/monitor/index.js
 */

async function main() {
  logger.info({
    nodeEnv: config.env,
    checkInterval: '30 seconds',
    staleJobThreshold: '3 minutes',
    deadWorkerThreshold: '2 minutes'
  }, '🏥 Starting Health Monitor Service');

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    healthMonitor.stop();
    logger.info('Health monitor stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception in health monitor');
    // Don't exit - keep monitoring
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection in health monitor');
    // Don't exit - keep monitoring
  });

  // Start the monitor
  healthMonitor.start();

  logger.info('✅ Health Monitor Service is running');
  logger.info('   - Auto-resetting stuck jobs every 30 seconds');
  logger.info('   - Cleaning up dead workers every 30 seconds');
  logger.info('   - Monitoring system health continuously');
  logger.info('   - Press Ctrl+C to stop');
}

// Run the service
main().catch((error) => {
  logger.error({ error }, 'Failed to start health monitor');
  process.exit(1);
});


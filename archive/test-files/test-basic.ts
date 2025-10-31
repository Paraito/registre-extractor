import { config } from './config';
import { logger } from './utils/logger';

async function testBasicSetup() {
  logger.info('Testing basic setup...');
  
  // Test configuration
  logger.info({ 
    env: config.env,
    apiPort: config.api.port,
    redisHost: config.redis.host,
    workerConcurrency: config.worker.concurrency 
  }, 'Configuration loaded');
  
  // Test Supabase connection
  try {
    const { supabase } = await import('./utils/supabase');
    const { error } = await supabase
      .from('worker_accounts')
      .select('count')
      .limit(1);
    
    if (error) {
      logger.error({ error }, 'Supabase connection failed');
    } else {
      logger.info('Supabase connection successful');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to import Supabase');
  }
  
  logger.info('Basic setup test complete');
}

testBasicSetup().catch(console.error);
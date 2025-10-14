/**
 * Check what storage buckets exist in Supabase
 */

import { supabaseManager } from './src/utils/supabase';
import { logger } from './src/utils/logger';

async function checkBuckets() {
  const environments = supabaseManager.getAvailableEnvironments();
  
  for (const env of environments) {
    logger.info({ environment: env }, 'Checking buckets for environment');
    
    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      logger.warn({ environment: env }, 'No client available');
      continue;
    }

    const { data: buckets, error } = await client.storage.listBuckets();

    if (error) {
      logger.error({ environment: env, error }, 'Failed to list buckets');
      continue;
    }

    logger.info({ 
      environment: env, 
      buckets: buckets?.map(b => ({ id: b.id, name: b.name, public: b.public }))
    }, 'Available buckets');

    // Also check for a specific document
    const { data: docs, error: docError } = await client
      .from('extraction_queue')
      .select('id, document_number, document_source, supabase_path')
      .eq('document_source', 'index')
      .not('supabase_path', 'is', null)
      .limit(3);

    if (!docError && docs) {
      logger.info({
        environment: env,
        sampleDocs: docs
      }, 'Sample index documents');
    }
  }
}

checkBuckets().catch(console.error);


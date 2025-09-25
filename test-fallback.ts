#!/usr/bin/env ts-node

import { AIRegistreExtractor } from './src/worker/extractor-ai';
import { WorkerAccount, ExtractionConfig } from './src/types';
import { logger } from './src/utils/logger';
import { config } from './src/config';

async function testFallback() {
  logger.info('Starting fallback test');

  // Test account
  const account: WorkerAccount = {
    id: 'test-account',
    username: process.env.TEST_USERNAME || '',
    password: process.env.TEST_PASSWORD || '',
    is_active: true,
    failure_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (!account.username || !account.password) {
    logger.error('Please set TEST_USERNAME and TEST_PASSWORD environment variables');
    process.exit(1);
  }

  const extractor = new AIRegistreExtractor(
    account,
    'test-worker',
    false // headless = false for debugging
  );

  try {
    await extractor.initialize();
    await extractor.login();

    // Test case: Document with cadastre that should be in designation
    // This should trigger the fallback logic
    const testConfig: ExtractionConfig = {
      document_type: 'index',
      circumscription: 'Terrebonne',
      cadastre: 'Cadastre du Québec',
      lot_number: '24A',
      designation_secondaire: 'Rang 5 Canton Abercrombie Paroisse de Saint-Hippolyte'
    };

    logger.info({ testConfig }, 'Testing fallback with config');

    // Navigate to search page
    await extractor.navigateToSearch('index');

    // Try extraction - this should trigger fallback
    const result = await extractor.extractDocument(testConfig);

    logger.info({ result }, 'Test completed successfully');

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    }, 'Test failed');

    // Log the full error message if it contains attempt details
    if (error instanceof Error && error.message.includes('Attempted alternatives')) {
      console.log('\n=== DETAILED ERROR ===');
      console.log(error.message);
      console.log('===================\n');
    }

  } finally {
    await extractor.close();
  }
}

// Run the test
testFallback().catch(error => {
  logger.error({ error }, 'Unhandled error');
  process.exit(1);
});
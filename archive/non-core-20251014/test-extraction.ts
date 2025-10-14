import { SimpleRegistreExtractor } from './worker/extractor-simple';
import { WorkerAccount, ExtractionConfig } from './types';
import { logger } from './utils/logger';

async function testExtraction() {
  const testAccount: WorkerAccount = {
    id: 'test-account',
    username: '30F3315',
    password: 'Sainte-Clara1504!',
    is_active: true,
    failure_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const testConfig: ExtractionConfig = {
    document_type: 'index',
    circumscription: 'Montréal',
    cadastre: 'Cadastre du Québec',
    lot_number: '2 784 195',
  };

  const extractor = new SimpleRegistreExtractor(testAccount, 'test-worker', false);

  try {
    logger.info('Starting test extraction...');
    
    await extractor.initialize();
    logger.info('Extractor initialized');
    
    await extractor.login();
    logger.info('Login successful');
    
    await extractor.navigateToSearch();
    logger.info('Navigated to search page');
    
    const filePath = await extractor.extractDocument(testConfig);
    logger.info({ filePath }, 'Document extracted successfully!');
    
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    }, 'Test extraction failed');
  } finally {
    await extractor.close();
  }
}

// Run the test
testExtraction().catch(console.error);
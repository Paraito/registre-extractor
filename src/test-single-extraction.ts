import { logger } from './utils/logger';

async function testSingleExtraction() {
  try {
    // Create a test job with a known good document number from the completed list
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'index',
        document_number: '2626043',
        circonscription_fonciere: 'Montréal',
        cadastre: 'Cadastre du Québec',
      }),
    });
    const result = await response.json();
    logger.info({ result }, 'Test index job created - this document was previously extracted successfully');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create test job');
  }
}

testSingleExtraction();
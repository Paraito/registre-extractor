import { logger } from './utils/logger';

async function createTestJobActe() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'acte',
        document_number: '25616321',
        circonscription_fonciere: 'Montréal',
        acte_type: 'Acte', // Required for acte documents
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Acte job created in extraction_queue');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create acte job');
  }
}

createTestJobActe();
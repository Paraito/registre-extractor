import { logger } from './utils/logger';

async function createTestJobActeGaspe() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'acte',
        document_number: '53850',
        circonscription_fonciere: 'Gaspé',
        acte_type: 'Acte', // This should fail and fallback to other types
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Gaspé acte job created in extraction_queue');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create Gaspé acte job');
  }
}

createTestJobActeGaspe();


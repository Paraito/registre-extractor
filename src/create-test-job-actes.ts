import { logger } from './utils/logger';

async function createTestJobActes() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_type: 'actes',
        circumscription: 'Montréal',
        type_document: 'Acte',
        numero_inscription: '12345678', // Example registration number
        priority: 'high'
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Actes job created');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create actes job');
  }
}

createTestJobActes();
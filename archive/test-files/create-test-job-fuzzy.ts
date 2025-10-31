import { logger } from './utils/logger';

async function createTestJob() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lot_number: '2784195',
        circumscription: 'Montreal', // Testing without accent
        cadastre: 'Cadastre du Quebec', // Testing without accent
        designation_secondaire: '', // Testing empty field
        priority: 'high'
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Job created with fuzzy matching test');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create job');
  }
}

createTestJob();
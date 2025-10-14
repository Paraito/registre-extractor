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
        circumscription: 'Montréal',
        cadastre: 'Cadastre du Québec',
        designation_secondaire: '', // Leave empty to test skipping
        priority: 'high'
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Job created');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create job');
  }
}

createTestJob();
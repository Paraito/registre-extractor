import { logger } from './utils/logger';

async function createTestJobPlans() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_type: 'plans_cadastraux',
        circumscription: 'Montréal',
        cadastre: 'Cadastre du Québec',
        lot_number: '2784195',
        designation_secondaire: '', // Optional
        priority: 'high'
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Plans cadastraux job created');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create plans cadastraux job');
  }
}

createTestJobPlans();
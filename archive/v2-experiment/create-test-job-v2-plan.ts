import { logger } from './utils/logger';

async function createTestJobPlan() {
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'plan_cadastraux',
        document_number: '2784195',
        circonscription_fonciere: 'Montréal',
        cadastre: 'Cadastre du Québec',
        designation_secondaire: '', // Optional
      }),
    });

    const result = await response.json();
    logger.info({ result }, 'Plan cadastraux job created in extraction_queue');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create plan cadastraux job');
  }
}

createTestJobPlan();
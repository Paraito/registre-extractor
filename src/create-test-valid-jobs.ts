import { logger } from './utils/logger';

async function createValidTestJobs() {
  try {
    // Create valid index job
    const indexResponse = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'index',
        document_number: '1425100',
        circonscription_fonciere: 'Montréal',
        cadastre: 'Cadastre du Québec',
      }),
    });
    const indexResult = await indexResponse.json();
    logger.info({ result: indexResult }, 'Valid index job created');

    // Create valid acte job
    const acteResponse = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'acte',
        document_number: '25000000',
        circonscription_fonciere: 'Montréal',
        acte_type: 'Acte',
      }),
    });
    const acteResult = await acteResponse.json();
    logger.info({ result: acteResult }, 'Valid acte job created');

    // Create valid plan cadastraux job
    const planResponse = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'plan_cadastraux',
        document_number: '1234567',
        circonscription_fonciere: 'Montréal',
        cadastre: 'Cadastre du Québec',
      }),
    });
    const planResult = await planResponse.json();
    logger.info({ result: planResult }, 'Valid plan cadastraux job created');
    
  } catch (error) {
    logger.error({ error }, 'Failed to create test jobs');
  }
}

createValidTestJobs();
import { logger } from './utils/logger';

/**
 * Test script for plan_cadastraux fallback mechanism
 *
 * This creates a job with a lot number that might not exist
 * to trigger validation errors and test the fallback handler.
 *
 * Test case:
 * - Circonscription: Montréal
 * - Lot number: 9999999 (likely doesn't exist)
 * - Cadastre: Cadastre du Québec
 * - Designation secondaire: Empty
 *
 * The fallback should try different cadastre and designation combinations
 * when the initial attempt fails with a validation error.
 */
async function createTestJobPlanCadastrauxFallback() {
  try {
    logger.info('Creating plan_cadastraux test job to trigger fallback...');

    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'plan_cadastraux',
        document_number: '1234567', // Use a lot number that might exist
        circonscription_fonciere: 'Montréal',
        cadastre: 'WRONG_CADASTRE', // Intentionally wrong to trigger fallback
        designation_secondaire: '',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: any = await response.json();
    logger.info({
      jobId: result.id,
      documentNumber: result.document_number,
      status: result.status_id
    }, '✅ Plan cadastraux fallback test job created');
    
    logger.info('');
    logger.info('='.repeat(80));
    logger.info('📋 NEXT STEPS:');
    logger.info('='.repeat(80));
    logger.info('1. Start the worker: npm run start');
    logger.info('2. Watch the logs for fallback attempts');
    logger.info('3. The fallback should try different cadastre options using LLM');
    logger.info('4. Check the job status: curl http://localhost:3000/api/extractions/' + result.id);
    logger.info('='.repeat(80));
    
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, '❌ Failed to create plan cadastraux fallback test job');
    process.exit(1);
  }
}

createTestJobPlanCadastrauxFallback();


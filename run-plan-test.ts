import { logger } from './src/utils/logger';

async function createAndRunPlanTest() {
  console.log('🧪 Creating test job for plan_cadastraux extraction...');
  console.log('📋 Parameters:');
  console.log('   - Lot Number: 2');
  console.log('   - Cadastre: Mirabel');
  console.log('   - Circonscription: Deux-Montagnes');
  console.log('');
  
  try {
    const response = await fetch('http://localhost:3000/api/extractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        document_source: 'plan_cadastraux',
        document_number: '2',
        circonscription_fonciere: 'Deux-Montagnes',
        cadastre: 'Mirabel',
        designation_secondaire: '',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Test job created successfully!');
    console.log('📄 Job ID:', result.extraction_id);
    console.log('⏱️  Status:', result.status);
    console.log('');
    console.log('🔄 Now run the worker to process this job:');
    console.log('   npm run dev:v2');
    console.log('');
    console.log('📊 Monitor progress at: http://localhost:3000');
    
    return result;
    
  } catch (error) {
    console.error('❌ Failed to create test job:');
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    }
    
    console.log('');
    console.log('💡 Make sure:');
    console.log('   1. API server is running (npm run api:dev:v2)');
    console.log('   2. Your .env file is properly configured');
    console.log('   3. Supabase connection is working');
    
    throw error;
  }
}

// Run the test
createAndRunPlanTest().catch(() => process.exit(1));
async function createTestJobPlanLive() {
  console.log('🧪 Creating test job for plan_cadastraux extraction with your parameters...');
  
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
        designation_secondaire: '', // Optional
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Plan cadastraux job created successfully:');
    console.log('📄 Job ID:', result.extraction_id);
    console.log('🏠 Lot Number:', result.document_number);
    console.log('📍 Circonscription:', 'Deux-Montagnes');
    console.log('🗺️  Cadastre:', 'Mirabel');
    console.log('⏱️  Status:', result.status);
    
    return result;
    
  } catch (error) {
    console.error('❌ Failed to create plan cadastraux job:', error);
    throw error;
  }
}

// Run the test
createTestJobPlanLive().catch(console.error);
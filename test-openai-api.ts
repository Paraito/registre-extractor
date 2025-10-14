/**
 * Quick test to verify OpenAI API is working
 */

import * as dotenv from 'dotenv';
dotenv.config();

async function testOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not found in environment');
    process.exit(1);
  }

  console.log('✅ OPENAI_API_KEY found');
  console.log(`   Key starts with: ${apiKey.substring(0, 10)}...`);

  try {
    console.log('\n🔄 Testing OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: 'Say "Hello, API is working!" in JSON format with a "message" field.'
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    console.log(`   Response status: ${response.status} ${response.statusText}`);

    const data = await response.json();

    if (!response.ok) {
      console.error('\n❌ OpenAI API Error:');
      console.error('   Status:', response.status);
      console.error('   Error:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    if (!data.choices || !data.choices[0]) {
      console.error('\n❌ Unexpected response structure:');
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    const result = JSON.parse(data.choices[0].message.content);
    console.log('\n✅ OpenAI API is working!');
    console.log('   Response:', result);
    console.log('   Model used:', data.model);
    console.log('   Tokens used:', data.usage?.total_tokens || 'unknown');

  } catch (error) {
    console.error('\n❌ Error testing OpenAI API:');
    console.error('   ', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\n   Stack trace:');
      console.error('   ', error.stack);
    }
    process.exit(1);
  }
}

testOpenAI();


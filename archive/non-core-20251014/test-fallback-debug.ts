/**
 * Debug test for fallback handler
 */

import * as dotenv from 'dotenv';
dotenv.config();

interface SelectOption {
  value: string;
  text: string;
}

async function testLLMSelection() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not found');
    return;
  }

  console.log('✅ Testing LLM selection logic...\n');

  // Simulate cadastre options
  const options: SelectOption[] = [
    { value: '1', text: 'Paroisse de Saint-Laurent' },
    { value: '2', text: 'Canton de Granby' },
    { value: '3', text: 'Ville de Montréal' },
    { value: '4', text: 'Paroisse de Sainte-Anne' }
  ];

  const contextString = '12345, Montréal, Paroisse de Saint-Laurent, ';
  const excludeOptions: string[] = [];

  const optionsList = options
    .filter(opt => !excludeOptions.includes(opt.text))
    .map((opt, idx) => `${idx}: "${opt.text}"`)
    .join('\n');

  const prompt = `Context: "${contextString}"
Format: [document_number, circonscription, cadastre, designation_secondaire]

Available options:
${optionsList}

Find the BEST matching cadastre option. Look for patterns like:
- Parish names (Paroisse de X)
- Canton names (Canton de X)
- Village/City names
- Match anywhere in the context string

Return JSON: {"index": <number>, "reasoning": "<why>", "matched_text": "<from context>"}`;

  console.log('📝 Prompt:');
  console.log(prompt);
  console.log('\n🔄 Calling OpenAI API...\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    console.log(`Response status: ${response.status} ${response.statusText}`);

    const data = await response.json();

    if (!response.ok) {
      console.error('\n❌ API Error:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    if (!data.choices || !data.choices[0]) {
      console.error('\n❌ Unexpected response structure:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    const result = JSON.parse(data.choices[0].message.content);
    console.log('\n✅ LLM Response:');
    console.log(JSON.stringify(result, null, 2));

    if (result.index !== null && result.index >= 0 && result.index < options.length) {
      const selected = options[result.index];
      console.log('\n✅ Selected option:');
      console.log(`   Text: ${selected.text}`);
      console.log(`   Value: ${selected.value}`);
      console.log(`   Reasoning: ${result.reasoning}`);
    } else {
      console.log('\n⚠️  No valid index returned');
    }

  } catch (error) {
    console.error('\n❌ Error:');
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack:');
      console.error(error.stack);
    }
  }
}

testLLMSelection();


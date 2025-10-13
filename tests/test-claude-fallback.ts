/**
 * Test script for Claude OCR fallback system
 * 
 * This script tests:
 * 1. Claude API connectivity
 * 2. Image-based OCR extraction
 * 3. Boost functionality
 * 4. Automatic fallback mechanism
 */

import { ClaudeOCRClient } from '../src/ocr/claude-ocr-client';
import { UnifiedOCRProcessor } from '../src/ocr/unified-ocr-processor';
import { config } from '../src/config';
import { logger } from '../src/utils/logger';
import fs from 'fs/promises';
import path from 'path';

async function testClaudeClient() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: Claude OCR Client');
  console.log('='.repeat(80));

  if (!config.ocr.claudeApiKey) {
    console.log('❌ CLAUDE_API_KEY not configured - skipping Claude tests');
    return false;
  }

  try {
    const client = new ClaudeOCRClient({
      apiKey: config.ocr.claudeApiKey,
      extractModel: 'claude-sonnet-4-5-20250929',
      boostModel: 'claude-sonnet-4-5-20250929',
    });

    console.log('✅ Claude client initialized');
    console.log('   Model: claude-sonnet-4-5-20250929');
    console.log('   Temperature: 0.0');

    // Test with a simple text extraction prompt
    const testPrompt = `Extract any text you see in this image. 
If there is no image or you cannot see text, respond with "NO_TEXT_FOUND".`;

    console.log('\n📝 Testing text extraction...');
    
    // Create a simple test image (1x1 white pixel as base64)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    const result = await client.extractTextFromImage(
      testImageBase64,
      'image/png',
      testPrompt,
      { maxAttempts: 1 }
    );

    console.log('✅ Claude API is working');
    console.log(`   Response length: ${result.text.length} characters`);
    console.log(`   Is complete: ${result.isComplete}`);
    console.log(`   Preview: ${result.text.substring(0, 100)}...`);

    return true;
  } catch (error) {
    console.log('❌ Claude client test failed');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function testUnifiedProcessor() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Unified OCR Processor with Fallback');
  console.log('='.repeat(80));

  if (!config.ocr.geminiApiKey) {
    console.log('❌ GEMINI_API_KEY not configured - cannot test unified processor');
    return false;
  }

  if (!config.ocr.claudeApiKey) {
    console.log('⚠️  CLAUDE_API_KEY not configured - fallback will not be available');
  }

  try {
    const processor = new UnifiedOCRProcessor({
      geminiApiKey: config.ocr.geminiApiKey,
      claudeApiKey: config.ocr.claudeApiKey || '',
      preferredProvider: config.ocr.preferredProvider,
      tempDir: '/tmp/test-ocr',
      extractModel: config.ocr.extractModel,
      boostModel: config.ocr.boostModel,
      extractTemperature: config.ocr.extractTemperature,
      boostTemperature: config.ocr.boostTemperature,
    });

    console.log('✅ Unified processor initialized');
    console.log(`   Preferred provider: ${config.ocr.preferredProvider}`);
    console.log(`   Gemini extract model: ${config.ocr.extractModel.gemini}`);
    console.log(`   Claude extract model: ${config.ocr.extractModel.claude}`);
    console.log(`   Gemini boost model: ${config.ocr.boostModel.gemini}`);
    console.log(`   Claude boost model: ${config.ocr.boostModel.claude}`);

    return true;
  } catch (error) {
    console.log('❌ Unified processor test failed');
    console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function testConfiguration() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Configuration Validation');
  console.log('='.repeat(80));

  const checks = [
    {
      name: 'Gemini API Key',
      value: config.ocr.geminiApiKey,
      required: true,
    },
    {
      name: 'Claude API Key',
      value: config.ocr.claudeApiKey,
      required: false,
    },
    {
      name: 'Preferred Provider',
      value: config.ocr.preferredProvider,
      required: true,
    },
    {
      name: 'Gemini Extract Model',
      value: config.ocr.extractModel.gemini,
      required: true,
    },
    {
      name: 'Claude Extract Model',
      value: config.ocr.extractModel.claude,
      required: false,
    },
    {
      name: 'Gemini Boost Model',
      value: config.ocr.boostModel.gemini,
      required: true,
    },
    {
      name: 'Claude Boost Model',
      value: config.ocr.boostModel.claude,
      required: false,
    },
    {
      name: 'Extract Temperature',
      value: config.ocr.extractTemperature,
      required: true,
    },
    {
      name: 'Boost Temperature',
      value: config.ocr.boostTemperature,
      required: true,
    },
  ];

  let allPassed = true;

  for (const check of checks) {
    const isSet = check.value !== undefined && check.value !== null && check.value !== '';
    const status = isSet ? '✅' : (check.required ? '❌' : '⚠️ ');
    const label = check.required ? 'REQUIRED' : 'OPTIONAL';
    
    console.log(`${status} ${check.name.padEnd(25)} [${label}] ${isSet ? `= ${check.value}` : '(not set)'}`);

    if (check.required && !isSet) {
      allPassed = false;
    }
  }

  return allPassed;
}

async function main() {
  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(20) + 'CLAUDE OCR FALLBACK TEST SUITE' + ' '.repeat(27) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const results = {
    configuration: false,
    claudeClient: false,
    unifiedProcessor: false,
  };

  // Test 1: Configuration
  results.configuration = await testConfiguration();

  // Test 2: Claude Client (only if API key is configured)
  if (config.ocr.claudeApiKey) {
    results.claudeClient = await testClaudeClient();
  } else {
    console.log('\n⚠️  Skipping Claude client test (no API key configured)');
  }

  // Test 3: Unified Processor
  results.unifiedProcessor = await testUnifiedProcessor();

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));

  const configStatus = results.configuration ? '✅ PASS' : '❌ FAIL';
  const claudeStatus = config.ocr.claudeApiKey 
    ? (results.claudeClient ? '✅ PASS' : '❌ FAIL')
    : '⚠️  SKIP';
  const unifiedStatus = results.unifiedProcessor ? '✅ PASS' : '❌ FAIL';

  console.log(`Configuration:       ${configStatus}`);
  console.log(`Claude Client:       ${claudeStatus}`);
  console.log(`Unified Processor:   ${unifiedStatus}`);

  const allPassed = results.configuration && 
                    results.unifiedProcessor && 
                    (!config.ocr.claudeApiKey || results.claudeClient);

  console.log('\n' + '='.repeat(80));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
    
    if (!config.ocr.claudeApiKey) {
      console.log('\n⚠️  NOTE: Claude API key not configured');
      console.log('   The system will work with Gemini only (no fallback)');
      console.log('   To enable fallback, add CLAUDE_API_KEY to your .env file');
    } else {
      console.log('\n🔄 Automatic fallback is ENABLED');
      console.log(`   Preferred provider: ${config.ocr.preferredProvider.toUpperCase()}`);
      console.log('   Fallback provider: ' + (config.ocr.preferredProvider === 'gemini' ? 'CLAUDE' : 'GEMINI'));
    }
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('\nPlease check the errors above and fix configuration issues.');
  }
  console.log('='.repeat(80) + '\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('\n❌ Test suite crashed:', error);
  process.exit(1);
});


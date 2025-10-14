#!/usr/bin/env tsx
/**
 * Simple Qwen3 Test - Verify OpenRouter Connection
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { Qwen3Client } from '../src/clients/qwen3.js';

async function main() {
  try {
    validateConfig();
    
    const logger = createLogger('qwen3-test');
    await logger.init();
    
    await logger.info('qwen3_test', 'Testing Qwen3 connection via OpenRouter', {
      apiUrl: CONFIG.qwenApiUrl,
      modelName: CONFIG.qwenModelName
    });
    
    const qwen3Client = new Qwen3Client(logger);
    
    // Simple text-only test first
    const testMessages = [
      {
        role: 'user',
        content: 'Hello! Can you count to 5 for me?'
      }
    ];
    
    await logger.info('qwen3_test', 'Sending simple text test...');
    
    const response = await qwen3Client.generateContent(testMessages, {
      temperature: 0.1,
      maxTokens: 100
    });
    
    const responseText = response.response.text();
    
    await logger.success('qwen3_test', 'Qwen3 response received!', {
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200)
    });
    
    console.log('\n🎉 Qwen3 connection test successful!');
    console.log('📝 Response:', responseText);
    console.log('🔗 API URL:', CONFIG.qwenApiUrl);
    console.log('🤖 Model:', CONFIG.qwenModelName);
    
  } catch (error) {
    console.error('❌ Qwen3 test failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

main();

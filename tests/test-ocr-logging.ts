/**
 * Test script to verify OCR structured logging
 * 
 * This script tests the new structured logging format for:
 * 1. Stale OCR Monitor startup
 * 2. PDF Converter initialization
 */

import { OCRLogger } from '../src/ocr/ocr-logger';
import { PDFConverter } from '../src/ocr/pdf-converter';

async function testLogging() {
  console.log('\n🧪 Testing OCR Structured Logging\n');

  // Test 1: Simulate OCR Monitor startup
  console.log('Test 1: OCR Monitor Startup Logging');
  console.log('─'.repeat(80));
  
  const enabledEnvs = ['dev', 'staging'];
  OCRLogger.monitorStarted(enabledEnvs);

  // Test 2: Simulate Stale OCR Monitor startup
  console.log('\nTest 2: Stale OCR Monitor Startup Logging');
  console.log('─'.repeat(80));
  
  OCRLogger.incrementMessageCounter();
  const messageNum = OCRLogger.getMessageCounter();
  const SEPARATOR = '='.repeat(80);
  
  console.log('\n' + SEPARATOR);
  console.log(`🔍 Stale OCR Monitor Started - Message #${messageNum}`);
  console.log(SEPARATOR);
  console.log('\n⚙️  Configuration');
  console.log(`   Enabled Environments: ${enabledEnvs.join(', ')}`);
  console.log(`   Check Interval: 60s`);
  console.log(`   Stale Threshold: 10 minutes`);
  console.log('\n' + SEPARATOR + '\n');

  // Test 3: PDF Converter initialization
  console.log('Test 3: PDF Converter Initialization Logging');
  console.log('─'.repeat(80));
  
  const pdfConverter = new PDFConverter('/tmp/ocr-test');
  await pdfConverter.initialize();

  console.log('\n✅ All logging tests completed successfully!\n');
}

// Run tests
testLogging().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});


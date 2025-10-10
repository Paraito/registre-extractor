/**
 * Integration test for OCR processing flow
 * Tests the CORRECT flow: Extract all → Concatenate → Boost once
 */

import { OCRProcessor } from './src/ocr/processor';
import { logger } from './src/utils/logger';

// Mock Gemini client to track calls
class MockGeminiClient {
  extractTextCalls: any[] = [];
  boostTextCalls: any[] = [];

  async extractText(imageData: string, mimeType: string, prompt: string, options?: any) {
    this.extractTextCalls.push({ imageData, mimeType, prompt, options });
    
    // Simulate different text for each page
    const pageNum = this.extractTextCalls.length;
    return {
      text: `Raw text from page ${pageNum}`,
      isComplete: true
    };
  }

  async boostText(rawText: string, prompt: string, options?: any) {
    this.boostTextCalls.push({ rawText, prompt, options });
    
    return {
      boostedText: `BOOSTED: ${rawText}`,
      isComplete: true
    };
  }

  reset() {
    this.extractTextCalls = [];
    this.boostTextCalls = [];
  }
}

// Mock PDF converter
class MockPDFConverter {
  async initialize() {}

  async convertAllPagesToImages(pdfPath: string, options?: any) {
    // Simulate 3-page PDF
    return {
      totalPages: 3,
      pages: [
        { imagePath: '/tmp/page1.png', mimeType: 'image/png', base64Data: 'base64-page1' },
        { imagePath: '/tmp/page2.png', mimeType: 'image/png', base64Data: 'base64-page2' },
        { imagePath: '/tmp/page3.png', mimeType: 'image/png', base64Data: 'base64-page3' }
      ]
    };
  }

  async cleanupAll() {}
}

async function testOCRFlow() {
  console.log('\n=== Testing OCR Processing Flow ===\n');

  // Create processor with mocked dependencies
  const processor = new OCRProcessor({
    geminiApiKey: 'test-key',
    tempDir: '/tmp/test-ocr'
  });

  const mockGemini = new MockGeminiClient();
  const mockConverter = new MockPDFConverter();

  // Inject mocks
  (processor as any).geminiClient = mockGemini;
  (processor as any).pdfConverter = mockConverter;

  try {
    console.log('📄 Processing 3-page PDF...\n');

    const result = await processor.processPDFParallel('/test/document.pdf');

    console.log('✅ Processing completed!\n');
    console.log('📊 Results:');
    console.log(`   - Total pages: ${result.totalPages}`);
    console.log(`   - All pages complete: ${result.allPagesComplete}`);
    console.log(`   - Combined raw text length: ${result.combinedRawText.length}`);
    console.log(`   - Combined boosted text length: ${result.combinedBoostedText.length}`);

    console.log('\n🔍 Verification:\n');

    // Test 1: Extract should be called 3 times (once per page)
    const extractCalls = mockGemini.extractTextCalls.length;
    console.log(`   ✓ Extract calls: ${extractCalls} (expected: 3)`);
    if (extractCalls !== 3) {
      throw new Error(`❌ FAILED: Expected 3 extract calls, got ${extractCalls}`);
    }

    // Test 2: Boost should be called ONLY ONCE (on concatenated text)
    const boostCalls = mockGemini.boostTextCalls.length;
    console.log(`   ✓ Boost calls: ${boostCalls} (expected: 1) ✅ CORRECT FLOW!`);
    if (boostCalls !== 1) {
      throw new Error(`❌ FAILED: Expected 1 boost call, got ${boostCalls}`);
    }

    // Test 3: Boost should receive concatenated text from all pages
    const boostInput = mockGemini.boostTextCalls[0].rawText;
    console.log(`   ✓ Boost input length: ${boostInput.length} characters`);
    
    const hasPage1 = boostInput.includes('Raw text from page 1');
    const hasPage2 = boostInput.includes('Raw text from page 2');
    const hasPage3 = boostInput.includes('Raw text from page 3');
    const hasPageMarkers = boostInput.includes('--- Page 1 ---') && 
                          boostInput.includes('--- Page 2 ---') && 
                          boostInput.includes('--- Page 3 ---');

    console.log(`   ✓ Boost input contains page 1: ${hasPage1}`);
    console.log(`   ✓ Boost input contains page 2: ${hasPage2}`);
    console.log(`   ✓ Boost input contains page 3: ${hasPage3}`);
    console.log(`   ✓ Boost input has page markers: ${hasPageMarkers}`);

    if (!hasPage1 || !hasPage2 || !hasPage3 || !hasPageMarkers) {
      throw new Error('❌ FAILED: Boost input does not contain all pages');
    }

    // Test 4: Combined raw text should contain all pages
    const rawHasAll = result.combinedRawText.includes('Raw text from page 1') &&
                      result.combinedRawText.includes('Raw text from page 2') &&
                      result.combinedRawText.includes('Raw text from page 3');
    console.log(`   ✓ Combined raw text has all pages: ${rawHasAll}`);
    if (!rawHasAll) {
      throw new Error('❌ FAILED: Combined raw text missing pages');
    }

    // Test 5: Combined boosted text should be the single boost result
    const boostedIsCorrect = result.combinedBoostedText.startsWith('BOOSTED:');
    console.log(`   ✓ Combined boosted text is single boost result: ${boostedIsCorrect}`);
    if (!boostedIsCorrect) {
      throw new Error('❌ FAILED: Combined boosted text is not from single boost call');
    }

    // Test 6: file_content should be the concatenated raw text
    console.log(`\n📝 Database field simulation:`);
    console.log(`   - file_content (raw): ${result.combinedRawText.substring(0, 100)}...`);
    console.log(`   - boosted_file_content: ${result.combinedBoostedText.substring(0, 100)}...`);

    console.log('\n✅ ALL TESTS PASSED! ✅\n');
    console.log('🎉 The OCR flow is CORRECT:');
    console.log('   1. Extract raw text from all pages (parallel) ✅');
    console.log('   2. CONCATENATE all raw text ✅');
    console.log('   3. Apply boost to FULL concatenated text (single call) ✅\n');

    return true;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    console.error('\nStack trace:', (error as Error).stack);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testOCRFlow()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

export { testOCRFlow };


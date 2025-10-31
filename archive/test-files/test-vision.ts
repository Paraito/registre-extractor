import { VisionAnalyzer } from './utils/vision-analyzer';
import { logger } from './utils/logger';
import path from 'path';

async function testVisionAnalyzer() {
  // Test with an existing screenshot
  const screenshotPath = path.join(
    process.cwd(), 
    'downloads/worker-aa8698ae-7b83-4f48-b134-cb04400008b3/extraction-error_1754329735296.png'
  );
  
  const analyzer = new VisionAnalyzer();
  
  logger.info('Testing vision analyzer...');
  
  const result = await analyzer.analyzeScreenshot(
    screenshotPath,
    'Testing vision analysis on failed extraction'
  );
  
  logger.info({
    success: result.success,
    pageType: result.pageType,
    buttonsFound: result.elements.buttons?.length || 0,
    suggestions: result.suggestions
  }, 'Vision analysis result');
  
  if (result.elements.buttons && result.elements.buttons.length > 0) {
    logger.info('Found buttons:');
    result.elements.buttons.forEach(button => {
      logger.info({ button }, 'Button details');
    });
  }
}

testVisionAnalyzer().catch(error => {
  logger.error({ error }, 'Test failed');
});
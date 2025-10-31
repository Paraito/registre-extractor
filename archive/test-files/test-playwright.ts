import { chromium } from 'playwright';
import { logger } from './utils/logger';

async function testPlaywright() {
  logger.info('Testing basic Playwright...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Navigate to the Quebec Registry site
    await page.goto('https://www.registrefoncier.gouv.qc.ca/Sirf/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    logger.info('Successfully navigated to Quebec Registry');
    
    // Take a screenshot
    await page.screenshot({ path: 'test-screenshot.png' });
    logger.info('Screenshot saved');
    
    // Try to find the entry button using standard Playwright selectors
    const entryButton = await page.locator('img[alt*="Entrée"], a:has-text("Entrée du site")').first();
    if (await entryButton.isVisible()) {
      logger.info('Found entry button');
    } else {
      logger.warn('Entry button not found');
    }
    
    logger.info('Playwright test successful!');
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined 
    }, 'Playwright test failed');
  } finally {
    await browser.close();
  }
}

testPlaywright().catch(console.error);
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../utils/logger';
import { ExtractionConfig, WorkerAccount } from '../types';
import path from 'path';
import fs from 'fs/promises';

export class SimpleRegistreExtractor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private downloadPath: string;

  constructor(
    private account: WorkerAccount,
    private workerId: string,
    private headless: boolean = true
  ) {
    this.downloadPath = path.join(process.cwd(), 'downloads', this.workerId);
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.downloadPath, { recursive: true });

      this.browser = await chromium.launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      this.context = await this.browser.newContext({
        acceptDownloads: true,
        locale: 'fr-CA',
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      this.page = await this.context.newPage();

      logger.info({ workerId: this.workerId }, 'Simple extractor initialized');
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error, 
        stack: error instanceof Error ? error.stack : undefined,
        workerId: this.workerId 
      }, 'Failed to initialize extractor');
      throw error;
    }
  }

  async login(): Promise<void> {
    if (!this.page) {
      throw new Error('Extractor not initialized');
    }

    try {
      logger.info({ workerId: this.workerId }, 'Navigating to registry site');
      await this.page.goto('https://www.registrefoncier.gouv.qc.ca/Sirf/', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      
      // Take screenshot after navigation
      await this.page.screenshot({ 
        path: path.join(this.downloadPath, 'after-navigation.png'), 
        fullPage: true 
      });

      // Click on "Entrée du site" - try multiple selectors
      const entrySelectors = [
        'img[alt*="Consultez le Registre foncier"]',
        'a:has(img[alt*="Consultez le Registre foncier"])',
        '//img[contains(@alt, "Consultez le Registre foncier")]',
        'a[href*="13_01_01"]',
        'img[src*="images/entree_bandeau.gif"]',
      ];

      let clicked = false;
      for (const selector of entrySelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible()) {
            await element.click({ timeout: 5000 });
            clicked = true;
            logger.info({ selector }, 'Clicked entry button');
            break;
          }
        } catch (e) {
          logger.debug({ selector, error: e }, 'Selector failed');
        }
      }

      if (!clicked) {
        // Take screenshot for debugging
        await this.page.screenshot({ 
          path: path.join(this.downloadPath, 'entry-page.png'), 
          fullPage: true 
        });
        throw new Error('Could not find entry button');
      }

      await this.page.waitForLoadState('networkidle');

      // Fill login form
      await this.page.fill('input[name="code_utilisateur"], input#code_utilisateur', this.account.username);
      await this.page.fill('input[name="mot_de_passe"], input#mot_de_passe, input[type="password"]', this.account.password);
      
      // Click submit
      await this.page.click('input[type="submit"], button[type="submit"], input[value="Soumettre"]');
      await this.page.waitForLoadState('networkidle');

      logger.info({ workerId: this.workerId, account: this.account.username }, 'Login successful');
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        workerId: this.workerId 
      }, 'Login failed');
      throw error;
    }
  }

  async navigateToSearch(): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      const searchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_02_indx_immbl.asp';
      const currentUrl = this.page.url();
      
      // Check if we're already on the search page
      if (currentUrl.includes('pf_13_01_11_02_indx_immbl')) {
        logger.info({ workerId: this.workerId, currentUrl }, 'Already on search page');
        return;
      }
      
      await this.page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      logger.info({ workerId: this.workerId }, 'Navigated to search page');
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to navigate to search');
      throw error;
    }
  }

  async extractDocument(config: ExtractionConfig): Promise<string> {
    if (!this.page) {
      throw new Error('Extractor not initialized');
    }

    try {
      // Select circumscription
      await this.page.selectOption('select[name*="circonscription"]', config.circumscription);
      
      // Select cadastre if provided
      if (config.cadastre) {
        await this.page.selectOption('select[name*="cadastre"]', config.cadastre);
      }
      
      // Fill lot number if provided
      if (config.lot_number) {
        await this.page.fill('input[name*="lot"], input[name*="numero"]', config.lot_number);
      }
      
      // Submit form
      await this.page.click('input[type="submit"], button[type="submit"]');

      // Wait for document to load
      logger.info({ workerId: this.workerId, lotNumber: config.lot_number || config.numero_inscription }, 'Waiting for document to load');
      await this.page.waitForLoadState('networkidle', { timeout: 120000 });

      // Handle framesets if present
      const frames = this.page.frames();
      let targetPage = this.page;
      
      if (frames.length > 1) {
        const pageFrame = frames.find(f => f.name() === 'page' || f.url().includes('Docmn'));
        if (pageFrame) {
          // For frame, we'll need to use frame-specific selectors
          logger.info({ frameName: pageFrame.name(), frameUrl: pageFrame.url() }, 'Found document frame');
        }
      }

      // Set up download promise before clicking save
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
      
      // Click save button - try multiple selectors
      const saveSelectors = [
        'a:has-text("Sauvegarder")',
        'button:has-text("Sauvegarder")',
        'input[value*="Sauvegarder"]',
        'img[alt*="Sauvegarder"]',
        'a[href*="save"], a[href*="download"]',
      ];

      let saveClicked = false;
      for (const selector of saveSelectors) {
        try {
          await targetPage.click(selector, { timeout: 5000 });
          saveClicked = true;
          logger.info({ selector }, 'Clicked save button');
          break;
        } catch (e) {
          // Try next selector
        }
      }

      if (!saveClicked) {
        throw new Error('Could not find save button');
      }
      
      const download = await downloadPromise;
      const fileName = `${config.lot_number?.replace(/\s+/g, '_') || 'doc'}_${Date.now()}.pdf`;
      const savedPath = path.join(this.downloadPath, fileName);
      
      await download.saveAs(savedPath);
      
      logger.info({ 
        workerId: this.workerId, 
        lotNumber: config.lot_number || config.numero_inscription,
        savedPath 
      }, 'Document extracted successfully');

      // Navigate back to search form for next extraction
      try {
        await this.navigateToSearch();
        logger.info('Returned to search form for next extraction');
      } catch (navError) {
        logger.warn({ error: navError }, 'Failed to navigate back to search form');
      }

      return savedPath;
    } catch (error) {
      logger.error({ 
        error, 
        workerId: this.workerId,
        config 
      }, 'Document extraction failed');
      
      // Take screenshot for debugging
      try {
        const screenshotPath = path.join(
          this.downloadPath, 
          `error_${config.lot_number}_${Date.now()}.png`
        );
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info({ screenshotPath }, 'Error screenshot saved');
      } catch (screenshotError) {
        logger.error({ error: screenshotError }, 'Failed to save screenshot');
      }
      
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
      }
      if (this.context) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
      
      logger.info({ workerId: this.workerId }, 'Extractor closed');
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Error closing extractor');
    }
  }
}
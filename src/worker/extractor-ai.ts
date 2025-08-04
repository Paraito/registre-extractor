import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { wrap, PageExt, configure } from 'agentql';
import { logger } from '../utils/logger';
import { ExtractionConfig, WorkerAccount, DataValidationError } from '../types';
import { config } from '../config';
import path from 'path';
import fs from 'fs/promises';
import { findBestSelectOption } from '../utils/fuzzy-matcher';
import { VisionAnalyzer, PatternBasedAnalyzer } from '../utils/vision-analyzer';
import { SmartElementFinder } from '../utils/smart-element-finder';

export class AIRegistreExtractor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private agentQLPage: PageExt | null = null;
  private downloadPath: string;
  private visionAnalyzer: VisionAnalyzer;
  private patternAnalyzer: PatternBasedAnalyzer;

  constructor(
    private account: WorkerAccount,
    private workerId: string,
    private headless: boolean = true
  ) {
    this.downloadPath = path.join(process.cwd(), 'downloads', this.workerId);
    this.visionAnalyzer = new VisionAnalyzer();
    this.patternAnalyzer = new PatternBasedAnalyzer();
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.downloadPath, { recursive: true });

      // Configure AgentQL with API key if provided
      if (config.agentQL.apiKey) {
        configure({ apiKey: config.agentQL.apiKey });
        logger.info('AgentQL configured with API key');
      }

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

      logger.info({ workerId: this.workerId }, 'AI extractor initialized');
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error, 
        stack: error instanceof Error ? error.stack : undefined,
        workerId: this.workerId 
      }, 'Failed to initialize AI extractor');
      throw error;
    }
  }

  private async wrapPage(): Promise<void> {
    if (!this.page) return;
    try {
      this.agentQLPage = await wrap(this.page);
      logger.debug('AgentQL page wrapped successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to wrap page with AgentQL');
      throw error;
    }
  }

  private async takeDebugScreenshot(name: string): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    
    const screenshotPath = path.join(this.downloadPath, `${name}_${Date.now()}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info({ screenshotPath }, 'Debug screenshot saved');
    return screenshotPath;
  }

  private async checkForDataValidationErrors(documentType?: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    logger.info('Checking for data validation errors');
    
    // Wait a moment for the page to respond after form submission
    await this.page.waitForTimeout(2000);
    
    try {
      // Look for the contValErr class which indicates a validation error
      const errorElement = await this.page.$('td.contValErr');
      
      if (errorElement) {
        // Get the error text
        const errorText = await errorElement.textContent();
        logger.info({ errorText, documentType }, 'Potential validation error detected');
        
        // For plans cadastraux, check if this is the "lot inactif" exception
        if (documentType === 'plans_cadastraux' && errorText?.includes('est inactif')) {
          logger.info({ errorText }, 'Lot inactif detected for plans cadastraux - not treating as error');
          // Don't throw error, just log and continue
          await this.takeDebugScreenshot('lot-inactif-plans-cadastraux');
          return; // Exit without throwing error
        }
        
        // For all other cases, treat as error
        logger.error({ errorText }, 'Data validation error detected');
        
        // Take a screenshot for debugging
        await this.takeDebugScreenshot('data-validation-error');
        
        
        // Throw a DataValidationError with details
        throw new DataValidationError(
          `Data validation error: ${errorText || 'Unknown validation error'}`,
          errorText || undefined
        );
      }
      
      // Also check for the table with class "Cadre" that contains the error
      const errorTable = await this.page.$('table.Cadre');
      if (errorTable) {
        // Double-check by looking for the specific image that appears with errors
        const errorImage = await errorTable.$('img[src*="image_message.gif"]');
        if (errorImage) {
          // Try to get the error text from the table
          const errorCell = await errorTable.$('td.contValErr');
          const errorText = errorCell ? await errorCell.textContent() : 'Unknown error';
          
          // For plans cadastraux, check if this is the "lot inactif" exception
          if (documentType === 'plans_cadastraux' && errorText?.includes('est inactif')) {
            logger.info({ errorText }, 'Lot inactif detected via error table for plans cadastraux - not treating as error');
            await this.takeDebugScreenshot('lot-inactif-plans-cadastraux-table');
            return; // Exit without throwing error
          }
          
          logger.error({ errorText }, 'Data validation error detected via error table');
          
          // Take a screenshot
          await this.takeDebugScreenshot('data-validation-error-table');
          
          throw new DataValidationError(
            `Data validation error: ${errorText}`,
            errorText || undefined
          );
        }
      }
      
      logger.debug('No data validation errors detected');
    } catch (error) {
      if (error instanceof DataValidationError) {
        throw error; // Re-throw validation errors
      }
      // Log but don't throw other errors - we don't want to fail if error checking fails
      logger.warn({ error }, 'Error while checking for validation errors');
    }
  }

  private async checkAndSelectLatestRadioOption(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    logger.info('Checking for radio button options (plans cadastraux)');
    
    // Wait for the page to respond after form submission
    await this.page.waitForTimeout(2000);
    
    try {
      // Check if there are radio buttons on the page
      const radioButtons = await this.page.$$('input[type="radio"]');
      
      if (radioButtons && radioButtons.length > 0) {
        logger.info({ count: radioButtons.length }, 'Radio buttons found, selecting the latest option');
        
        // Take a screenshot before selection
        await this.takeDebugScreenshot('radio-options-before-selection');
        
        // Select the last radio button (latest option)
        const lastRadioButton = radioButtons[radioButtons.length - 1];
        await lastRadioButton.click();
        
        logger.info('Selected the latest radio option');
        
        // Wait a moment for the selection to register
        await this.page.waitForTimeout(500);
        
        // Find and click the Soumettre button again
        logger.info('Looking for Soumettre button after radio selection');
        
        // Try direct selector first
        let submitClicked = false;
        const submitBtn = await this.page.$('input[type="submit"], button[type="submit"], input[value*="Soumettre"]');
        if (submitBtn) {
          await submitBtn.click();
          submitClicked = true;
          logger.info('Clicked Soumettre button after radio selection');
        }
        
        if (!submitClicked) {
          // Try with AI as fallback
          try {
            const submitQuery = `{
              submitButton(description: "Submit button with text 'Soumettre' or similar")
            }`;
            const { submitButton } = await this.queryWithAI(submitQuery, 'submit-after-radio');
            if (submitButton) {
              await submitButton.click();
              submitClicked = true;
              logger.info('Clicked Soumettre button using AI after radio selection');
            }
          } catch (e) {
            logger.warn('Could not find submit button after radio selection');
          }
        }
        
        if (!submitClicked) {
          logger.warn('Could not click Soumettre after radio selection, continuing anyway');
        }
        
        // Take a screenshot after selection and submission
        await this.takeDebugScreenshot('radio-options-after-submission');
        
      } else {
        logger.debug('No radio buttons found, continuing with normal flow');
      }
    } catch (error) {
      // Log but don't throw - we don't want to fail if radio button handling fails
      logger.warn({ error }, 'Error while checking for radio buttons, continuing anyway');
    }
  }

  private async queryWithAI(query: string, description: string): Promise<any> {
    if (!this.agentQLPage) {
      throw new Error('AgentQL page not initialized');
    }

    try {
      logger.debug({ query, description }, 'Executing AI query');
      const result = await this.agentQLPage.queryElements(query);
      return result;
    } catch (error) {
      logger.error({ query, error }, 'AI query failed');
      await this.takeDebugScreenshot(`ai-query-failed-${description}`);
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

      // Wrap page after navigation
      await this.wrapPage();

      // Use natural language to find the entry button
      logger.info('Looking for site entry with AI');
      
      const entryQuery = `{
        entryButton(description: "Button or link to enter the site, might say 'Entrée du site' or 'Consultez le Registre foncier'")
      }`;

      try {
        const { entryButton } = await this.queryWithAI(entryQuery, 'entry-button');
        
        if (entryButton) {
          await entryButton.click();
          logger.info('Clicked entry button using AI');
          await this.page.waitForLoadState('networkidle');
        } else {
          throw new Error('Entry button not found by AI');
        }
      } catch (error) {
        logger.error({ error }, 'Failed to find entry button with AI');
        
        // Take screenshot and try alternative approach
        await this.takeDebugScreenshot('entry-page-ai-fail');
        
        // Try with more descriptive query
        const alternativeQuery = `{
          anyEntryLink(description: "Any clickable element that would let me enter or access the main site")
          registryImage(description: "Image that says something about 'Registre foncier' or registry")
        }`;
        
        const altResult = await this.queryWithAI(alternativeQuery, 'alternative-entry');
        
        if (altResult.anyEntryLink) {
          await altResult.anyEntryLink.click();
        } else if (altResult.registryImage) {
          await altResult.registryImage.click();
        } else {
          throw new Error('Could not find any way to enter the site');
        }
        
        await this.page.waitForLoadState('networkidle');
      }

      // Now find and fill login form using AI
      const loginQuery = `{
        usernameField(description: "Input field for username or 'Code d'utilisateur'")
        passwordField(description: "Input field for password or 'Mot de passe'")
        submitButton(description: "Submit or login button, might say 'Soumettre' or 'Connexion'")
      }`;

      const loginElements = await this.queryWithAI(loginQuery, 'login-form');

      if (!loginElements.usernameField || !loginElements.passwordField || !loginElements.submitButton) {
        await this.takeDebugScreenshot('login-form-missing-elements');
        throw new Error('Could not find all login form elements');
      }

      await loginElements.usernameField.fill(this.account.username);
      await loginElements.passwordField.fill(this.account.password);
      await loginElements.submitButton.click();

      await this.page.waitForLoadState('networkidle');

      // Verify login success
      const verifyQuery = `{
        logoutLink(description: "Logout link or button indicating we're logged in")
        userInfo(description: "Any element showing user information or account name")
        errorMessage(description: "Any error message about login failure")
      }`;

      const verifyResult = await this.queryWithAI(verifyQuery, 'login-verification');

      if (verifyResult.errorMessage) {
        const errorText = await verifyResult.errorMessage.textContent();
        throw new Error(`Login failed: ${errorText}`);
      }

      if (!verifyResult.logoutLink && !verifyResult.userInfo) {
        logger.warn('Could not verify login success, continuing anyway');
      }

      logger.info({ workerId: this.workerId, account: this.account.username }, 'Login successful with AI');
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        workerId: this.workerId 
      }, 'AI login failed');
      await this.takeDebugScreenshot('login-error');
      throw error;
    }
  }

  async navigateToSearch(documentType: 'index' | 'actes' | 'plans_cadastraux' = 'index'): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      let searchUrl: string;
      
      switch (documentType) {
        case 'actes':
          searchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_08_reqst.asp';
          break;
        case 'plans_cadastraux':
          searchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_10_plan_cadst.asp';
          break;
        case 'index':
        default:
          searchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_02_indx_immbl.asp';
          break;
      }
      
      // Check if we're already on the search page
      const currentUrl = this.page.url();
      if (currentUrl.includes(searchUrl) || 
          (documentType === 'index' && currentUrl.includes('pf_13_01_11_02_indx_immbl')) ||
          (documentType === 'actes' && currentUrl.includes('pf_13_01_11_08_reqst')) ||
          (documentType === 'plans_cadastraux' && currentUrl.includes('pf_13_01_11_10_plan_cadst'))) {
        logger.info({ workerId: this.workerId, documentType, currentUrl }, 'Already on search page');
        return;
      }
      
      logger.info({ workerId: this.workerId, documentType, searchUrl, currentUrl }, 'Navigating to search page');
      
      await this.page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Re-wrap page after navigation
      await this.wrapPage();
      
      logger.info({ workerId: this.workerId, documentType }, 'Navigated to search page');
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Failed to navigate to search');
      throw error;
    }
  }

  async extractDocument(config: ExtractionConfig): Promise<string> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Extractor not initialized');
    }

    try {
      logger.info({ documentType: config.document_type, config }, 'Starting document extraction');
      
      // Handle different document types
      switch (config.document_type) {
        case 'actes':
          return await this.extractActes(config);
        case 'plans_cadastraux':
          return await this.extractPlansCadastraux(config);
        case 'index':
        default:
          return await this.extractIndex(config);
      }
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        workerId: this.workerId,
        config 
      }, 'Document extraction failed');
      
      await this.takeDebugScreenshot('extraction-error');
      throw error;
    }
  }
  
  private async extractIndex(config: ExtractionConfig): Promise<string> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Page not initialized');
    }
    
    try {
      // Since we know the exact IDs and structure, let's use direct selectors for reliability
      logger.info('Using hybrid approach: AI for discovery, direct selectors for interaction');
      
      // First ensure we're on the right page
      await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 10000 });
      
      // Select Circonscription foncière with fuzzy matching
      logger.info('Selecting circumscription dropdown');
      const circumscriptionSelect = await this.page.$('#selCircnFoncr');
      if (circumscriptionSelect) {
        // Check if already selected correctly
        const currentValue = await circumscriptionSelect.evaluate((el: any) => el.value);
        const currentText = await circumscriptionSelect.evaluate((el: any) => 
          el.options[el.selectedIndex]?.text?.trim() || ''
        );
        
        logger.debug({ currentValue, currentText, target: config.circumscription }, 'Current circumscription selection');
        
        // Only select if not already the correct value
        if (currentText !== config.circumscription) {
          const bestOption = await findBestSelectOption(circumscriptionSelect, config.circumscription);
          if (bestOption) {
            logger.info({ target: config.circumscription, found: bestOption }, 'Found best match for circumscription');
            await circumscriptionSelect.selectOption({ value: bestOption.value });
            
            // Wait for form to reload after selection (the onchange submits the form)
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            await this.page.waitForSelector('#selCadst', { state: 'visible', timeout: 10000 });
          } else {
            throw new Error(`Could not find matching option for circumscription: ${config.circumscription}`);
          }
        } else {
          logger.info('Circumscription already correctly selected');
        }
      }
      
      // Select Cadastre with fuzzy matching
      logger.info('Selecting cadastre dropdown');
      const cadastreSelect = await this.page.$('#selCadst');
      if (cadastreSelect) {
        // Check if already selected correctly
        const currentValue = await cadastreSelect.evaluate((el: any) => el.value);
        const currentText = await cadastreSelect.evaluate((el: any) => 
          el.options[el.selectedIndex]?.text?.trim() || ''
        );
        
        logger.debug({ currentValue, currentText, target: config.cadastre }, 'Current cadastre selection');
        
        // Only select if not already the correct value
        if (currentText !== config.cadastre) {
          // Special case for Cadastre du Québec
          if (config.cadastre && (config.cadastre === 'Cadastre du Québec' || 
              config.cadastre.toLowerCase().includes('quebec') || 
              config.cadastre.toLowerCase().includes('québec'))) {
            await cadastreSelect.selectOption({ value: '000001' });
          } else if (config.cadastre) {
            const bestOption = await findBestSelectOption(cadastreSelect, config.cadastre);
            if (bestOption) {
              logger.info({ target: config.cadastre, found: bestOption }, 'Found best match for cadastre');
              await cadastreSelect.selectOption({ value: bestOption.value });
            } else {
              throw new Error(`Could not find matching option for cadastre: ${config.cadastre}`);
            }
          }
          
          // Wait for form to reload after selection
          await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        } else {
          logger.info('Cadastre already correctly selected');
        }
      }
      
      // Fill lot number
      logger.info('Filling lot number');
      const lotNumberInput = await this.page.$('#txtNumrtLot');
      if (lotNumberInput) {
        // Clear the field first
        await lotNumberInput.fill('');
        // Remove spaces from lot number as the form expects it without spaces
        const lotNumberNoSpaces = config.lot_number?.replace(/\s+/g, '') || '';
        await lotNumberInput.fill(lotNumberNoSpaces);
      }
      
      // Handle Désignation secondaire if provided
      if (config.designation_secondaire) {
        logger.info('Checking for designation secondaire dropdown');
        const designationSelect = await this.page.$('#selDesgnSecnd');
        if (designationSelect) {
          // Check if already selected correctly
          const currentValue = await designationSelect.evaluate((el: any) => el.value);
          const currentText = await designationSelect.evaluate((el: any) => 
            el.options[el.selectedIndex]?.text?.trim() || ''
          );
          
          logger.debug({ currentValue, currentText, target: config.designation_secondaire }, 'Current designation secondaire');
          
          // Only select if not already the correct value and not empty
          if (currentText !== config.designation_secondaire && config.designation_secondaire.trim() !== '') {
            const bestOption = await findBestSelectOption(designationSelect, config.designation_secondaire);
            if (bestOption) {
              logger.info({ target: config.designation_secondaire, found: bestOption }, 'Found best match for designation secondaire');
              await designationSelect.selectOption({ value: bestOption.value });
            } else {
              logger.warn(`Could not find matching option for designation secondaire: ${config.designation_secondaire}`);
              // Don't throw error for optional field, just log warning
            }
          } else {
            logger.info('Designation secondaire already correctly selected or empty');
          }
        } else {
          logger.warn('Designation secondaire dropdown not found on page');
        }
      }
      
      // Find and click submit button
      logger.info('Looking for submit button');
      
      // First try with AI to find the submit button
      const submitQuery = `{
        submitButton(description: "Submit button with text 'Soumettre' or similar")
      }`;
      
      try {
        const { submitButton } = await this.queryWithAI(submitQuery, 'submit-button');
        if (submitButton) {
          await submitButton.click();
        }
      } catch (aiError) {
        // Fallback to direct selector
        logger.info('AI failed to find submit button, trying direct selector');
        const submitBtn = await this.page.$('input[type="submit"], button[type="submit"], input[value*="Soumettre"]');
        if (submitBtn) {
          await submitBtn.click();
        } else {
          throw new Error('Could not find submit button');
        }
      }

      // Check for validation errors after form submission
      await this.checkForDataValidationErrors('index');

      // Wait for document load and download - use the same working logic as actes
      return await this.waitForDocumentAndDownload(config);
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        workerId: this.workerId,
        config 
      }, 'AI index extraction failed');
      
      throw error;
    }
  }

  private async extractActes(config: ExtractionConfig): Promise<string> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Page not initialized');
    }
    
    if (!config.type_document || !config.numero_inscription) {
      throw new Error('type_document and numero_inscription are required for actes');
    }
    
    try {
      logger.info('Using hybrid approach for Actes extraction');
      
      // Wait for page to be ready
      await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 10000 });
      
      // Select Circonscription foncière with fuzzy matching
      logger.info('Selecting circumscription dropdown for actes');
      const circumscriptionSelect = await this.page.$('#selCircnFoncr');
      if (circumscriptionSelect) {
        const currentText = await circumscriptionSelect.evaluate((el: any) => 
          el.options[el.selectedIndex]?.text?.trim() || ''
        );
        
        if (currentText !== config.circumscription) {
          const bestOption = await findBestSelectOption(circumscriptionSelect, config.circumscription);
          if (bestOption) {
            logger.info({ target: config.circumscription, found: bestOption }, 'Found best match for circumscription');
            await circumscriptionSelect.selectOption({ value: bestOption.value });
          } else {
            throw new Error(`Could not find matching option for circumscription: ${config.circumscription}`);
          }
        } else {
          logger.info('Circumscription already correctly selected');
        }
      }
      
      // Select Type de document
      logger.info('Selecting type de document dropdown');
      const typeDocSelect = await this.page.$('#selTypeDocmn');
      if (typeDocSelect) {
        const currentValue = await typeDocSelect.evaluate((el: any) => el.value);
        const currentText = await typeDocSelect.evaluate((el: any) => 
          el.options[el.selectedIndex]?.text?.trim() || ''
        );
        
        logger.debug({ currentValue, currentText, target: config.type_document }, 'Current type document selection');
        
        if (currentText !== config.type_document) {
          const bestOption = await findBestSelectOption(typeDocSelect, config.type_document);
          if (bestOption) {
            logger.info({ target: config.type_document, found: bestOption }, 'Found best match for type document');
            await typeDocSelect.selectOption({ value: bestOption.value });
          } else {
            // Try by value if text doesn't match
            await typeDocSelect.selectOption({ value: config.type_document });
          }
        } else {
          logger.info('Type document already correctly selected');
        }
      }
      
      // Fill Numéro d'inscription
      logger.info('Filling numero inscription');
      const numeroInput = await this.page.$('#txtNoReqst');
      if (numeroInput) {
        await numeroInput.fill('');
        await numeroInput.fill(config.numero_inscription);
      }
      
      // Find and click Rechercher button
      logger.info('Looking for Rechercher button');
      
      // Try AI first
      const submitQuery = `{
        submitButton(description: "Button with text 'Rechercher' or similar")
      }`;
      
      let submitClicked = false;
      try {
        const { submitButton } = await this.queryWithAI(submitQuery, 'rechercher-button');
        if (submitButton) {
          await submitButton.click();
          submitClicked = true;
          logger.info('Clicked Rechercher button using AI');
        }
      } catch (e) {
        logger.debug('AI failed to find Rechercher button, trying direct selector');
      }
      
      if (!submitClicked) {
        // Fallback to direct selector
        const submitBtn = await this.page.$('input[value*="Rechercher"], button:has-text("Rechercher")');
        if (submitBtn) {
          await submitBtn.click();
          submitClicked = true;
          logger.info('Clicked Rechercher button using direct selector');
        }
      }
      
      if (!submitClicked) {
        throw new Error('Could not find Rechercher button');
      }
      
      // Check for validation errors after form submission
      await this.checkForDataValidationErrors('actes');
      
      // Wait for document load and download - same as index
      return await this.waitForDocumentAndDownload(config);
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        workerId: this.workerId,
        config 
      }, 'Actes extraction failed');
      
      throw error;
    }
  }

  private async extractPlansCadastraux(config: ExtractionConfig): Promise<string> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Page not initialized');
    }
    
    if (!config.lot_number) {
      throw new Error('lot_number is required for plans cadastraux');
    }
    
    try {
      logger.info('Using hybrid approach for Plans Cadastraux extraction');
      
      // Wait for page to be ready
      await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 10000 });
      
      // Select Circonscription foncière
      logger.info('Selecting circumscription for plans cadastraux');
      const circumscriptionSelect = await this.page.$('#selCircnFoncr');
      if (circumscriptionSelect) {
        const currentText = await circumscriptionSelect.evaluate((el: any) => 
          el.options[el.selectedIndex]?.text?.trim() || ''
        );
        
        if (currentText !== config.circumscription) {
          const bestOption = await findBestSelectOption(circumscriptionSelect, config.circumscription);
          if (bestOption) {
            logger.info({ target: config.circumscription, found: bestOption }, 'Found best match for circumscription');
            await circumscriptionSelect.selectOption({ value: bestOption.value });
            
            // Wait for form to reload
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            await this.page.waitForSelector('#selCadst', { state: 'visible', timeout: 10000 });
          } else {
            throw new Error(`Could not find matching option for circumscription: ${config.circumscription}`);
          }
        } else {
          logger.info('Circumscription already correctly selected');
        }
      }
      
      // Select Cadastre if provided
      if (config.cadastre) {
        logger.info('Selecting cadastre dropdown');
        const cadastreSelect = await this.page.$('#selCadst');
        if (cadastreSelect) {
          const currentText = await cadastreSelect.evaluate((el: any) => 
            el.options[el.selectedIndex]?.text?.trim() || ''
          );
          
          if (currentText !== config.cadastre) {
            if (config.cadastre && (config.cadastre === 'Cadastre du Québec' || 
                config.cadastre.toLowerCase().includes('quebec') || 
                config.cadastre.toLowerCase().includes('québec'))) {
              await cadastreSelect.selectOption({ value: '000001' });
            } else {
              const bestOption = await findBestSelectOption(cadastreSelect, config.cadastre);
              if (bestOption) {
                await cadastreSelect.selectOption({ value: bestOption.value });
              }
            }
            
            // Wait for form to reload
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
          }
        }
      }
      
      // Fill lot number
      logger.info('Filling lot number');
      const lotNumberInput = await this.page.$('#txtNumrtLot');
      if (lotNumberInput) {
        await lotNumberInput.fill('');
        const lotNumberNoSpaces = config.lot_number?.replace(/\s+/g, '') || '';
        await lotNumberInput.fill(lotNumberNoSpaces);
      }
      
      // Handle Désignation secondaire if provided
      if (config.designation_secondaire) {
        logger.info('Checking for designation secondaire dropdown');
        const designationSelect = await this.page.$('#selDesgnSecnd');
        if (designationSelect) {
          const currentValue = await designationSelect.evaluate((el: any) => el.value);
          
          if (currentValue !== config.designation_secondaire && config.designation_secondaire.trim() !== '') {
            const bestOption = await findBestSelectOption(designationSelect, config.designation_secondaire);
            if (bestOption) {
              await designationSelect.selectOption({ value: bestOption.value });
            }
          }
        }
      }
      
      // Click Soumettre - same as index
      logger.info('Looking for submit button');
      
      const submitQuery = `{
        submitButton(description: "Submit button with text 'Soumettre' or similar")
      }`;
      
      try {
        const { submitButton } = await this.queryWithAI(submitQuery, 'submit-button');
        if (submitButton) {
          await submitButton.click();
        }
      } catch (aiError) {
        logger.info('AI failed to find submit button, trying direct selector');
        const submitBtn = await this.page.$('input[type="submit"], button[type="submit"], input[value*="Soumettre"]');
        if (submitBtn) {
          await submitBtn.click();
        } else {
          throw new Error('Could not find submit button');
        }
      }
      
      // Check for validation errors after form submission
      await this.checkForDataValidationErrors('plans_cadastraux');
      
      // For plans cadastraux, check if radio button selection is needed
      await this.checkAndSelectLatestRadioOption();
      
      // Wait for document load and download - same as index
      return await this.waitForDocumentAndDownload(config);
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : error,
        workerId: this.workerId,
        config 
      }, 'Plans Cadastraux extraction failed');
      
      throw error;
    }
  }

  private async waitForDocumentAndDownload(config: ExtractionConfig): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    
    // Wait for document to load - this can take up to 3 minutes
    logger.info({ workerId: this.workerId }, 'Waiting for document to load');
    
    const searchPageUrl = this.page.url();
    logger.debug({ searchPageUrl }, 'Current URL before document load');
    
    // Wait for menu frame to appear (indicating document has loaded)
    let documentLoaded = false;
    let attempts = 0;
    const maxAttempts = 60; // 3 minutes with 3 second intervals
    
    while (!documentLoaded && attempts < maxAttempts) {
      attempts++;
      
      // Check for URL change
      if (this.page.url() !== searchPageUrl) {
        logger.info('URL changed, document loading');
        documentLoaded = true;
        break;
      }
      
      // Check for menu frame - this indicates document has loaded
      const frames = this.page.frames();
      if (frames.length > 1) {
        const menuFrame = frames.find(f => f.name() === 'menu');
        if (menuFrame) {
          logger.info('Menu frame detected - document loaded');
          documentLoaded = true;
          break;
        }
        
        // Also check for page frame as fallback
        const pageFrame = frames.find(f => f.name() === 'page' || f.url().includes('Docmn'));
        if (pageFrame) {
          logger.info('Document frame detected');
          documentLoaded = true;
          break;
        }
      }
      
      // Wait 3 seconds before next check
      await this.page.waitForTimeout(3000);
      
      if (attempts % 10 === 0) {
        logger.info({ attempts, maxAttempts }, 'Still waiting for document to load...');
      }
    }
    
    if (!documentLoaded) {
      throw new Error('Document did not load after 3 minutes');
    }
    
    // Additional wait for network to settle
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    
    const documentPageUrl = this.page.url();
    logger.info({ documentPageUrl }, 'Document page loaded with new URL');

    // Handle framesets if present - but save button is always in parent
    const frames = this.page.frames();
    if (frames.length > 1) {
      const pageFrame = frames.find(f => f.name() === 'page' || f.url().includes('Docmn'));
      if (pageFrame) {
        logger.info('Found document in frame, but save button is in parent page');
      }
    }

    // Wait for save button to appear and determine which frame it's in
    logger.info('Waiting for save button to appear');
    
    // First ensure save button exists and get the correct frame
    const targetFrame = await this.waitForSaveButton(this.page);
    
    
    // Click the save button in the correct frame
    const result = await this.findAndClickSaveButton(targetFrame);
    
    if (!result.clicked || !result.downloadPromise) {
      throw new Error('Could not find save/download button or download was not initiated');
    }

    // Wait for the download to start
    const download = await result.downloadPromise;
    const fileName = `${config.document_type}_${config.lot_number || config.numero_inscription || 'doc'}_${Date.now()}.pdf`;
    const savedPath = path.join(this.downloadPath, fileName.replace(/\s+/g, '_'));
    
    await download.saveAs(savedPath);
    
    logger.info({ 
      workerId: this.workerId, 
      documentType: config.document_type,
      savedPath 
    }, 'Document extracted successfully');

    // Navigate back to search form for next extraction
    try {
      await this.navigateToSearch(config.document_type || 'index');
      logger.info('Returned to search form for next extraction');
    } catch (navError) {
      logger.warn({ error: navError }, 'Failed to navigate back to search form');
    }

    return savedPath;
  }

  private async waitForSaveButton(initialFrame: any): Promise<any> {
    logger.info('Waiting for save button to appear');
    
    // First wait for menu frame to ensure document is fully loaded
    let menuFrame: any = null;
    try {
      const maxWaitTime = 30000; // 30 seconds max
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const frames = this.page!.frames();
        menuFrame = frames.find(f => f.name() === 'menu');
        if (menuFrame) {
          logger.info('Menu frame appeared, document fully loaded');
          // Log all frames for debugging
          logger.debug({ 
            frameCount: frames.length,
            frameNames: frames.map(f => ({ name: f.name(), url: f.url() }))
          }, 'All frames in page');
          break;
        }
        await this.page!.waitForTimeout(500);
      }
    } catch (e) {
      logger.warn('Could not detect menu frame, continuing anyway');
    }
    
    // Now look for save button with direct selectors
    const saveButtonSelectors = [
      'a[title="Sauvegarder ou imprimer le document"]',  // Exact title match
      'a:has-text("Sauvegarder")',  // Text-based selector
      '//a[contains(text(), "Sauvegarder")]',  // XPath
      'td.menuBoutnCentr a',
      'td.fondOrang a',
      'a[href*="impri_sauvg"]',
      'a[onmouseup*="fRechrDocmnPDF"]'
    ];
    
    let found = false;
    let targetFrame = initialFrame;
    
    // Try each selector with a shorter timeout since we already waited for frames
    for (const selector of saveButtonSelectors) {
      try {
        logger.debug({ selector }, 'Trying selector in main page');
        await initialFrame.waitForSelector(selector, { timeout: 2000 });
        found = true;
        logger.info({ selector }, 'Save button found in main page');
        targetFrame = initialFrame;
        break;
      } catch (e) {
        logger.debug({ selector, error: e instanceof Error ? e.message : String(e) }, 'Selector failed in main page');
        // Continue trying next selector
      }
    }
    
    if (!found && menuFrame) {
      // Try looking in the menu frame
      logger.info('Trying to find save button in menu frame');
      for (const selector of saveButtonSelectors) {
        try {
          logger.debug({ selector }, 'Trying selector in menu frame');
          await menuFrame.waitForSelector(selector, { timeout: 2000 });
          found = true;
          logger.info({ selector }, 'Save button found in menu frame');
          targetFrame = menuFrame;
          break;
        } catch (e) {
          logger.debug({ selector, error: e instanceof Error ? e.message : String(e) }, 'Selector failed in menu frame');
        }
      }
    }
    
    if (!found) {
      // Try one more time with a longer wait for the primary selector in main page
      try {
        await initialFrame.waitForSelector('a[title="Sauvegarder ou imprimer le document"]', { timeout: 10000 });
        found = true;
        targetFrame = initialFrame;
        logger.info('Save button found with extended wait in main page');
      } catch (e) {
        // Try in menu frame as last resort
        if (menuFrame) {
          try {
            await menuFrame.waitForSelector('a[title="Sauvegarder ou imprimer le document"]', { timeout: 10000 });
            found = true;
            targetFrame = menuFrame;
            logger.info('Save button found with extended wait in menu frame');
          } catch (e2) {
            // Will try AI fallback next
          }
        }
      }
    }
    
    if (!found) {
      // If direct selectors fail, try AI as fallback
      logger.info('Direct selectors failed, trying AI to wait for save button');
      try {
        const query = `
          {
            download_link(any of: [
              <a href="#">,
              <button>,
              <input type="button">,
              <img alt="Save">,
              <div>
            ])
          }
        `;
        
        // @ts-ignore - waitForQueryState might not be in the type definition
        await this.agentQLPage!.waitForQueryState(query, { timeout: 30000 });
        targetFrame = initialFrame; // Use main page for AI
      } catch (error) {
        throw new Error('Save button not found with AI');
      }
    }
    
    return targetFrame;
  }

  private async findAndClickSaveButton(targetFrame: any): Promise<{ clicked: boolean; downloadPromise: Promise<any> | null }> {
    let saveButtonClicked = false;
    let downloadPromise: Promise<any> | null = null;
    
    // Find save button - use direct selectors when in frames
    if (targetFrame !== this.page) {
      logger.info('Using direct selectors for save button in frame');
      
      const saveButtonSelectors = [
        'a[title*="Sauvegarder"]',  // Primary selector based on user's HTML
        'a:has-text("Sauvegarder")',
        'a[href*="impri_sauvg"]',
        'td.menuBoutnCentr a',
        'input[type="button"][value*="Sauvegarder"]',
        'button[title*="Sauvegarder"]',
        'a[href*="pdf"]',
        'img[alt*="save"]',
        'img[alt*="Sauvegarder"]',
        'input[type="image"][alt*="Sauvegarder"]'
      ];
      
      // Wait for at least one save button selector to appear
      let saveButtonFound = false;
      for (const selector of saveButtonSelectors) {
        try {
          await targetFrame.waitForSelector(selector, { timeout: 5000 });
          saveButtonFound = true;
          logger.info({ selector }, 'Save button appeared');
          break;
        } catch (e) {
          // Continue trying other selectors
        }
      }
      
      if (!saveButtonFound) {
        logger.warn('No save button found with waitForSelector, trying immediate search');
      }
      
      for (const selector of saveButtonSelectors) {
        try {
          const element = await targetFrame.$(selector);
          if (element) {
            // Set up download promise before clicking
            downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
            await element.click();
            saveButtonClicked = true;
            logger.info({ selector }, 'Clicked save button');
            break;
          }
        } catch (e) {
          // Continue trying other selectors
        }
      }
    } else {
      // Use AI for main page
      logger.info('Looking for save button using AI, the button was found but instead of clicking it, it wait for ai.. Please adjust, it\'s almost working, we just need to save by clicking on the button.');
      
      // Try multiple times to find the save button as it may take time to appear
      for (let attempt = 0; attempt < 3; attempt++) {
        const saveQuery = `{
          saveButton(description: "Button to save or download the document, might say 'Sauvegarder' or have a save icon")
          downloadLink(description: "Link to download the document or PDF")
        }`;

        try {
          const saveElements = await this.queryWithAI(saveQuery, 'save-button');

          if (saveElements.saveButton) {
            // Set up download promise before clicking
            downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
            await saveElements.saveButton.click();
            saveButtonClicked = true;
            logger.info('Clicked save button using AI');
            break;
          } else if (saveElements.downloadLink) {
            // Set up download promise before clicking
            downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
            await saveElements.downloadLink.click();
            saveButtonClicked = true;
            logger.info('Clicked download link using AI');
            break;
          }
        } catch (e) {
          logger.warn({ attempt, error: e }, 'Failed to find save button, retrying...');
          if (attempt < 2) {
            await this.page!.waitForTimeout(3000); // Wait 3 seconds before retry
          }
        }
      }
      
      if (!saveButtonClicked) {
        // Try vision and smart element fallbacks
        logger.warn('AI failed to find save button, trying vision fallback');
        const screenshotPath = await this.takeDebugScreenshot('vision-fallback');
        
        const visionResult = await this.visionAnalyzer!.analyzeScreenshot(
          screenshotPath, 
          'Failed to find save button with AgentQL'
        );
        
        if (visionResult.success && visionResult.elements.buttons && visionResult.elements.buttons.length > 0) {
          logger.info({ buttons: visionResult.elements.buttons }, 'Vision analysis found buttons');
          
          const element = await this.patternAnalyzer.findSaveButton(this.page);
          if (element) {
            // Set up download promise before clicking
            downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
            await element.click();
            saveButtonClicked = true;
            logger.info('Clicked save button found by vision fallback');
          }
        }
        
        if (!saveButtonClicked) {
          // Last resort: try smart element finder
          logger.info('Trying smart element finder as final fallback');
          const smartFinder = new SmartElementFinder(this.page!);
          const smartElement = await smartFinder.findSaveButton();
          
          if (smartElement) {
            // Set up download promise before clicking
            downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
            await smartElement.click();
            saveButtonClicked = true;
            logger.info('Clicked save button found by smart element finder');
          } else {
            // Try keyboard navigation - this method handles its own download promise
            const keyboardResult = await smartFinder.findSaveButtonWithKeyboard();
            if (keyboardResult) {
              downloadPromise = this.page!.waitForEvent('download', { timeout: 30000 });
              saveButtonClicked = true;
            }
          }
        }
      }
    }
    
    return { clicked: saveButtonClicked, downloadPromise };
  }

  async analyzeScreenshot(screenshotPath: string): Promise<{ success: boolean; suggestion?: string }> {
    logger.info({ screenshotPath }, 'Analyzing screenshot with AI vision');
    
    try {
      const visionResult = await this.visionAnalyzer.analyzeScreenshot(
        screenshotPath,
        'Analyzing page for navigation hints'
      );
      
      if (visionResult.success) {
        logger.info({
          pageType: visionResult.pageType,
          buttonsFound: visionResult.elements.buttons?.length,
          suggestions: visionResult.suggestions
        }, 'Vision analysis complete');
        
        return {
          success: true,
          suggestion: visionResult.suggestions.join('; ') || 'Check vision analysis logs'
        };
      }
    } catch (error) {
      logger.error({ error }, 'Vision analysis failed');
    }
    
    return {
      success: false,
      suggestion: 'Vision analysis unavailable - manual review required'
    };
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
      
      logger.info({ workerId: this.workerId }, 'AI extractor closed');
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Error closing AI extractor');
    }
  }
}
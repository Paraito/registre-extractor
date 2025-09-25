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
import { extractSelectOptions, SelectOption } from '../utils/fuzzy-matcher';

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
        
        // For actes, check if this is the "similar documents" case - don't throw error, return to continue
        if (documentType === 'actes' && errorText?.includes('Nous vous proposons une liste de document(s) dont le numéro est semblable')) {
          logger.info({ errorText }, 'Similar documents found for actes - will handle document selection');
          // Take a screenshot for debugging
          await this.takeDebugScreenshot('actes-similar-documents');
          return; // Exit without throwing error - let the flow continue to document selection
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

  async navigateToSearch(documentType: 'index' | 'actes' | 'plans_cadastraux' = 'index', forceReload: boolean = false): Promise<void> {
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

      // Check if we're already on the search page (unless force reload is requested)
      const currentUrl = this.page.url();
      if (!forceReload && (
          currentUrl.includes(searchUrl) ||
          (documentType === 'index' && currentUrl.includes('pf_13_01_11_02_indx_immbl')) ||
          (documentType === 'actes' && currentUrl.includes('pf_13_01_11_08_reqst')) ||
          (documentType === 'plans_cadastraux' && currentUrl.includes('pf_13_01_11_10_plan_cadst')))) {
        logger.info({ workerId: this.workerId, documentType, currentUrl }, 'Already on search page');
        return;
      }

      logger.info({ workerId: this.workerId, documentType, searchUrl, currentUrl, forceReload }, 'Navigating to search page');

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
  
  /**
   * Helper method to use OpenAI for intelligent dropdown option matching
   * Uses a complete context string with all available information
   */
  private async findBestOptionWithLLM(
    options: SelectOption[],
    contextString: string,
    dropdownType: 'cadastre' | 'designation',
    excludeOptions: string[] = [],
    attemptNumber: number = 1
  ): Promise<{ bestOption: SelectOption | null; reasoning: string }> {
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      logger.warn('OpenAI API key not configured, falling back to fuzzy matching');
      return { bestOption: null, reasoning: 'No OpenAI API key' };
    }

    try {
      // Filter out excluded options
      const filteredOptions = options.filter(opt => !excludeOptions.includes(opt.text));

      if (filteredOptions.length === 0) {
        logger.warn({
          dropdownType,
          excludeOptions,
          totalOptions: options.length,
          allOptions: options.map(o => o.text)
        }, 'No options left after filtering excludes - all have been tried');
        return { bestOption: null, reasoning: 'All options have been tried and failed' };
      }

      const optionsList = filteredOptions
        .map((opt, idx) => `${idx}: "${opt.text}"`)
        .join('\n');

      const prompt = dropdownType === 'cadastre'
        ? `You are helping match cadastre information from a Quebec land registry form.

           Complete search context: "${contextString}"
           This string format is: [document_number, circonscription, cadastre, designation_secondaire]

           Attempt #${attemptNumber}
           ${excludeOptions.length > 0 ? `\nPREVIOUSLY FAILED (DO NOT SELECT): ${excludeOptions.join(', ')}` : ''}

           Available cadastre options (index: "name"):
           ${optionsList}

           TASK: Find the BEST matching cadastre from the context string.

           CRITICAL RULES:
           1. If attempt > 1 and "Cadastre du Québec" failed, look for parish/canton names in the context
           2. Search for cadastre patterns ANYWHERE in the context string, including in the designation part
           3. Common patterns to match:
              - "Paroisse de [Name]" → match "Paroisse de [Name]"
              - "Canton de [Name]" → match "Canton de [Name]"
              - "Village de [Name]" → match "Village de [Name]"
              - "Ville de [Name]" → match "Ville de [Name]"
           4. Handle variations: "Saint-Hippolyte" = "St-Hippolyte" = "Saint Hippolyte"
           5. Example: if context has "Rang 5 Canton Abercrombie Paroisse de Saint-Hippolyte",
              you should match option "Paroisse de Saint-Hippolyte"
           6. NEVER select excluded options

           Return ONLY valid JSON:
           {"index": <number>, "confidence": <"high"|"medium"|"low">, "reasoning": "<why this matches>", "matched_text": "<exact text from context>"}`
        : `You are helping match designation secondaire information from a Quebec land registry form.

           Complete search context: "${contextString}"
           Selected cadastre: "${excludeOptions[0] || 'not yet selected'}"

           Available designation secondaire options:
           ${optionsList}

           Task: Find the best matching designation option from the context string.

           Important rules:
           1. Look for Rang/Canton patterns in the context
           2. The designation must complement the selected cadastre
           3. Common patterns: "Rang X Canton Y"
           4. This field is OPTIONAL - only select if there's a clear match
           5. If nothing matches well, return index -1

           Return ONLY a JSON object with:
           {"index": <number or -1>, "confidence": <"high"|"medium"|"low">, "reasoning": "<brief explanation>", "matched_text": "<the part that matched or 'none'>"}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',  // Using more capable model for better matching
          messages: [
            {
              role: 'system',
              content: 'You are an expert at Quebec land registry data matching. Return only valid JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 250,
          response_format: { type: 'json_object' }
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const result = JSON.parse(data.choices[0].message.content);

      // Enhanced logging for debugging
      logger.info({
        dropdownType,
        attemptNumber,
        result,
        contextString,
        excludeOptions,
        availableOptionsCount: options.filter(opt => !excludeOptions.includes(opt.text)).length,
        matchedOption: result.index >= 0 ? options.filter(opt => !excludeOptions.includes(opt.text))[result.index]?.text : 'none'
      }, 'LLM matching result');

      // Adjust index for filtered options (we already have filteredOptions from above)
      if (result.index >= 0 && result.index < filteredOptions.length) {
        const selectedOption = filteredOptions[result.index];
        // Find the original index in unfiltered options
        const originalIndex = options.findIndex(opt => opt.text === selectedOption.text);
        if (originalIndex >= 0) {
          return {
            bestOption: options[originalIndex],
            reasoning: result.reasoning
          };
        }
      }

      return { bestOption: null, reasoning: result.reasoning || 'No match found' };

    } catch (error) {
      logger.error({ error, dropdownType }, 'LLM matching failed');
      return { bestOption: null, reasoning: `LLM error: ${error}` };
    }
  }

  /**
   * Fallback extraction method with sequential retry logic
   * Tries multiple cadastre options intelligently based on context
   */
  private async extractIndexWithFallback(
    config: ExtractionConfig,
    attemptedAlternatives: string[] = [],
    maxAttempts: number = 3
  ): Promise<string> {
    logger.info({
      config,
      attempt: 'fallback'
    }, '🔄 Starting intelligent fallback for index extraction');

    if (!this.page) throw new Error('Page not initialized');

    // Build context string for LLM
    const contextString = [
      config.lot_number || '',
      config.circumscription || '',
      config.cadastre || '',
      config.designation_secondaire || ''
    ].filter(s => s).join(', ');

    logger.info({ contextString }, 'Search context string for matching');

    const failedCadastres: string[] = [];
    let lastError: Error | null = null;

    // Try up to maxAttempts times with different cadastre selections
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({ attempt, maxAttempts }, `Fallback attempt ${attempt}/${maxAttempts}`);
        await this.takeDebugScreenshot(`index-fallback-attempt-${attempt}`);

        // Always do a FULL page reload for each retry to ensure clean state
        // Don't use navigateToSearch as it might skip navigation if already on page
        const indexSearchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_02_indx_immbl.asp';
        logger.info({ attempt, url: indexSearchUrl }, 'Doing full page reload for clean state');

        // Force a complete page reload
        await this.page.goto(indexSearchUrl, {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        // Re-wrap page with AgentQL after navigation
        await this.wrapPage();

        // Wait for page to be fully ready
        await this.page.waitForTimeout(2000); // Give page time to stabilize

        try {
          await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 10000 });
          logger.info({ attempt }, 'Page reloaded and ready');
        } catch (waitError) {
          logger.error({ attempt, error: waitError }, 'Failed to wait for page elements after reload');
          throw new Error('Page failed to load properly after navigation');
        }

        // Step 1: Select Circonscription (same for all attempts)
        logger.info('Step 1: Selecting circonscription');
        const circumscriptionSelect = await this.page.$('#selCircnFoncr');
        if (circumscriptionSelect) {
          const currentText = await circumscriptionSelect.evaluate((el: any) =>
            el.options[el.selectedIndex]?.text?.trim() || ''
          );

          if (currentText !== config.circumscription) {
            const bestOption = await findBestSelectOption(circumscriptionSelect, config.circumscription);
            if (bestOption) {
              await circumscriptionSelect.selectOption({ value: bestOption.value });
              await this.page.waitForLoadState('networkidle', { timeout: 30000 });
              await this.page.waitForSelector('#selCadst', { state: 'visible', timeout: 10000 });
            }
          }
        }

        // Step 2: Intelligent Cadastre Selection (excluding failed ones)
        logger.info({ attempt, failedCadastres }, 'Step 2: Selecting cadastre with LLM');
        const cadastreSelect = await this.page.$('#selCadst');
        let selectedCadastre = '';

        if (cadastreSelect) {
          // Get all cadastre options
          const cadastreOptions = await extractSelectOptions(cadastreSelect);

          // Build exclude list - all previously failed cadastres
          let excludeList = [...failedCadastres];
          logger.info({
            attempt,
            excludeList,
            failedCadastres
          }, 'Exclude list for this attempt');

          // Log available options for debugging
          logger.info({
            attempt,
            availableOptions: cadastreOptions.map(o => o.text),
            contextString,
            excludeList
          }, 'Cadastre options and context for LLM');

          // Determine which cadastre to select
          let cadastreToSelect = null;
          let selectionReasoning = '';

          // Special handling for first attempt with Cadastre du Québec
          if (attempt === 1 && config.cadastre?.toLowerCase().includes('québec')) {
            // Try Cadastre du Québec first
            const quebecOption = cadastreOptions.find(opt =>
              opt.text.toLowerCase().includes('québec') || opt.value === '000001'
            );
            if (quebecOption) {
              cadastreToSelect = quebecOption;
              selectionReasoning = 'default Cadastre du Québec';
              logger.info({ selected: quebecOption.text }, 'Trying Cadastre du Québec first');
            }
          }

          // If no Quebec option or not attempt 1, use LLM
          if (!cadastreToSelect) {
            logger.info({ attempt }, 'Using LLM for cadastre selection');
            const { bestOption, reasoning } = await this.findBestOptionWithLLM(
              cadastreOptions,
              contextString,
              'cadastre',
              excludeList,
              attempt
            );

            if (bestOption) {
              cadastreToSelect = bestOption;
              selectionReasoning = reasoning;
            } else {
              logger.error({
                attempt,
                contextString,
                excludeList,
                availableOptionsCount: cadastreOptions.length,
                reasoning
              }, 'LLM could not find valid cadastre match');
              attemptedAlternatives.push(`Attempt ${attempt}: Cadastre=FAILED (${reasoning || 'no match found'})`);
              throw new Error(`No valid cadastre option found for attempt ${attempt}: ${reasoning}`);
            }
          }

          // Select the cadastre
          if (cadastreToSelect) {
            selectedCadastre = cadastreToSelect.text;
            attemptedAlternatives.push(`Attempt ${attempt}: Cadastre="${cadastreToSelect.text}" (${selectionReasoning})`);
            logger.info({
              attempt,
              selected: cadastreToSelect.text,
              value: cadastreToSelect.value,
              reasoning: selectionReasoning
            }, 'Selecting cadastre');

            await cadastreSelect.selectOption({ value: cadastreToSelect.value });
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
          }
        }

        // Step 3: Fill lot number
        logger.info('Step 3: Filling lot number');
        const lotNumberInput = await this.page.$('#txtNumrtLot');
        if (lotNumberInput) {
          await lotNumberInput.fill('');
          const lotNumberNoSpaces = config.lot_number?.replace(/\s+/g, '') || '';
          await lotNumberInput.fill(lotNumberNoSpaces);
        }

        // Step 4: ALWAYS process Designation Secondaire with full LLM logic
        logger.info({ selectedCadastre, attempt }, 'Step 4: Processing designation secondaire');

        // Wait for designation dropdown to update after cadastre selection
        await this.page.waitForTimeout(2000);

        let designationSelect = null;
        try {
          designationSelect = await this.page.$('#selDesgnSecnd');
        } catch (e) {
          logger.warn({ attempt, error: e }, 'Failed to query designation dropdown');
        }

        if (designationSelect) {
          try {
            // Get all designation options
            const designationOptions = await extractSelectOptions(designationSelect);

            logger.info({
              attempt,
              selectedCadastre,
              optionCount: designationOptions.length,
              allOptions: designationOptions.map(o => o.text),
              contextString
            }, 'Available designation options after cadastre selection');

            if (designationOptions.length > 0) {
              // ALWAYS use LLM to find best match (even if it might be none)
              logger.info({ attempt }, 'Calling LLM for designation selection');

              const { bestOption, reasoning } = await this.findBestOptionWithLLM(
                designationOptions,
                contextString,
                'designation',
                [selectedCadastre], // Pass selected cadastre as context
                attempt
              );

              if (bestOption) {
                attemptedAlternatives.push(`Attempt ${attempt}: Designation="${bestOption.text}" (${reasoning})`);
                logger.info({
                  attempt,
                  selected: bestOption.text,
                  value: bestOption.value,
                  reasoning
                }, 'LLM selected designation option');

                await designationSelect.selectOption({ value: bestOption.value });
              } else {
                // No match found - this is OK, it's optional
                attemptedAlternatives.push(`Attempt ${attempt}: Designation=none (LLM: no match in options)`);
                logger.info({
                  attempt,
                  reasoning,
                  contextString,
                  availableOptions: designationOptions.map(o => o.text)
                }, 'LLM found no matching designation - leaving empty (optional)');
              }
            } else {
              // No options available in dropdown
              attemptedAlternatives.push(`Attempt ${attempt}: Designation=none (empty dropdown)`);
              logger.info({ attempt }, 'Designation dropdown has no options');
            }
          } catch (designationError) {
            // Check if it's a page context error
            const errorMsg = designationError instanceof Error ? designationError.message : 'unknown';
            if (errorMsg.includes('Cannot find context') || errorMsg.includes('Protocol error')) {
              logger.warn({
                attempt,
                error: errorMsg
              }, 'Page context lost while processing designation - will note as unavailable');
              attemptedAlternatives.push(`Attempt ${attempt}: Designation=unavailable (page context lost)`);
            } else {
              logger.error({
                attempt,
                error: errorMsg
              }, 'Error processing designation secondaire, continuing anyway');
              attemptedAlternatives.push(`Attempt ${attempt}: Designation=error (${errorMsg})`);
            }
          }
        } else {
          attemptedAlternatives.push(`Attempt ${attempt}: Designation=N/A (dropdown not found)`);
          logger.info({ attempt }, 'Designation dropdown element not found on page');
        }

        // Step 5: Submit form
        logger.info({ attempt }, 'Step 5: Submitting form');
        const submitBtn = await this.page.$('input[type="submit"], input[value*="Soumettre"]');
        if (submitBtn) {
          await submitBtn.click();
        }

        // Wait for page response and check for errors
        await this.page.waitForTimeout(3000); // Give more time for page to respond

        // Check for specific error messages
        let errorElement = null;
        let errorText = null;

        try {
          // Make sure we're still on a valid page
          const currentUrl = this.page.url();
          logger.debug({ attempt, currentUrl }, 'Checking for errors on current page');

          errorElement = await this.page.$('td.contValErr');
          if (errorElement) {
            errorText = await errorElement.textContent();
          }
        } catch (e) {
          // Page context might have changed
          logger.warn({
            attempt,
            error: e instanceof Error ? e.message : e
          }, 'Failed to check for error element, page context might be lost');

          // If we can't check for errors, assume we need to retry
          lastError = new Error('Lost page context while checking for errors');
          continue;
        }

        if (errorText) {
          // Check for "inexistante" error which means we should try another cadastre
          if (errorText.includes('inexistante') ||
              errorText.includes('Aucune information ne correspond')) {

            logger.warn({
              attempt,
              errorText,
              selectedCadastre,
              attemptedSoFar: attemptedAlternatives
            }, 'Document not found with this cadastre, will retry');

            // Add this cadastre to failed list (avoid duplicates)
            if (selectedCadastre && !failedCadastres.includes(selectedCadastre)) {
              failedCadastres.push(selectedCadastre);
              logger.info({
                attempt,
                failedCadastres,
                selectedCadastre
              }, 'Added cadastre to failed list');
            }

            lastError = new Error(errorText || 'Document not found');

            // Continue to next attempt
            continue;
          }

          // For other validation errors, throw
          throw new DataValidationError(
            `Validation error: ${errorText}`,
            errorText || undefined
          );
        }

        // If no error, document should be loading
        logger.info({
          attempt,
          successfulCadastre: selectedCadastre,
          attemptedAlternatives
        }, 'No validation errors, proceeding with document download');
        return await this.waitForDocumentAndDownload(config);

      } catch (error) {
        lastError = error as Error;
        logger.error({
          attempt,
          error: error instanceof Error ? error.message : error,
          failedCadastres,
          attemptedAlternatives
        }, `Attempt ${attempt} failed`);

        // If it's a page navigation/context error, log it
        if (error instanceof Error &&
            (error.message.includes('Cannot find context') ||
             error.message.includes('Protocol error') ||
             error.message.includes('Execution context was destroyed') ||
             error.message.includes('Target closed'))) {
          logger.warn({
            attempt,
            errorType: 'page_context_lost'
          }, 'Page context lost, will retry with fresh navigation on next attempt');
        }

        // Always check if we've reached max attempts before continuing
        if (attempt >= maxAttempts) {
          const detailedError = new Error(
            `All ${maxAttempts} attempts failed.\n` +
            `Last error: ${lastError?.message || 'Unknown error'}\n` +
            `Attempted alternatives:\n${attemptedAlternatives.join('\n')}`
          );
          throw detailedError;
        }

        // Continue to next attempt (the loop will reload the page fresh)
      }
    }

    // Should not reach here, but just in case
    throw new Error(
      `Fallback failed after ${maxAttempts} attempts.\n` +
      `Attempted alternatives:\n${attemptedAlternatives.join('\n')}`
    );
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
      // Check if this is a validation error that should trigger fallback
      if (error instanceof DataValidationError &&
          (error.message.includes('Aucune information ne correspond aux critères de sélection') ||
           error.message.includes('inexistante'))) {

        logger.info({
          error: error.message,
          config
        }, '⚠️ Document not found with provided criteria, starting intelligent fallback');

        // Try the intelligent fallback approach with retry logic
        const attemptedAlternatives: string[] = [];
        return await this.extractIndexWithFallback(config, attemptedAlternatives, 3);
      }

      // For other errors, throw as before
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
      
      // NEW: Handle document selection if similar documents are found
      await this.handleActeDocumentSelection();
      
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
      
      // NEW: Handle the missing intermediate steps for plans cadastraux
      await this.handlePlansCadastrauxIntermediateSteps();
      
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

  /**
   * Handle the missing intermediate steps specific to plans cadastraux extraction
   * Step 2: Document selection page (if present)
   * Step 3: Confirmation page (if present)
   */
  private async handlePlansCadastrauxIntermediateSteps(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('🔍 Checking for plans cadastraux intermediate steps');
    
    // Wait a moment for page to load after form submission
    await this.page.waitForTimeout(3000);
    await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    
    const currentUrl = this.page.url();
    logger.info({ currentUrl }, '📍 Current URL after form submission');
    
    // Take a screenshot to see what page we're on
    await this.takeDebugScreenshot('plans-cadastraux-after-form-submission');

    // Step 2: Handle document selection page 
    // URL: https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_08/pf_13_01_08_selct_plan_cadst.asp
    if (currentUrl.includes('pf_13_01_08_selct_plan_cadst') || currentUrl.includes('selct_plan_cadst')) {
      logger.info('Document selection page detected - Step 2');
      await this.takeDebugScreenshot('plans-cadastraux-step2-document-selection');
      
      // Look for document selection options (radio buttons, checkboxes, or links)
      let documentSelected = false;
      
      // Try different selection methods
      const selectionMethods = [
        // Method 1: Radio buttons (most common)
        async () => {
          const radioButtons = await this.page!.$$('input[type="radio"]');
          if (radioButtons && radioButtons.length > 0) {
            logger.info({ count: radioButtons.length }, 'Found radio buttons for document selection');
            // Select the first or most appropriate option
            await radioButtons[0].click();
            logger.info('Selected first radio button option');
            return true;
          }
          return false;
        },
        
        // Method 2: Checkboxes
        async () => {
          const checkboxes = await this.page!.$$('input[type="checkbox"]');
          if (checkboxes && checkboxes.length > 0) {
            logger.info({ count: checkboxes.length }, 'Found checkboxes for document selection');
            await checkboxes[0].click();
            logger.info('Selected first checkbox option');
            return true;
          }
          return false;
        },
        
        // Method 3: Links or buttons with document-related text
        async () => {
          const docLinks = await this.page!.$$('a, button');
          for (const link of docLinks) {
            const text = await link.textContent();
            if (text && (text.includes('Plan') || text.includes('Document') || text.includes('Sélectionner'))) {
              logger.info({ linkText: text }, 'Found document selection link');
              await link.click();
              return true;
            }
          }
          return false;
        },
        
        // Method 4: AI-based selection
        async () => {
          try {
            const selectionQuery = `{
              documentOption(description: "Option to select a document, plan, or cadastral item")
              selectButton(description: "Button or link to select a document")
            }`;
            
            const { documentOption, selectButton } = await this.queryWithAI(selectionQuery, 'document-selection');
            
            if (documentOption) {
              await documentOption.click();
              logger.info('Selected document using AI - documentOption');
              return true;
            } else if (selectButton) {
              await selectButton.click();
              logger.info('Selected document using AI - selectButton');
              return true;
            }
          } catch (aiError) {
            logger.warn({ error: aiError }, 'AI document selection failed');
          }
          return false;
        }
      ];
      
      // Try each selection method
      for (const method of selectionMethods) {
        try {
          if (await method()) {
            documentSelected = true;
            break;
          }
        } catch (error) {
          logger.warn({ error }, 'Document selection method failed, trying next');
        }
      }
      
      if (!documentSelected) {
        logger.warn('No document selection method worked, continuing anyway');
      }
      
      // Click Soumettre button after selection
      logger.info('Looking for submit button on document selection page');
      let submitClicked = false;
      
      // Try direct selector first
      const submitSelectors = [
        'input[type="submit"]',
        'button[type="submit"]', 
        'input[value*="Soumettre"]',
        'button:has-text("Soumettre")',
        'input[value*="Continuer"]',
        'button:has-text("Continuer")'
      ];
      
      for (const selector of submitSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            submitClicked = true;
            logger.info({ selector }, 'Clicked submit button on document selection page');
            break;
          }
        } catch (e) {
          // Continue trying other selectors
        }
      }
      
      if (!submitClicked) {
        // Fallback to AI
        try {
          const submitQuery = `{
            submitButton(description: "Submit button with text 'Soumettre', 'Continuer', or similar")
          }`;
          const { submitButton } = await this.queryWithAI(submitQuery, 'document-selection-submit');
          if (submitButton) {
            await submitButton.click();
            submitClicked = true;
            logger.info('Clicked submit button using AI on document selection page');
          }
        } catch (aiError) {
          logger.warn('Could not find submit button on document selection page');
        }
      }
      
      if (submitClicked) {
        // Wait for page to load after submission
        await this.page.waitForTimeout(2000);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
        logger.info('Document selection step completed');
      }
    }

    // Step 3: Handle confirmation page
    // URL: https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_13/pf_13_01_13_confr_demnd.asp
    const updatedUrl = this.page.url();
    logger.info({ updatedUrl }, 'Checking for confirmation page - Step 3');
    
    if (updatedUrl.includes('pf_13_01_13_confr_demnd') || updatedUrl.includes('confr_demnd')) {
      logger.info('Confirmation page detected - Step 3');
      await this.takeDebugScreenshot('plans-cadastraux-step3-confirmation');
      
      // Look for the specific Confirmer button
      // <input class="BoutnStand" type="submit" id="btnConfr" name="btnConfr" accesskey="C" tabindex="11" value="Confirmer">
      let confirmerClicked = false;
      
      const confirmerSelectors = [
        '#btnConfr',                                    // Exact ID
        'input[name="btnConfr"]',                      // By name
        'input[value="Confirmer"]',                    // By value
        'input.BoutnStand[value="Confirmer"]',         // By class and value
        'input[type="submit"][value="Confirmer"]',     // By type and value
        'input[type="submit"]:has-text("Confirmer")',  // Playwright text selector
        'button:has-text("Confirmer")',                // Button alternative
      ];
      
      // Try direct selectors first
      for (const selector of confirmerSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            confirmerClicked = true;
            logger.info({ selector }, 'Clicked Confirmer button');
            break;
          }
        } catch (e) {
          logger.debug({ selector, error: e instanceof Error ? e.message : e }, 'Confirmer selector failed');
        }
      }
      
      if (!confirmerClicked) {
        // Fallback to AI
        try {
          const confirmerQuery = `{
            confirmerButton(description: "Button to confirm with text 'Confirmer' or similar")
            confirmButton(description: "Confirmation button")
          }`;
          
          const { confirmerButton, confirmButton } = await this.queryWithAI(confirmerQuery, 'confirmation-button');
          
          if (confirmerButton) {
            await confirmerButton.click();
            confirmerClicked = true;
            logger.info('Clicked Confirmer button using AI');
          } else if (confirmButton) {
            await confirmButton.click();
            confirmerClicked = true;
            logger.info('Clicked confirm button using AI');
          }
        } catch (aiError) {
          logger.warn({ error: aiError }, 'AI could not find Confirmer button');
        }
      }
      
      if (!confirmerClicked) {
        logger.warn('Could not find or click Confirmer button, continuing anyway');
      } else {
        // Wait for page to load after confirmation
        await this.page.waitForTimeout(2000);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
        logger.info('Confirmation step completed');
      }
    }
    
    // Log final URL after all intermediate steps
    const finalUrl = this.page.url();
    logger.info({ finalUrl }, '✅ Completed plans cadastraux intermediate steps');
    
    // Take final screenshot to see where we ended up
    await this.takeDebugScreenshot('plans-cadastraux-final-page-before-document-wait');
  }

  private async handleActeDocumentSelection(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    
    logger.info('🔍 Checking for "Résultat de la recherche" section with similar documents for actes');
    
    try {
      // Wait a bit to ensure the page has rendered after form submission
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
      
      // Take a screenshot to see the current state
      await this.takeDebugScreenshot('actes-after-rechercher');
      
      // Look for the "Résultat de la recherche" section
      // This appears as a new section under "Critères de recherche" when similar documents are found
      const searchResultsSelector = 'table:has-text("Résultat de la recherche"), td:has-text("Résultat de la recherche")';
      const searchResultsSection = await this.page.$(searchResultsSelector);
      
      if (!searchResultsSection) {
        logger.info('No "Résultat de la recherche" section found - assuming direct document found');
        return;
      }
      
      logger.info('✅ Found "Résultat de la recherche" section - handling document selection');
      
      // Find the radio buttons for document selection
      // Try multiple methods to find and select the most appropriate document
      
      let selectionMade = false;
      
      // Method 1: Use AI to find and select the most appropriate radio button, avoiding paper documents
      try {
        const radioQuery = `{
          radioButtons(description: "radio buttons for document selection in search results")
          submitButton(description: "button with text 'Soumettre' to submit the selection")
          paperDocumentImages(description: "images with src containing 'BPD.GIF' indicating paper documents")
        }`;
        
        const { radioButtons, submitButton } = await this.queryWithAI(radioQuery, 'actes-document-selection');
        
        if (radioButtons && radioButtons.length > 0) {
          logger.info({ count: radioButtons.length }, 'Found radio buttons using AI');
          
          // Find the best radio button that doesn't correspond to a paper document
          let selectedRadio = null;
          
          for (const radio of radioButtons) {
            // Check if this radio button is associated with a paper document
            const radioRow = await radio.evaluateHandle((el: any) => {
              // Find the closest table row (tr) containing this radio button
              let current = el;
              while (current && current.tagName !== 'TR') {
                current = current.parentElement;
              }
              return current;
            });
            
            if (radioRow) {
              // Check if this row contains a BPD.GIF image (paper document)
              const hasPaperDoc = await radioRow.evaluate((row: any) => {
                const imgs = row.querySelectorAll('img');
                for (const img of imgs) {
                  if (img.src && img.src.includes('BPD.GIF')) {
                    return true;
                  }
                }
                return false;
              });
              
              if (!hasPaperDoc) {
                selectedRadio = radio;
                logger.info('Found suitable radio button (not a paper document) using AI');
                break;
              } else {
                logger.info('Skipping radio button associated with paper document (BPD.GIF)');
              }
            }
          }
          
          if (selectedRadio) {
            await selectedRadio.click();
            logger.info('Selected non-paper document radio button using AI');
            
            // Click submit button
            if (submitButton) {
              await submitButton.click();
              selectionMade = true;
              logger.info('Clicked Soumettre button using AI');
            }
          } else {
            logger.warn('All available options appear to be paper documents, will try direct selector method');
          }
        }
      } catch (error) {
        logger.debug('AI method failed for document selection, trying direct selectors');
      }
      
      // Method 2: Direct selector fallback with paper document avoidance
      if (!selectionMade) {
        // Look for radio buttons using various selectors
        const radioSelectors = [
          'input[type="radio"]',
          'input[name*="radio"]', 
          'input[name*="selection"]',
          'table tr input[type="radio"]'
        ];
        
        for (const selector of radioSelectors) {
          const radioButtons = await this.page.$$(selector);
          if (radioButtons && radioButtons.length > 0) {
            logger.info({ selector, count: radioButtons.length }, 'Found radio buttons using direct selector');
            
            // Find the best radio button that doesn't correspond to a paper document
            let selectedRadio = null;
            
            for (const radio of radioButtons) {
              // Check if this radio button is in a row with BPD.GIF image
              const hasPaperDoc = await radio.evaluate((radioEl: any) => {
                // Find the closest table row containing this radio button
                let row = radioEl;
                while (row && row.tagName !== 'TR') {
                  row = row.parentElement;
                }
                
                if (row) {
                  // Check if this row contains a BPD.GIF image
                  const imgs = row.querySelectorAll('img');
                  for (const img of imgs) {
                    if (img.src && img.src.includes('BPD.GIF')) {
                      return true;
                    }
                  }
                }
                return false;
              });
              
              if (!hasPaperDoc) {
                selectedRadio = radio;
                logger.info({ selector }, 'Found suitable radio button (not a paper document) using direct selector');
                break;
              } else {
                logger.info({ selector }, 'Skipping radio button associated with paper document (BPD.GIF)');
              }
            }
            
            if (selectedRadio) {
              await selectedRadio.click();
              logger.info({ selector }, 'Selected non-paper document radio button using direct selector');
              
              // Look for submit button
              const submitSelectors = [
                'input[value*="Soumettre"]',
                'button:has-text("Soumettre")',
                'input[type="submit"]',
                'button[type="submit"]'
              ];
              
              for (const submitSelector of submitSelectors) {
                const submitBtn = await this.page.$(submitSelector);
                if (submitBtn) {
                  await submitBtn.click();
                  selectionMade = true;
                  logger.info({ submitSelector }, 'Clicked Soumettre button using direct selector');
                  break;
                }
              }
              
              if (selectionMade) break;
            } else {
              logger.warn({ selector }, 'All radio button options appear to be paper documents');
            }
          }
        }
      }
      
      if (!selectionMade) {
        logger.error('Could not find or select document from similar results');
        await this.takeDebugScreenshot('actes-document-selection-failed');
        throw new Error('Failed to select document from similar search results');
      }
      
      // Wait for the page to process the selection
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      
      logger.info('✅ Document selection completed for actes');
      await this.takeDebugScreenshot('actes-after-document-selection');
      
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : error }, 'Error in actes document selection');
      await this.takeDebugScreenshot('actes-document-selection-error');
      
      // Don't throw the error - let the process continue in case the selection wasn't needed
      logger.info('Continuing despite document selection error');
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
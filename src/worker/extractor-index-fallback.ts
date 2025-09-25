import { Page } from 'playwright';
import { logger } from '../utils/logger';
import { ExtractionConfig } from '../types';

interface SelectOption {
  value: string;
  text: string;
}

interface FallbackAttempt {
  attemptNumber: number;
  cadastre: string;
  designation: string;
  reasoning: string;
  result: 'success' | 'failed';
  errorMessage?: string;
}

/**
 * Clean implementation of intelligent fallback for index extraction
 * when "La fiche immobilière demandée est inexistante" error occurs
 */
export class IndexFallbackHandler {
  private attempts: FallbackAttempt[] = [];

  constructor(
    private page: Page,
    private config: ExtractionConfig,
    private openaiApiKey?: string
  ) {}

  /**
   * Main entry point for fallback logic
   */
  async executeWithRetries(maxAttempts: number = 3): Promise<void> {
    // Step 1: Create context string from all available information
    const contextString = this.createContextString();
    logger.info({ contextString }, 'Created context string for fallback');

    for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
      try {
        logger.info({ attemptNum, maxAttempts }, `Starting fallback attempt ${attemptNum}/${maxAttempts}`);

        // Step D: Always navigate to fresh index page
        await this.navigateToFreshIndexPage();

        // Step 2: Select circonscription (same for all attempts)
        await this.selectCirconscription();

        // Step 3: Get cadastre options and select best match
        const cadastreSelected = await this.selectCadastreWithLLM(contextString, attemptNum);

        // Step 4: Get designation options and select best match
        const designationSelected = await this.selectDesignationWithLLM(contextString, attemptNum);

        // Step 5: Fill lot number
        await this.fillLotNumber();

        // Step 6: Submit form
        await this.submitForm();

        // Step 7: Check for errors
        const hasError = await this.checkForErrors();

        if (!hasError) {
          // Success! Document is loading or loaded
          this.attempts.push({
            attemptNumber: attemptNum,
            cadastre: cadastreSelected.text,
            designation: designationSelected?.text || 'none',
            reasoning: `${cadastreSelected.reasoning} | ${designationSelected?.reasoning || 'no designation'}`,
            result: 'success'
          });

          logger.info({
            attemptNum,
            cadastre: cadastreSelected.text,
            designation: designationSelected?.text,
            url: this.page.url()
          }, '✅ Fallback attempt successful - form submitted, no errors detected');

          // IMPORTANT: Don't do anything else here!
          // The page is now in the correct state for the document to load
          // The calling code will handle waitForDocumentAndDownload
          return; // Success, exit
        }

        // Failed - record attempt
        const errorMsg = await this.getErrorMessage();
        this.attempts.push({
          attemptNumber: attemptNum,
          cadastre: cadastreSelected.text,
          designation: designationSelected?.text || 'none',
          reasoning: `${cadastreSelected.reasoning} | ${designationSelected?.reasoning || 'no designation'}`,
          result: 'failed',
          errorMessage: errorMsg
        });

        logger.warn({
          attemptNum,
          cadastre: cadastreSelected.text,
          designation: designationSelected?.text,
          error: errorMsg
        }, 'Fallback attempt failed');

      } catch (error) {
        logger.error({ attemptNum, error }, 'Error during fallback attempt');

        // Record error attempt
        this.attempts.push({
          attemptNumber: attemptNum,
          cadastre: 'error',
          designation: 'error',
          reasoning: 'Exception during attempt',
          result: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // All attempts failed - throw detailed error
    throw new Error(this.buildFinalErrorMessage());
  }

  /**
   * Step 1: Create context string from input data
   */
  private createContextString(): string {
    return [
      this.config.lot_number || '',
      this.config.circumscription || '',
      this.config.cadastre || '',
      this.config.designation_secondaire || ''
    ].join(', ');
  }

  /**
   * Step D: Navigate to fresh index page
   */
  private async navigateToFreshIndexPage(): Promise<void> {
    const indexUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_02_indx_immbl.asp';
    logger.info('Navigating to fresh index page');

    await this.page.goto(indexUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for form to be ready
    await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 10000 });
  }

  /**
   * Step 2: Select circonscription
   */
  private async selectCirconscription(): Promise<void> {
    logger.info({ target: this.config.circumscription }, 'Selecting circonscription');

    const select = await this.page.$('#selCircnFoncr');
    if (!select) throw new Error('Circonscription dropdown not found');

    // Get all options
    const options = await this.extractSelectOptions(select);

    // First try simple fuzzy match
    let bestMatch = this.findBestMatch(options, this.config.circumscription);

    // If no match and we have LLM, try intelligent matching
    if (!bestMatch && this.openaiApiKey) {
      logger.info('No direct match for circonscription, trying LLM');

      const contextString = this.createContextString();
      const llmMatch = await this.findBestOptionWithLLM(
        options,
        contextString,
        'circonscription' as any, // We're extending the type here
        [],
        1
      );

      if (llmMatch) {
        bestMatch = options.find(o => o.value === llmMatch.value) || null;
        logger.info({
          selected: llmMatch.text,
          reasoning: llmMatch.reasoning
        }, 'LLM found circonscription match');
      }
    }

    if (!bestMatch) {
      // Log available options for debugging
      logger.error({
        target: this.config.circumscription,
        availableOptions: options.map(o => o.text)
      }, 'No matching circonscription found');

      throw new Error(`No matching circonscription found for: ${this.config.circumscription}. Available: ${options.map(o => o.text).join(', ')}`);
    }

    await select.selectOption({ value: bestMatch.value });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    await this.page.waitForSelector('#selCadst', { state: 'visible', timeout: 10000 });
  }

  /**
   * Step 3: Select cadastre using LLM
   */
  private async selectCadastreWithLLM(
    contextString: string,
    attemptNum: number
  ): Promise<{ text: string; value: string; reasoning: string }> {
    logger.info({ attemptNum }, 'Selecting cadastre with LLM');

    const select = await this.page.$('#selCadst');
    if (!select) throw new Error('Cadastre dropdown not found');

    // Get all available options
    const options = await this.extractSelectOptions(select);
    logger.info({
      optionCount: options.length,
      options: options.map(o => o.text)
    }, 'Available cadastre options');

    // Get previously tried cadastres to exclude
    const excludeList = this.attempts
      .filter(a => a.result === 'failed')
      .map(a => a.cadastre);

    // Use LLM to find best match
    const bestMatch = await this.findBestOptionWithLLM(
      options,
      contextString,
      'cadastre',
      excludeList,
      attemptNum
    );

    if (!bestMatch) {
      throw new Error('Could not find valid cadastre option');
    }

    await select.selectOption({ value: bestMatch.value });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });

    return bestMatch;
  }

  /**
   * Step 4: Select designation using LLM
   */
  private async selectDesignationWithLLM(
    contextString: string,
    attemptNum: number
  ): Promise<{ text: string; value: string; reasoning: string } | null> {
    logger.info({ attemptNum }, 'Selecting designation with LLM');

    // Wait for designation dropdown to update after cadastre selection
    await this.page.waitForTimeout(2000);

    const select = await this.page.$('#selDesgnSecnd');
    if (!select) {
      logger.info('Designation dropdown not present');
      return null;
    }

    // Get all available options
    const options = await this.extractSelectOptions(select);
    logger.info({
      optionCount: options.length,
      options: options.map(o => o.text)
    }, 'Available designation options');

    if (options.length === 0) {
      logger.info('No designation options available');
      return null;
    }

    // Get previously tried designations for current cadastre
    const currentCadastre = this.attempts[this.attempts.length - 1]?.cadastre;
    const excludeList = this.attempts
      .filter(a => a.result === 'failed' && a.cadastre === currentCadastre)
      .map(a => a.designation)
      .filter(d => d !== 'none');

    // Use LLM to find best match
    const bestMatch = await this.findBestOptionWithLLM(
      options,
      contextString,
      'designation',
      excludeList,
      attemptNum
    );

    if (!bestMatch) {
      logger.info('No matching designation found - leaving empty (optional field)');
      return null;
    }

    await select.selectOption({ value: bestMatch.value });
    await this.page.waitForTimeout(500);

    return bestMatch;
  }

  /**
   * Step 5: Fill lot number
   */
  private async fillLotNumber(): Promise<void> {
    const input = await this.page.$('#txtNumrtLot');
    if (!input) throw new Error('Lot number input not found');

    const lotNumber = this.config.lot_number?.replace(/\s+/g, '') || '';
    await input.fill('');
    await input.fill(lotNumber);

    logger.info({ lotNumber }, 'Filled lot number');
  }

  /**
   * Step 6: Submit form
   */
  private async submitForm(): Promise<void> {
    logger.info('Submitting form');

    const submitBtn = await this.page.$('input[type="submit"], input[value*="Soumettre"]');
    if (!submitBtn) throw new Error('Submit button not found');

    // Click submit and wait for response
    await submitBtn.click();

    // Wait for page to process the submission
    // We use multiple strategies to handle different response scenarios:
    // 1. Navigation to a new page (document found)
    // 2. Page update with error message (document not found)
    // 3. Timeout fallback
    await Promise.race([
      this.page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }).catch(() => null),
      this.page.waitForLoadState('networkidle', {
        timeout: 15000
      }).catch(() => null),
      this.page.waitForTimeout(5000)
    ]);

    // Additional wait to ensure page is stable
    await this.page.waitForTimeout(2000);

    logger.info({ url: this.page.url() }, 'Form submitted, page loaded');
  }

  /**
   * Step 7: Check for errors
   */
  private async checkForErrors(): Promise<boolean> {
    try {
      // Check for error elements
      const errorSelectors = [
        'td.contValErr',
        '.contValErr',
        'td:has-text("Aucune information")',
        'td:has-text("inexistante")'
      ];

      for (const selector of errorSelectors) {
        const element = await this.page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim()) {
            logger.info({ errorText: text.trim() }, 'Found error on page');
            return true;
          }
        }
      }

      // Check page content
      const hasError = await this.page.evaluate(() => {
        const body = (globalThis as any).document?.body?.innerText || '';
        return body.includes('inexistante') || body.includes('Aucune information ne correspond');
      }).catch(() => false);

      return hasError;

    } catch (error) {
      logger.warn({ error }, 'Error checking for page errors');
      return false;
    }
  }

  /**
   * Get error message from page
   */
  private async getErrorMessage(): Promise<string> {
    try {
      const errorElement = await this.page.$('td.contValErr, .contValErr');
      if (errorElement) {
        return await errorElement.textContent() || 'Unknown error';
      }
      return 'Document not found';
    } catch {
      return 'Error checking page';
    }
  }

  /**
   * Use LLM to find best matching option
   */
  private async findBestOptionWithLLM(
    options: SelectOption[],
    contextString: string,
    dropdownType: 'cadastre' | 'designation' | 'circonscription',
    excludeOptions: string[],
    _attemptNumber: number
  ): Promise<{ text: string; value: string; reasoning: string } | null> {

    if (!this.openaiApiKey) {
      // Fallback to simple fuzzy matching
      let target = '';
      if (dropdownType === 'cadastre') target = this.config.cadastre || '';
      else if (dropdownType === 'designation') target = this.config.designation_secondaire || '';
      else if (dropdownType === 'circonscription') target = this.config.circumscription || '';

      const filtered = options.filter(o => !excludeOptions.includes(o.text));
      const match = this.findBestMatch(filtered, target);
      return match ? { ...match, reasoning: 'fuzzy match' } : null;
    }

    try {
      // Filter out excluded options
      const filteredOptions = options.filter(opt => !excludeOptions.includes(opt.text));

      if (filteredOptions.length === 0) {
        return null;
      }

      const optionsList = filteredOptions
        .map((opt, idx) => `${idx}: "${opt.text}"`)
        .join('\n');

      let prompt = '';

      if (dropdownType === 'circonscription') {
        prompt = `Context: "${contextString}"
           Format: [document_number, circonscription, cadastre, designation_secondaire]

           Available options:
           ${optionsList}

           Find the BEST matching circonscription option. Look for city/municipality names.
           Handle variations like "St-" vs "Saint-", accents, etc.

           Return JSON: {"index": <number>, "reasoning": "<why>", "matched_text": "<from context>"}`;
      } else if (dropdownType === 'cadastre') {
        prompt = `Context: "${contextString}"
           Format: [document_number, circonscription, cadastre, designation_secondaire]

           Available options:
           ${optionsList}

           Find the BEST matching cadastre option. Look for patterns like:
           - Parish names (Paroisse de X)
           - Canton names (Canton de X)
           - Village/City names
           - Match anywhere in the context string

           Return JSON: {"index": <number>, "reasoning": "<why>", "matched_text": "<from context>"}`;
      } else {
        // designation
        prompt = `Context: "${contextString}"
           Format: [document_number, circonscription, cadastre, designation_secondaire]

           Available options:
           ${optionsList}

           Find the BEST matching designation option or return null if none match.

           Return JSON: {"index": <number or null>, "reasoning": "<why>"}`;
      }

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      const data = await response.json() as any;
      const result = JSON.parse(data.choices[0].message.content);

      if (result.index !== null && result.index >= 0 && result.index < filteredOptions.length) {
        const selected = filteredOptions[result.index];
        return {
          text: selected.text,
          value: selected.value,
          reasoning: result.reasoning || 'LLM selection'
        };
      }

      return null;

    } catch (error) {
      logger.error({ error, dropdownType }, 'LLM selection failed');
      return null;
    }
  }

  /**
   * Extract options from a select element
   */
  private async extractSelectOptions(select: any): Promise<SelectOption[]> {
    return await select.evaluate((el: any) => {
      const options: SelectOption[] = [];
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (opt.value && opt.value !== '000000') { // Skip empty option
          options.push({
            value: opt.value,
            text: opt.text.trim()
          });
        }
      }
      return options;
    });
  }

  /**
   * Simple fuzzy matching fallback
   */
  private findBestMatch(options: SelectOption[], target: string): SelectOption | null {
    if (!target) return null;

    const targetLower = target.toLowerCase();

    // Exact match
    const exact = options.find(o => o.text.toLowerCase() === targetLower);
    if (exact) return exact;

    // Contains match
    const contains = options.find(o => o.text.toLowerCase().includes(targetLower));
    if (contains) return contains;

    // Partial match
    const partial = options.find(o => targetLower.includes(o.text.toLowerCase()));
    if (partial) return partial;

    return null;
  }

  /**
   * Build final error message with all attempts
   */
  private buildFinalErrorMessage(): string {
    const attemptDetails = this.attempts
      .map(a => `Attempt ${a.attemptNumber}: Cadastre="${a.cadastre}", Designation="${a.designation}" (${a.reasoning})`)
      .join('\n');

    return `All ${this.attempts.length} fallback attempts failed.\n${attemptDetails}`;
  }
}
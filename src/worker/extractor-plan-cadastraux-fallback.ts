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
 * Intelligent fallback handler for plan_cadastraux extraction
 * when validation errors or "inexistante" errors occur.
 * 
 * Similar to IndexFallbackHandler, tries different combinations of:
 * - Cadastre options (using LLM to select best match)
 * - Designation secondaire options (using LLM to select best match)
 * 
 * The lot_number and circonscription remain constant across all attempts.
 */
export class PlanCadastrauxFallbackHandler {
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
    const contextString = this.createContextString();
    logger.info({ contextString }, 'Created context string for plan_cadastraux fallback');

    for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
      try {
        logger.info({ attemptNum, maxAttempts }, `Starting plan_cadastraux fallback attempt ${attemptNum}/${maxAttempts}`);

        // Step 1: Navigate to fresh plans cadastraux page
        await this.navigateToFreshPlansCadastrauxPage();

        // Step 2: Select circonscription (same for all attempts)
        await this.selectCirconscription();

        // Step 3: Select cadastre with LLM
        const cadastreSelected = await this.selectCadastreWithLLM(contextString, attemptNum);

        // Step 4: Fill lot number (same for all attempts)
        await this.fillLotNumber();

        // Step 5: Select designation secondaire with LLM (if dropdown exists)
        const designationSelected = await this.selectDesignationWithLLM(contextString, attemptNum);

        // Step 6: Submit form
        await this.submitForm();

        // Step 7: Check for errors
        const hasError = await this.checkForErrors();

        if (!hasError) {
          // Success!
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
          }, '✅ Plan cadastraux fallback successful');

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
        }, 'Plan cadastraux fallback attempt failed');

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ attemptNum, error: errorMessage }, 'Error during plan_cadastraux fallback attempt');

        this.attempts.push({
          attemptNumber: attemptNum,
          cadastre: 'error',
          designation: 'error',
          reasoning: 'Exception during attempt',
          result: 'failed',
          errorMessage
        });
      }
    }

    // All attempts failed
    throw new Error(this.buildFinalErrorMessage());
  }

  private createContextString(): string {
    return [
      this.config.lot_number || '',
      this.config.circumscription || '',
      this.config.cadastre || '',
      this.config.designation_secondaire || ''
    ].filter(s => s).join(', ');
  }

  private async navigateToFreshPlansCadastrauxPage(): Promise<void> {
    const url = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_11/pf_13_01_11_08_reqst.asp';
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 30000 });
  }

  private async selectCirconscription(): Promise<void> {
    logger.info({ circonscription: this.config.circumscription }, 'Selecting circonscription');
    await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 30000 });
    
    const select = await this.page.$('#selCircnFoncr');
    if (!select) {
      throw new Error('Circonscription dropdown not found');
    }
    
    const bestOption = await this.findBestSelectOption(select, this.config.circumscription);
    if (bestOption) {
      await this.page.selectOption('#selCircnFoncr', { value: bestOption.value });
      await this.page.waitForSelector('#selCadst', { state: 'visible', timeout: 10000 });
    } else {
      throw new Error(`No matching circonscription found for: ${this.config.circumscription}`);
    }
  }

  private async selectCadastreWithLLM(contextString: string, attemptNum: number): Promise<SelectOption & { reasoning: string }> {
    logger.info({ attemptNum }, 'Selecting cadastre with LLM');
    
    const cadastreSelect = await this.page.$('#selCadst');
    if (!cadastreSelect) {
      throw new Error('Cadastre dropdown not found');
    }

    const options = await this.extractSelectOptions(cadastreSelect);
    const previouslyTried = this.attempts.map(a => a.cadastre);
    
    const selected = await this.selectBestOptionWithLLM(
      options,
      contextString,
      'cadastre',
      previouslyTried,
      attemptNum
    );

    if (!selected) {
      throw new Error('No suitable cadastre option found');
    }

    await this.page.selectOption('#selCadst', { value: selected.value });
    await this.page.waitForTimeout(1000);

    return selected;
  }

  private async fillLotNumber(): Promise<void> {
    logger.info({ lotNumber: this.config.lot_number }, 'Filling lot number');
    const lotNumberNoSpaces = this.config.lot_number?.replace(/\s+/g, '') || '';
    await this.page.fill('#txtNumrtLot', '');
    await this.page.fill('#txtNumrtLot', lotNumberNoSpaces);
  }

  private async selectDesignationWithLLM(contextString: string, attemptNum: number): Promise<(SelectOption & { reasoning: string }) | null> {
    const designationSelect = await this.page.$('#selDesgnSecnd');
    if (!designationSelect) {
      logger.info('No designation secondaire dropdown found');
      return null;
    }

    const options = await this.extractSelectOptions(designationSelect);
    if (options.length <= 1) {
      logger.info('No designation options available');
      return null;
    }

    const previouslyTried = this.attempts.map(a => a.designation);
    
    const selected = await this.selectBestOptionWithLLM(
      options,
      contextString,
      'designation',
      previouslyTried,
      attemptNum
    );

    if (selected) {
      await this.page.selectOption('#selDesgnSecnd', { value: selected.value });
      await this.page.waitForTimeout(500);
    }

    return selected;
  }

  private async submitForm(): Promise<void> {
    logger.info('Submitting form');
    const submitBtn = await this.page.$('input[type="submit"], button[type="submit"], input[value*="Soumettre"]');
    if (!submitBtn) {
      throw new Error('Submit button not found');
    }
    await submitBtn.click();
    await this.page.waitForTimeout(3000);
    await this.page.waitForLoadState('networkidle', { timeout: 15000 });
  }

  private async checkForErrors(): Promise<boolean> {
    const errorElement = await this.page.$('td.contValErr');
    if (errorElement) {
      const errorText = await errorElement.textContent();
      logger.info({ errorText }, 'Validation error detected');
      
      // Special case: "lot inactif" is not treated as an error for plans cadastraux
      if (errorText?.includes('est inactif')) {
        logger.info('Lot inactif detected - not treating as error');
        return false;
      }
      
      return true;
    }
    return false;
  }

  private async getErrorMessage(): Promise<string> {
    const errorElement = await this.page.$('td.contValErr');
    if (errorElement) {
      return (await errorElement.textContent()) || 'Unknown error';
    }
    return 'No error message found';
  }

  private buildFinalErrorMessage(): string {
    const attemptsSummary = this.attempts.map(a => 
      `Attempt ${a.attemptNumber}: cadastre="${a.cadastre}", designation="${a.designation}" - ${a.result} ${a.errorMessage ? `(${a.errorMessage})` : ''}`
    ).join('\n');

    return `Plan cadastraux fallback failed after ${this.attempts.length} attempts:\n${attemptsSummary}`;
  }

  private async extractSelectOptions(selectElement: any): Promise<SelectOption[]> {
    return await selectElement.evaluate((el: any) => {
      return Array.from(el.options).map((opt: any) => ({
        value: opt.value,
        text: opt.text.trim()
      }));
    });
  }

  private async findBestSelectOption(selectElement: any, target: string): Promise<SelectOption | null> {
    const options = await this.extractSelectOptions(selectElement);

    // Simple fuzzy matching
    const normalized = target.toLowerCase().trim();
    for (const opt of options) {
      if (opt.text.toLowerCase().trim() === normalized) {
        return opt;
      }
    }

    // Partial match
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(normalized) || normalized.includes(opt.text.toLowerCase())) {
        return opt;
      }
    }

    return null;
  }

  private async selectBestOptionWithLLM(
    options: SelectOption[],
    contextString: string,
    dropdownType: 'cadastre' | 'designation',
    excludeOptions: string[] = [],
    attemptNumber: number = 1
  ): Promise<(SelectOption & { reasoning: string }) | null> {
    if (!this.openaiApiKey) {
      // Fallback to simple fuzzy matching
      const target = dropdownType === 'cadastre' ? this.config.cadastre || '' : this.config.designation_secondaire || '';
      const filtered = options.filter(o => !excludeOptions.includes(o.text));
      const match = this.findBestMatch(filtered, target);
      return match ? { ...match, reasoning: 'fuzzy match' } : null;
    }

    // Filter out previously tried options
    const availableOptions = options.filter(o => !excludeOptions.includes(o.text));
    if (availableOptions.length === 0) {
      logger.warn('No more options to try');
      return null;
    }

    const optionsList = availableOptions.map((o, i) => `${i}: "${o.text}"`).join('\n');

    let prompt = '';
    if (dropdownType === 'cadastre') {
      prompt = `Context: "${contextString}"
         Format: [lot_number, circonscription, cadastre, designation_secondaire]

         Attempt #${attemptNumber}
         ${excludeOptions.length > 0 ? `\nPREVIOUSLY FAILED: ${excludeOptions.join(', ')}` : ''}

         Available cadastre options:
         ${optionsList}

         Find the BEST matching cadastre from the context.
         Look for cadastre names like "Cadastre du Québec", parish names, etc.

         Return JSON: {"index": <number>, "reasoning": "<why>", "matched_text": "<from context>"}`;
    } else {
      prompt = `Context: "${contextString}"
         Format: [lot_number, circonscription, cadastre, designation_secondaire]

         Attempt #${attemptNumber}
         ${excludeOptions.length > 0 ? `\nPREVIOUSLY FAILED: ${excludeOptions.join(', ')}` : ''}

         Available designation secondaire options:
         ${optionsList}

         Find the BEST matching designation secondaire from the context.
         This could be a subdivision, block, or other secondary designation.

         Return JSON: {"index": <number>, "reasoning": "<why>", "matched_text": "<from context>"}`;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that matches cadastre and designation information.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

      const selectedOption = availableOptions[result.index];
      if (!selectedOption) {
        throw new Error(`Invalid index ${result.index} from LLM`);
      }

      logger.info({
        dropdownType,
        selected: selectedOption.text,
        reasoning: result.reasoning,
        matchedText: result.matched_text
      }, 'LLM selected option');

      return {
        ...selectedOption,
        reasoning: result.reasoning
      };

    } catch (error) {
      logger.error({ error, dropdownType }, 'LLM selection failed, falling back to fuzzy match');
      const target = dropdownType === 'cadastre' ? this.config.cadastre || '' : this.config.designation_secondaire || '';
      const match = this.findBestMatch(availableOptions, target);
      return match ? { ...match, reasoning: 'fuzzy match (LLM failed)' } : null;
    }
  }

  private findBestMatch(options: SelectOption[], target: string): SelectOption | null {
    const normalized = target.toLowerCase().trim();

    // Exact match
    for (const opt of options) {
      if (opt.text.toLowerCase().trim() === normalized) {
        return opt;
      }
    }

    // Partial match
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(normalized) || normalized.includes(opt.text.toLowerCase())) {
        return opt;
      }
    }

    return options.length > 0 ? options[0] : null;
  }
}


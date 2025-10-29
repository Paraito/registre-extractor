import { Page } from 'playwright';
import { logger } from '../utils/logger';
import { ExtractionConfig } from '../types';
import { findBestSelectOption } from '../utils/fuzzy-matcher';

interface FallbackAttempt {
  attemptNumber: number;
  acteType: string;
  result: 'success' | 'failed';
  errorMessage?: string;
}

/**
 * Fallback handler for acte extraction when a specific acte_type fails
 * Tries different acte_types in order: Acte -> Acte divers -> Radiation
 */
export class ActeFallbackHandler {
  private attempts: FallbackAttempt[] = [];
  private acteTypesToTry: string[] = [];

  constructor(
    private page: Page,
    private config: ExtractionConfig
  ) {
    // Determine which acte_types to try based on the original type
    this.acteTypesToTry = this.getActeTypesToTry(config.type_document || 'Acte');
  }

  /**
   * Determine which acte_types to try based on the original failed type
   */
  private getActeTypesToTry(originalType: string): string[] {
    const allTypes = ['Acte', 'Acte divers', 'Radiation'];
    
    // Remove the original type from the list (already tried)
    const typesToTry = allTypes.filter(t => t !== originalType);
    
    logger.info({ 
      originalType, 
      typesToTry 
    }, 'Determined acte_types to try for fallback');
    
    return typesToTry;
  }

  /**
   * Main entry point for fallback logic
   */
  async executeWithRetries(): Promise<void> {
    if (this.acteTypesToTry.length === 0) {
      throw new Error('No alternative acte_types to try');
    }

    for (let i = 0; i < this.acteTypesToTry.length; i++) {
      const acteType = this.acteTypesToTry[i];
      const attemptNum = i + 1;

      try {
        logger.info({ 
          attemptNum, 
          totalAttempts: this.acteTypesToTry.length,
          acteType 
        }, `🔄 Starting acte fallback attempt ${attemptNum}/${this.acteTypesToTry.length} with type: ${acteType}`);

        // Step 1: Navigate to fresh actes page
        await this.navigateToFreshActesPage();

        // Step 2: Select circonscription
        await this.selectCirconscription();

        // Step 3: Select the new acte_type
        await this.selectActeType(acteType);

        // Step 4: Fill numero inscription
        await this.fillNumeroInscription();

        // Step 5: Submit form
        await this.submitForm();

        // Step 6: Check for errors
        const hasError = await this.checkForErrors();

        if (!hasError) {
          // Success!
          this.attempts.push({
            attemptNumber: attemptNum,
            acteType: acteType,
            result: 'success'
          });

          logger.info({
            attemptNum,
            acteType,
            url: this.page.url()
          }, '✅ Acte fallback attempt successful - form submitted, no errors detected');

          // Update the config with the successful acte_type for downstream processing
          this.config.type_document = acteType;

          return; // Success, exit
        }

        // Failed - record attempt
        const errorMsg = await this.getErrorMessage();
        this.attempts.push({
          attemptNumber: attemptNum,
          acteType: acteType,
          result: 'failed',
          errorMessage: errorMsg
        });

        logger.warn({
          attemptNum,
          acteType,
          error: errorMsg
        }, 'Acte fallback attempt failed');

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logger.error({
          attemptNum,
          acteType,
          error: errorMessage
        }, 'Error during acte fallback attempt');

        this.attempts.push({
          attemptNumber: attemptNum,
          acteType: acteType,
          result: 'failed',
          errorMessage: errorMessage
        });
      }
    }

    // All attempts failed - throw detailed error
    throw new Error(this.buildFinalErrorMessage());
  }

  /**
   * Navigate to fresh actes search page
   */
  private async navigateToFreshActesPage(): Promise<void> {
    const actesSearchUrl = 'https://www.registrefoncier.gouv.qc.ca/Sirf/Script/13_01_13/pf_13_01_13_01_acte.asp';
    logger.info({ url: actesSearchUrl }, 'Navigating to fresh actes page');
    
    await this.page.goto(actesSearchUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    await this.page.waitForTimeout(1000);
  }

  /**
   * Select circonscription
   */
  private async selectCirconscription(): Promise<void> {
    logger.info({ circonscription: this.config.circumscription }, 'Selecting circonscription');
    await this.page.waitForSelector('#selCircnFoncr', { state: 'visible', timeout: 30000 });

    const select = await this.page.$('#selCircnFoncr');
    if (!select) {
      throw new Error('Circonscription dropdown not found');
    }

    const bestOption = await findBestSelectOption(select, this.config.circumscription);
    if (bestOption) {
      await this.page.selectOption('#selCircnFoncr', { value: bestOption.value });
    } else {
      throw new Error(`No matching circonscription found for: ${this.config.circumscription}`);
    }
  }

  /**
   * Select acte type
   */
  private async selectActeType(acteType: string): Promise<void> {
    logger.info({ acteType }, 'Selecting acte type');
    
    const typeDocSelect = await this.page.$('#selTypeDocmn');
    if (!typeDocSelect) {
      throw new Error('Type document dropdown not found');
    }

    const currentText = await typeDocSelect.evaluate((el: any) => 
      el.options[el.selectedIndex]?.text?.trim() || ''
    );

    if (currentText !== acteType) {
      const bestOption = await findBestSelectOption(typeDocSelect, acteType);
      if (bestOption) {
        logger.info({ target: acteType, found: bestOption }, 'Found best match for acte type');
        await typeDocSelect.selectOption({ value: bestOption.value });
      } else {
        // Try by value if text doesn't match
        await typeDocSelect.selectOption({ value: acteType });
      }
    } else {
      logger.info('Acte type already correctly selected');
    }
  }

  /**
   * Fill numero inscription
   */
  private async fillNumeroInscription(): Promise<void> {
    if (!this.config.numero_inscription) {
      throw new Error('numero_inscription is required');
    }

    logger.info({ numeroInscription: this.config.numero_inscription }, 'Filling numero inscription');
    await this.page.fill('#txtNoReqst', '');
    await this.page.fill('#txtNoReqst', this.config.numero_inscription);
  }

  /**
   * Submit the form
   */
  private async submitForm(): Promise<void> {
    logger.info('Submitting acte form');
    
    // Try to find and click Rechercher button
    let submitClicked = false;
    
    // Try direct selector first
    const submitBtn = await this.page.$('input[value*="Rechercher"], button:has-text("Rechercher")');
    if (submitBtn) {
      await submitBtn.click();
      submitClicked = true;
      logger.info('Clicked Rechercher button');
    }
    
    if (!submitClicked) {
      throw new Error('Could not find Rechercher button');
    }
    
    // Wait for page to process
    await this.page.waitForTimeout(2000);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
  }

  /**
   * Check for errors on the page
   */
  private async checkForErrors(): Promise<boolean> {
    try {
      await this.page.waitForTimeout(1000);
      
      // Look for error messages
      const errorElement = await this.page.$('td.contValErr, .contValErr');
      
      if (errorElement) {
        const errorText = await errorElement.textContent();
        logger.debug({ errorText }, 'Error element found');
        
        // Check if this is the "similar documents" case - not an error
        if (errorText?.includes('Nous vous proposons une liste de document(s) dont le numéro est semblable')) {
          logger.info('Similar documents found - not treating as error');
          return false; // Not an error
        }
        
        return true; // Error found
      }
      
      return false; // No error
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
   * Build final error message with all attempts
   */
  private buildFinalErrorMessage(): string {
    const attemptDetails = this.attempts.map(a => 
      `  Attempt ${a.attemptNumber}: acte_type="${a.acteType}" -> ${a.result}${a.errorMessage ? ` (${a.errorMessage})` : ''}`
    ).join('\n');

    return `All acte_type fallback attempts failed.\n\nAttempts:\n${attemptDetails}`;
  }
}


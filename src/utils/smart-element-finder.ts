import { Page } from 'playwright';
import { logger } from './logger';

/**
 * Smart element finder that uses multiple strategies to locate elements
 * when AI-based methods fail
 */
export class SmartElementFinder {
  constructor(private page: Page) {}

  /**
   * Find save/download buttons using multiple strategies
   */
  async findSaveButton(): Promise<any> {
    logger.info('Starting smart element search for save button');

    // Strategy 1: Direct text matching
    const textStrategies = [
      { method: 'getByText', args: ['Sauvegarder'], exact: false },
      { method: 'getByText', args: ['SAUVEGARDER'], exact: false },
      { method: 'getByText', args: ['Save'], exact: false },
      { method: 'getByText', args: ['Download'], exact: false },
      { method: 'getByText', args: ['Télécharger'], exact: false },
      { method: 'getByRole', args: ['button', { name: /sauvegarder/i }] },
      { method: 'getByRole', args: ['link', { name: /sauvegarder/i }] },
    ];

    for (const strategy of textStrategies) {
      try {
        const element = await (this.page as any)[strategy.method](...strategy.args).first();
        if (await element.isVisible({ timeout: 1000 })) {
          logger.info({ strategy }, 'Found element with text strategy');
          return element;
        }
      } catch (e) {
        // Continue with next strategy
      }
    }

    // Strategy 2: Attribute-based search
    const attributeSelectors = [
      '[value*="Sauvegarder" i]',
      '[title*="Sauvegarder" i]',
      '[alt*="Sauvegarder" i]',
      '[aria-label*="Sauvegarder" i]',
      '[value*="Save" i]',
      '[title*="Save" i]',
      '[alt*="Save" i]',
      '[onclick*="save" i]',
      '[onclick*="download" i]',
      'button[class*="save" i]',
      'a[class*="save" i]',
      'img[src*="save" i]',
      'img[src*="download" i]',
    ];

    for (const selector of attributeSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element && await element.isVisible()) {
          logger.info({ selector }, 'Found element with attribute selector');
          return element;
        }
      } catch (e) {
        // Continue with next selector
      }
    }

    // Strategy 3: Common save button patterns in forms
    const formPatterns = [
      'form input[type="submit"]',
      'form button[type="submit"]',
      'form input[type="button"]',
      'form button:last-child', // Often the save button is the last in a form
    ];

    for (const pattern of formPatterns) {
      try {
        const elements = await this.page.$$(pattern);
        for (const element of elements) {
          const text = await element.textContent() || '';
          const value = await element.getAttribute('value') || '';
          if (text.match(/sauv|save|down|télé/i) || value.match(/sauv|save|down|télé/i)) {
            logger.info({ pattern, text, value }, 'Found element with form pattern');
            return element;
          }
        }
      } catch (e) {
        // Continue with next pattern
      }
    }

    // Strategy 4: Image buttons and icons
    const imageSelectors = [
      'input[type="image"]',
      'button img',
      'a img',
      '[role="button"] img',
    ];

    for (const selector of imageSelectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const element of elements) {
          const parent = await element.evaluateHandle(el => el.parentElement);
          const alt = await element.getAttribute('alt') || '';
          const src = await element.getAttribute('src') || '';
          
          if (alt.match(/sauv|save|down/i) || src.match(/sauv|save|down/i)) {
            logger.info({ selector, alt, src }, 'Found image button');
            return parent;
          }
        }
      } catch (e) {
        // Continue with next selector
      }
    }

    // Strategy 5: Accessibility tree search
    try {
      const accessibilitySnapshot = await this.page.accessibility.snapshot();
      const buttons = this.findInAccessibilityTree(accessibilitySnapshot, 'button', /sauv|save|down/i);
      
      if (buttons.length > 0) {
        logger.info({ count: buttons.length }, 'Found buttons in accessibility tree');
        // Try to locate the first button
        for (const button of buttons) {
          const element = await this.page.$(`[aria-label="${button.name}"]`) ||
                          await this.page.$(`[title="${button.name}"]`);
          if (element) {
            return element;
          }
        }
      }
    } catch (e) {
      logger.debug('Accessibility tree search failed');
    }

    // Strategy 6: JavaScript event listeners
    const jsButtons = await this.page.evaluate(() => {
      const doc = (globalThis as any).document;
      const elements = doc.querySelectorAll('*');
      const clickableElements = [];
      
      for (const el of elements) {
        // Check if element has click handlers
        const hasClickHandler = el.onclick || 
          (el as any)._addEventListener?.click;
          
        if (hasClickHandler) {
          const text = el.textContent || '';
          const value = (el as any).value || '';
          if (text.match(/sauv|save|down|télé/i) || value.match(/sauv|save|down|télé/i)) {
            clickableElements.push({
              tagName: el.tagName,
              text: text.substring(0, 50),
              className: el.className,
              id: el.id,
            });
          }
        }
      }
      
      return clickableElements;
    });

    if (jsButtons.length > 0) {
      logger.info({ buttons: jsButtons }, 'Found elements with click handlers');
      // Try to click the first one
      const button = jsButtons[0];
      let selector = button.tagName.toLowerCase();
      if (button.id) selector += `#${button.id}`;
      else if (button.className) selector += `.${button.className.split(' ')[0]}`;
      
      const element = await this.page.$(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  /**
   * Helper to search accessibility tree
   */
  private findInAccessibilityTree(node: any, role: string, namePattern: RegExp): any[] {
    const results: any[] = [];
    
    if (!node) return results;
    
    if (node.role === role && node.name && namePattern.test(node.name)) {
      results.push(node);
    }
    
    if (node.children) {
      for (const child of node.children) {
        results.push(...this.findInAccessibilityTree(child, role, namePattern));
      }
    }
    
    return results;
  }

  /**
   * Alternative approach: simulate keyboard navigation
   */
  async findSaveButtonWithKeyboard(): Promise<boolean> {
    logger.info('Trying keyboard navigation to find save button');
    
    try {
      // Press Tab multiple times to navigate through elements
      for (let i = 0; i < 20; i++) {
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(100);
        
        // Check if focused element is a save button
        const focusedElement = await this.page.evaluate(() => {
          const doc = (globalThis as any).document;
          const el = doc.activeElement;
          if (!el) return null;
          
          const text = el.textContent || '';
          const value = (el as any).value || '';
          const title = el.getAttribute('title') || '';
          
          if (text.match(/sauv|save|down/i) || 
              value.match(/sauv|save|down/i) || 
              title.match(/sauv|save|down/i)) {
            return {
              found: true,
              tagName: el.tagName,
              text: text.substring(0, 50),
            };
          }
          
          return null;
        });
        
        if (focusedElement?.found) {
          logger.info({ element: focusedElement }, 'Found save button via keyboard navigation');
          await this.page.keyboard.press('Enter');
          return true;
        }
      }
    } catch (e) {
      logger.error({ error: e }, 'Keyboard navigation failed');
    }
    
    return false;
  }
}
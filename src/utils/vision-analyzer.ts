import { logger } from './logger';
import fs from 'fs/promises';

export interface VisionAnalysisResult {
  success: boolean;
  elements: {
    buttons?: Array<{
      text: string;
      location?: string;
      clickable: boolean;
    }>;
    dropdowns?: Array<{
      label: string;
      selectedValue?: string;
      options?: string[];
    }>;
    inputs?: Array<{
      label: string;
      value?: string;
      type: string;
    }>;
    links?: Array<{
      text: string;
      href?: string;
    }>;
  };
  suggestions: string[];
  pageType?: 'login' | 'search' | 'document' | 'error' | 'unknown';
}

export class VisionAnalyzer {
  private apiKey: string;
  
  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('No OpenAI API key provided for vision analysis');
    }
  }

  async analyzeScreenshot(screenshotPath: string, context?: string): Promise<VisionAnalysisResult> {
    if (!this.apiKey) {
      return {
        success: false,
        elements: {},
        suggestions: ['OpenAI API key not configured for vision analysis'],
      };
    }

    try {
      // Read image and convert to base64
      const imageBuffer = await fs.readFile(screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      // Prepare the prompt
      const prompt = `Analyze this screenshot from the Quebec Land Registry website and identify:
1. All buttons (especially "Sauvegarder", "Save", "Download", "Soumettre", "Submit")
2. All dropdown menus and their selected values
3. All input fields and their values
4. All clickable links
5. The type of page (login, search form, document view, error)

Context: ${context || 'Attempting to extract property documents'}

Please provide a structured analysis including:
- Exact text on buttons and their probable function
- Current state of form fields
- Suggestions for next actions
- Any error messages visible

Focus especially on identifying save/download buttons for PDF documents.`;

      // Call OpenAI Vision API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const result = await response.json() as any;
      const analysis = result.choices?.[0]?.message?.content || '';

      // Parse the analysis into structured format
      return this.parseAnalysis(analysis);
    } catch (error) {
      logger.error({ error, screenshotPath }, 'Vision analysis failed');
      return {
        success: false,
        elements: {},
        suggestions: ['Vision analysis failed - manual review required'],
      };
    }
  }

  private parseAnalysis(analysisText: string): VisionAnalysisResult {
    const result: VisionAnalysisResult = {
      success: true,
      elements: {
        buttons: [],
        dropdowns: [],
        inputs: [],
        links: [],
      },
      suggestions: [],
    };

    try {
      // Extract buttons
      const buttonMatches = analysisText.match(/button[s]?:?\s*(.+?)(?:\n|$)/gi);
      if (buttonMatches) {
        buttonMatches.forEach(match => {
          const text = match.replace(/button[s]?:?\s*/i, '').trim();
          if (text.toLowerCase().includes('sauvegarder') || 
              text.toLowerCase().includes('save') ||
              text.toLowerCase().includes('download')) {
            result.elements.buttons?.push({
              text,
              clickable: true,
            });
          }
        });
      }

      // Extract suggestions
      const suggestionMatches = analysisText.match(/suggest[ions]*:?\s*(.+?)(?:\n\n|$)/gis);
      if (suggestionMatches) {
        suggestionMatches.forEach(match => {
          const suggestions = match.split('\n').slice(1);
          result.suggestions.push(...suggestions.filter(s => s.trim()));
        });
      }

      // Determine page type
      if (analysisText.toLowerCase().includes('login') || 
          analysisText.toLowerCase().includes('mot de passe')) {
        result.pageType = 'login';
      } else if (analysisText.toLowerCase().includes('search') || 
                 analysisText.toLowerCase().includes('circonscription')) {
        result.pageType = 'search';
      } else if (analysisText.toLowerCase().includes('document') || 
                 analysisText.toLowerCase().includes('pdf')) {
        result.pageType = 'document';
      } else if (analysisText.toLowerCase().includes('error') || 
                 analysisText.toLowerCase().includes('erreur')) {
        result.pageType = 'error';
      } else {
        result.pageType = 'unknown';
      }

      // Add generic suggestions based on page type
      if (result.pageType === 'document' && result.elements.buttons?.length === 0) {
        result.suggestions.push('Look for save icon or PDF download link');
        result.suggestions.push('Check browser developer tools for hidden download buttons');
      }

      logger.info({ pageType: result.pageType, buttonsFound: result.elements.buttons?.length }, 'Vision analysis completed');
    } catch (error) {
      logger.error({ error }, 'Failed to parse vision analysis');
    }

    return result;
  }

  async suggestNextAction(screenshotPath: string, lastError: string): Promise<string[]> {
    const analysis = await this.analyzeScreenshot(screenshotPath, `Last error: ${lastError}`);
    
    const suggestions: string[] = [];

    if (analysis.pageType === 'document') {
      suggestions.push('Try right-clicking on the document area to save');
      suggestions.push('Look for printer icon that might save as PDF');
      suggestions.push('Check if Ctrl+S works to save the document');
    } else if (analysis.pageType === 'search') {
      suggestions.push('Verify all form fields are filled correctly');
      suggestions.push('Check if circumscription and cadastre dropdowns have dependencies');
    } else if (analysis.pageType === 'error') {
      suggestions.push('Session may have expired - try logging in again');
      suggestions.push('Check if the lot number format is correct');
    }

    return [...analysis.suggestions, ...suggestions];
  }
}

// Fallback analyzer using pattern matching if no API key
export class PatternBasedAnalyzer {
  async findSaveButton(page: any): Promise<any> {
    const savePatterns = [
      // French patterns
      { selector: 'button:has-text("Sauvegarder")', type: 'button' },
      { selector: 'a:has-text("Sauvegarder")', type: 'link' },
      { selector: 'input[value*="Sauvegarder"]', type: 'input' },
      { selector: '[title*="Sauvegarder"]', type: 'any' },
      { selector: 'img[alt*="Sauvegarder"]', type: 'image' },
      
      // English patterns
      { selector: 'button:has-text("Save")', type: 'button' },
      { selector: 'button:has-text("Download")', type: 'button' },
      { selector: 'a:has-text("Download PDF")', type: 'link' },
      
      // Icon patterns
      { selector: '[class*="save"]', type: 'class' },
      { selector: '[class*="download"]', type: 'class' },
      { selector: '[id*="save"]', type: 'id' },
      { selector: '[id*="download"]', type: 'id' },
      
      // Image buttons
      { selector: 'input[type="image"][alt*="save" i]', type: 'image-input' },
      { selector: 'input[type="image"][alt*="sauv" i]', type: 'image-input' },
    ];

    for (const pattern of savePatterns) {
      try {
        const element = await page.$(pattern.selector);
        if (element) {
          logger.info({ pattern }, 'Found save element with pattern matching');
          return element;
        }
      } catch (e) {
        // Continue trying other patterns
      }
    }

    return null;
  }
}

export async function setupVisionFallback(): Promise<VisionAnalyzer> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.warn('OpenAI API key not found. Vision fallback will be limited.');
    logger.info('To enable AI vision analysis, set OPENAI_API_KEY in your .env file');
  }

  return new VisionAnalyzer(apiKey);
}
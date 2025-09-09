// AI Screenshot Analysis for Municipal Extractor v2
// This analyzes screenshots to understand page state and overcome navigation challenges

import { logger } from '../../utils/logger';
import { sequentialThinkingClient } from '../mcp-clients/sequential-thinking-client';
import { supabaseV2 } from '../database/supabase-client-v2';
import {
  ScreenshotAnalysis,
  ScreenshotAnalysisResult,
  VisualElement,
  RecommendedAction,
  RecoveryAction,
  FormAnalysis,
  ClickableElement,
  DataRegion,
  NavigationElement
} from '../types';

export class AIScreenshotAnalyzer {
  // @ts-ignore - workerId reserved for future use
  constructor(private _workerId: string) {
    // _workerId reserved for future logging and tracking purposes
  }

  async analyzeScreenshotForProgress(
    screenshot: Buffer,
    context: {
      job_id: string;
      page_url: string;
      current_goal: string;
      expected_elements?: string[];
      previous_action?: string;
      stuck_reason?: string;
    }
  ): Promise<ScreenshotAnalysis> {
    const startTime = Date.now();
    
    try {
      logger.info({ 
        job_id: context.job_id, 
        page_url: context.page_url,
        goal: context.current_goal 
      }, 'Starting AI screenshot analysis');

      // First, perform basic visual analysis
      const visualAnalysis = await this.performVisualAnalysis(screenshot, context);
      
      // Use Sequential Thinking to understand the screenshot in context
      const aiAnalysis = await sequentialThinkingClient.analyzeScreenshot({
        screenshot_description: this.generateScreenshotDescription(visualAnalysis),
        current_goal: context.current_goal,
        site_url: context.page_url,
        expected_elements: context.expected_elements,
        previous_action: context.previous_action
      });

      // Generate recommended action based on analysis
      const recommendedAction = this.generateRecommendedAction(
        visualAnalysis,
        aiAnalysis,
        context.current_goal
      );

      // Check if we're stuck and need recovery
      const isStuck = this.detectStuckSituation(visualAnalysis, context);
      let recoveryAction: RecoveryAction | undefined;

      if (isStuck) {
        recoveryAction = await this.generateRecoveryAction(
          screenshot,
          visualAnalysis,
          context
        );
      }

      // Create analysis result
      const analysisResult: ScreenshotAnalysisResult = {
        page_type: visualAnalysis.page_type,
        page_state: visualAnalysis.page_state,
        visible_forms: visualAnalysis.forms,
        clickable_elements: visualAnalysis.clickable_elements,
        data_regions: visualAnalysis.data_regions,
        navigation_elements: visualAnalysis.navigation_elements,
        potential_issues: visualAnalysis.potential_issues,
        suggested_next_steps: aiAnalysis.plan?.success_criteria || []
      };

      const screenshotAnalysis: Partial<ScreenshotAnalysis> = {
        job_id: context.job_id,
        page_url: context.page_url,
        analysis_result: analysisResult,
        visual_elements: visualAnalysis.visual_elements,
        recommended_action: recommendedAction,
        was_stuck: isStuck,
        stuck_reason: context.stuck_reason,
        recovery_action: recoveryAction,
        confidence_score: aiAnalysis.confidence,
        processing_time_ms: Date.now() - startTime
      };

      // Save to database
      const savedAnalysis = await supabaseV2.saveScreenshotAnalysis(screenshotAnalysis);

      logger.info({ 
        job_id: context.job_id,
        confidence: savedAnalysis.confidence_score,
        was_stuck: savedAnalysis.was_stuck,
        processing_time: savedAnalysis.processing_time_ms
      }, 'Screenshot analysis completed');

      return savedAnalysis;

    } catch (error) {
      logger.error({ 
        error, 
        job_id: context.job_id,
        page_url: context.page_url 
      }, 'Screenshot analysis failed');
      throw error;
    }
  }

  private async performVisualAnalysis(
    screenshot: Buffer,
    context: any
  ): Promise<{
    page_type: string;
    page_state: string;
    forms: FormAnalysis[];
    clickable_elements: ClickableElement[];
    data_regions: DataRegion[];
    navigation_elements: NavigationElement[];
    visual_elements: VisualElement[];
    potential_issues: string[];
  }> {
    // This would integrate with actual computer vision/OCR analysis
    // For now, we'll simulate the analysis based on municipal site patterns
    
    const analysis = {
      page_type: this.classifyPageType(context.page_url),
      page_state: 'loaded',
      forms: await this.detectForms(screenshot, context),
      clickable_elements: await this.detectClickableElements(screenshot, context),
      data_regions: await this.detectDataRegions(screenshot, context),
      navigation_elements: await this.detectNavigationElements(screenshot, context),
      visual_elements: await this.detectVisualElements(screenshot, context),
      potential_issues: await this.detectPotentialIssues(screenshot, context)
    };

    return analysis;
  }

  private classifyPageType(url: string): string {
    if (url.includes('search') || url.includes('recherche')) return 'search_page';
    if (url.includes('login') || url.includes('connexion')) return 'login_page';
    if (url.includes('results') || url.includes('resultats')) return 'results_page';
    if (url.includes('form') || url.includes('formulaire')) return 'form_page';
    if (url.includes('permit') || url.includes('permis')) return 'permit_page';
    if (url.includes('zoning') || url.includes('zonage')) return 'zoning_page';
    if (url.includes('flood') || url.includes('inondation')) return 'flood_page';
    return 'general_page';
  }

  private async detectForms(_screenshot: Buffer, context: any): Promise<FormAnalysis[]> {
    // Simulate form detection - would use actual OCR/vision analysis
    const forms: FormAnalysis[] = [];
    
    if (context.page_url.includes('search')) {
      forms.push({
        form_selector: 'form[action*="search"]',
        action: '/search',
        method: 'GET',
        fields: [
          {
            name: 'query',
            type: 'text',
            required: true,
            placeholder: 'Enter search terms'
          },
          {
            name: 'category',
            type: 'select',
            required: false,
            options: ['All', 'Permits', 'Zoning', 'Taxes']
          }
        ],
        submit_button: 'input[type="submit"]',
        validation_present: false
      });
    }

    return forms;
  }

  private async detectClickableElements(_screenshot: Buffer, _context: any): Promise<ClickableElement[]> {
    // Simulate clickable element detection
    const elements: ClickableElement[] = [];
    
    // Common municipal site elements
    elements.push(
      {
        selector: 'a[href*="search"]',
        text: 'Search',
        type: 'link',
        likely_function: 'Navigate to search page',
        confidence: 0.9
      },
      {
        selector: 'button[type="submit"]',
        text: 'Submit',
        type: 'button',
        likely_function: 'Submit form',
        confidence: 0.95
      },
      {
        selector: '.pagination a',
        text: 'Next',
        type: 'link',
        likely_function: 'Navigate to next page',
        confidence: 0.8
      }
    );

    return elements;
  }

  private async detectDataRegions(_screenshot: Buffer, context: any): Promise<DataRegion[]> {
    const regions: DataRegion[] = [];
    
    if (context.page_url.includes('results')) {
      regions.push({
        selector: 'table',
        data_type: 'table',
        estimated_records: 10,
        extraction_difficulty: 'easy'
      });
    }

    return regions;
  }

  private async detectNavigationElements(_screenshot: Buffer, _context: any): Promise<NavigationElement[]> {
    const navElements: NavigationElement[] = [];
    
    navElements.push({
      type: 'menu',
      selector: 'nav',
      items: [
        { text: 'Home', href: '/', active: false },
        { text: 'Search', href: '/search', active: true },
        { text: 'Help', href: '/help', active: false }
      ]
    });

    return navElements;
  }

  private async detectVisualElements(_screenshot: Buffer, _context: any): Promise<VisualElement[]> {
    // This would use actual computer vision
    const elements: VisualElement[] = [];
    
    // Simulate common elements
    elements.push(
      {
        type: 'input',
        selector: 'input[type="text"]',
        text_content: '',
        attributes: { placeholder: 'Search terms' },
        position: { x: 100, y: 200, width: 200, height: 30 },
        confidence: 0.9
      },
      {
        type: 'button',
        selector: 'button[type="submit"]',
        text_content: 'Search',
        attributes: { type: 'submit' },
        position: { x: 320, y: 200, width: 80, height: 30 },
        confidence: 0.95
      }
    );

    return elements;
  }

  private async detectPotentialIssues(_screenshot: Buffer, context: any): Promise<string[]> {
    const issues: string[] = [];
    
    // Common municipal site issues
    if (context.page_url.includes('error')) {
      issues.push('Error page detected');
    }
    
    if (context.previous_action?.includes('click') && context.stuck_reason) {
      issues.push('Click action may have failed');
    }

    return issues;
  }

  private generateScreenshotDescription(visualAnalysis: any): string {
    return `Page type: ${visualAnalysis.page_type}. ` +
           `Contains ${visualAnalysis.forms.length} forms, ` +
           `${visualAnalysis.clickable_elements.length} clickable elements, ` +
           `${visualAnalysis.data_regions.length} data regions. ` +
           `Potential issues: ${visualAnalysis.potential_issues.join(', ')}`;
  }

  private generateRecommendedAction(
    visualAnalysis: any,
    _aiAnalysis: any,
    currentGoal: string
  ): RecommendedAction {
    // Generate recommended action based on analysis
    if (visualAnalysis.forms.length > 0 && currentGoal.includes('search')) {
      return {
        action_type: 'fill',
        description: 'Fill and submit search form',
        target_selector: visualAnalysis.forms[0].form_selector,
        confidence: 0.8,
        fallback_actions: [
          {
            action_type: 'click',
            description: 'Click search button directly',
            target_selector: 'button[type="submit"]',
            confidence: 0.6,
            fallback_actions: []
          }
        ]
      };
    }

    if (visualAnalysis.clickable_elements.length > 0) {
      const relevantElement = visualAnalysis.clickable_elements.find((el: ClickableElement) =>
        el.likely_function.toLowerCase().includes(currentGoal.toLowerCase().split(' ')[0])
      );

      if (relevantElement) {
        return {
          action_type: 'click',
          description: `Click ${relevantElement.text}`,
          target_selector: relevantElement.selector,
          confidence: relevantElement.confidence,
          fallback_actions: []
        };
      }
    }

    // Default action
    return {
      action_type: 'research',
      description: 'Research alternative approaches for current situation',
      confidence: 0.5,
      fallback_actions: []
    };
  }

  private detectStuckSituation(visualAnalysis: any, context: any): boolean {
    // Detect if we're stuck based on various indicators
    if (context.stuck_reason) return true;
    if (visualAnalysis.potential_issues.length > 0) return true;
    if (visualAnalysis.page_type === 'error_page') return true;
    
    // Check if we have no actionable elements for our goal
    const hasRelevantActions = visualAnalysis.clickable_elements.some((el: ClickableElement) =>
      el.likely_function.toLowerCase().includes('search') ||
      el.likely_function.toLowerCase().includes('submit') ||
      el.likely_function.toLowerCase().includes('navigate')
    );

    return !hasRelevantActions;
  }

  private async generateRecoveryAction(
    _screenshot: Buffer,
    visualAnalysis: any,
    context: any
  ): Promise<RecoveryAction> {
    logger.info({ job_id: context.job_id }, 'Generating recovery action for stuck situation');

    // Use Sequential Thinking to generate recovery plan
    const recoveryPlan = await sequentialThinkingClient.generateRecoveryPlan({
      stuck_situation: context.stuck_reason || 'Navigation appears stuck',
      site_url: context.page_url,
      current_page_analysis: visualAnalysis,
      previous_attempts: [], // Would track actual previous attempts
      screenshot_analysis: visualAnalysis
    });

    return {
      strategy: 'ai_guided_recovery',
      steps: this.convertPlanToSteps(recoveryPlan),
      confidence: recoveryPlan.confidence,
      estimated_success_rate: recoveryPlan.confidence * 0.8 // Conservative estimate
    };
  }

  private convertPlanToSteps(plan: any): any[] {
    if (!plan.plan || !plan.plan.stages) {
      return [{
        type: 'research',
        action: 'Research alternative navigation methods',
        timeout: 30000
      }];
    }

    return plan.plan.stages.map((stage: any) => ({
      type: 'navigate',
      action: stage.name,
      target: stage.actions?.[0] || 'unknown',
      timeout: 30000,
      validation: stage.expected_outcome
    }));
  }

  async analyzeForStuckDetection(
    screenshot: Buffer,
    context: {
      job_id: string;
      page_url: string;
      last_action: string;
      expected_change: string;
      timeout_occurred: boolean;
    }
  ): Promise<{ isStuck: boolean; reason?: string; suggestion?: string }> {
    logger.info({ job_id: context.job_id }, 'Analyzing for stuck detection');

    const visualAnalysis = await this.performVisualAnalysis(screenshot, context);
    
    let isStuck = false;
    let reason = '';
    let suggestion = '';

    // Check various stuck conditions
    if (context.timeout_occurred) {
      isStuck = true;
      reason = 'Action timeout occurred';
      suggestion = 'Try alternative selector or method';
    }

    if (visualAnalysis.page_type === 'error_page') {
      isStuck = true;
      reason = 'Error page detected';
      suggestion = 'Navigate back and try different approach';
    }

    if (visualAnalysis.potential_issues.length > 0) {
      isStuck = true;
      reason = visualAnalysis.potential_issues.join(', ');
      suggestion = 'Research site-specific solutions';
    }

    // Check if expected change occurred
    if (!this.verifyExpectedChange(visualAnalysis, context.expected_change)) {
      isStuck = true;
      reason = 'Expected page change did not occur';
      suggestion = 'Verify action success and retry with different method';
    }

    if (isStuck) {
      logger.warn({ 
        job_id: context.job_id,
        reason,
        suggestion 
      }, 'Stuck situation detected');
    }

    return { isStuck, reason, suggestion };
  }

  private verifyExpectedChange(visualAnalysis: any, expectedChange: string): boolean {
    // This would verify if the expected change occurred
    // For now, we'll do a simple check
    if (expectedChange.includes('navigate') && visualAnalysis.page_state === 'loaded') {
      return true;
    }
    
    if (expectedChange.includes('submit') && visualAnalysis.page_type === 'results_page') {
      return true;
    }

    return false;
  }
}

export const createScreenshotAnalyzer = (workerId: string) => new AIScreenshotAnalyzer(workerId);
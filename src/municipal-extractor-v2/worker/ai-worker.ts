// AI Worker for Municipal Data Extractor v2
// Main orchestration class that combines all components

import { logger } from '../../utils/logger';
import { supabaseV2 } from '../database/supabase-client-v2';
import { createScreenshotAnalyzer } from '../analysis/screenshot-analyzer';
import { createProcessCache } from '../core/process-cache';
import { municipalPatternRecognizer } from '../patterns/municipal-patterns';
import { sequentialThinkingClient } from '../mcp-clients/sequential-thinking-client';
import {
  ExtractionJobV2,
  AIWorker,
  StandardizedExtractionResult,
  ExecutionTrace,
  SitePattern,
  MunicipalExtractionError
} from '../types';
import { v4 as uuidv4 } from 'uuid';

export class MunicipalAIWorker {
  private workerId: string;
  private workerStatus: AIWorker;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  private lastJobTime: number = Date.now();
  private idleTimeoutMs: number = 5 * 60 * 1000; // 5 minutes

  // Component instances
  private screenshotAnalyzer;
  private processCache;

  // Browser integration - would be actual Browserbase client
  private browserSession: any = null;

  constructor(workerId?: string) {
    this.workerId = workerId || `ai-worker-${uuidv4()}`;
    this.screenshotAnalyzer = createScreenshotAnalyzer(this.workerId);
    this.processCache = createProcessCache(this.workerId);
    
    this.workerStatus = {
      id: uuidv4(),
      worker_id: this.workerId,
      status: 'idle',
      last_heartbeat: new Date().toISOString(),
      jobs_completed: 0,
      jobs_failed: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  async initialize(): Promise<void> {
    try {
      logger.info({ worker_id: this.workerId }, 'Initializing AI worker');

      // Register worker in database
      await supabaseV2.registerWorker(this.workerStatus);

      // Start heartbeat
      this.startHeartbeat();

      // Initialize browser session (would be Browserbase)
      await this.initializeBrowserSession();

      logger.info({ worker_id: this.workerId }, 'AI worker initialized successfully');

      // Start continuous job processing
      this.processContinuously();

    } catch (error) {
      logger.error({ error, worker_id: this.workerId }, 'Failed to initialize AI worker');
      throw error;
    }
  }

  private async initializeBrowserSession(): Promise<void> {
    // This would initialize actual Browserbase session
    logger.info({ worker_id: this.workerId }, 'Initializing browser session');
    
    // Mock browser session
    this.browserSession = {
      id: `browser-${this.workerId}`,
      status: 'ready',
      initialized_at: new Date().toISOString()
    };

    logger.info({ 
      worker_id: this.workerId,
      browser_session_id: this.browserSession.id 
    }, 'Browser session initialized');
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await supabaseV2.updateWorkerHeartbeat(
          this.workerId,
          this.workerStatus.status,
          this.workerStatus.current_job_id
        );
      } catch (error) {
        logger.error({ error, worker_id: this.workerId }, 'Heartbeat failed');
      }
    }, 15000); // Every 15 seconds
  }

  private async processContinuously(): Promise<void> {
    logger.info({ worker_id: this.workerId }, 'Starting continuous job processing');

    while (!this.shouldStop) {
      try {
        // Get next job
        const job = await supabaseV2.getNextJob(this.workerId);

        if (!job) {
          // Check idle timeout
          const idleTime = Date.now() - this.lastJobTime;
          if (idleTime > this.idleTimeoutMs && this.browserSession) {
            logger.info({ 
              worker_id: this.workerId,
              idle_minutes: Math.round(idleTime / 60000) 
            }, 'Worker idle timeout - cleaning up browser session');
            
            await this.cleanupBrowserSession();
          }

          // No jobs available, wait
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Update last job time
        this.lastJobTime = Date.now();

        // Process the job
        await this.processJob(job);

      } catch (error) {
        logger.error({ error, worker_id: this.workerId }, 'Error in continuous processing');
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private async processJob(job: ExtractionJobV2): Promise<void> {
    const startTime = Date.now();
    logger.info({ 
      job_id: job.id,
      worker_id: this.workerId,
      site_url: job.site_url,
      data_type: job.data_type 
    }, 'Processing extraction job');

    this.isProcessing = true;
    this.workerStatus.status = 'busy';
    this.workerStatus.current_job_id = job.id;

    try {
      // Step 1: Check for cached process (90% cost savings)
      const cacheResult = await this.processCache.findCachedProcess(job);
      
      if (cacheResult.found) {
        logger.info({ 
          job_id: job.id,
          cache_similarity: cacheResult.similarity_score 
        }, 'Using cached process');

        const result = await this.processCache.executeCachedProcess(
          cacheResult.cached_process!,
          job,
          cacheResult.adaptation_required
        );

        await this.completeJob(job, result, startTime);
        return;
      }

      // Step 2: AI-powered extraction (full cost but cache for future)
      const result = await this.executeAIPoweredExtraction(job);
      
      await this.completeJob(job, result, startTime);

    } catch (error) {
      await this.handleJobFailure(job, error as Error, startTime);
    } finally {
      this.isProcessing = false;
      this.workerStatus.status = 'idle';
      this.workerStatus.current_job_id = undefined;
    }
  }

  private async executeAIPoweredExtraction(job: ExtractionJobV2): Promise<StandardizedExtractionResult> {
    const startTime = Date.now();
    logger.info({ job_id: job.id }, 'Starting AI-powered extraction');

    // Initialize execution trace
    const executionTrace: ExecutionTrace = {
      job_id: job.id,
      steps_executed: [],
      screenshots_taken: [],
      errors_encountered: [],
      total_execution_time: 0,
      ai_calls_made: 0,
      cache_hits: 0,
      cache_misses: 1,
      final_success: false
    };

    try {
      // Step 1: Recognize site pattern
      const sitePattern = await municipalPatternRecognizer.recognizeSitePattern(job.site_url);
      if (!sitePattern) {
        throw new MunicipalExtractionError(
          'Could not recognize site pattern',
          'SITE_PATTERN_UNKNOWN',
          { url: job.site_url }
        );
      }

      // Step 2: Generate extraction plan
      const extractionPlan = await sequentialThinkingClient.generateExtractionPlan({
        site_url: job.site_url,
        data_type: job.data_type,
        target_fields: job.target_fields,
        filters: job.filters,
        context: { site_pattern: sitePattern }
      });

      executionTrace.ai_calls_made++;

      // Step 3: Execute extraction with AI guidance
      const extractedData = await this.executeExtractionPlan(job, sitePattern, extractionPlan, executionTrace);

      // Step 4: Standardize data
      const standardizedData = await this.standardizeExtractedData(
        extractedData,
        job.data_type,
        sitePattern.site_domain
      );

      // Step 5: Validate results
      const validation = await this.validateExtractionResult(standardizedData, job.target_fields);

      const result: StandardizedExtractionResult = {
        success: validation.success,
        data: standardizedData,
        confidence: validation.confidence,
        source: 'ai',
        execution_time: Date.now() - startTime,
        cost: this.calculateAICost(executionTrace),
        validation_errors: validation.errors,
        extraction_metadata: {
          site_pattern: sitePattern.site_domain,
          cache_used: false,
          ai_calls_made: executionTrace.ai_calls_made,
          screenshots_analyzed: executionTrace.screenshots_taken.length,
          recovery_actions_taken: executionTrace.errors_encountered.length
        }
      };

      executionTrace.final_success = result.success;
      executionTrace.total_execution_time = result.execution_time;

      // Cache successful process for future use
      if (result.success && result.confidence >= 0.8) {
        await this.processCache.cacheSuccessfulProcess(job, executionTrace, result);
      }

      // Update site pattern with experience
      await municipalPatternRecognizer.updatePatternFromExperience(
        sitePattern,
        job,
        result.success,
        executionTrace,
        validation.errors
      );

      return result;

    } catch (error) {
      logger.error({ error, job_id: job.id }, 'AI-powered extraction failed');
      
      executionTrace.errors_encountered.push({
        step_number: executionTrace.steps_executed.length + 1,
        error_type: error instanceof MunicipalExtractionError ? error.code : 'UNKNOWN_ERROR',
        error_message: (error as Error).message,
        recovery_attempted: false
      });

      throw error;
    }
  }

  private async executeExtractionPlan(
    job: ExtractionJobV2,
    sitePattern: SitePattern,
    extractionPlan: any,
    executionTrace: ExecutionTrace
  ): Promise<Record<string, any>> {
    logger.info({ job_id: job.id }, 'Executing extraction plan');

    const extractedData: Record<string, any> = {};
    let stepNumber = 1;

    // This would integrate with actual browser automation
    // For now, we'll simulate the extraction process

    try {
      // Navigate to site
      await this.simulateNavigationStep('navigate_to_site', job.site_url, executionTrace, stepNumber++);

      // Handle authentication if required
      if (sitePattern.auth_required) {
        await this.simulateNavigationStep('authenticate', 'login_page', executionTrace, stepNumber++);
      }

      // Navigate to data section
      await this.simulateNavigationStep('navigate_to_data', 'data_section', executionTrace, stepNumber++);

      // Execute search if filters provided
      if (job.filters && Object.keys(job.filters).length > 0) {
        await this.simulateExtractionStep('search', job.filters, executionTrace, stepNumber++);
      }

      // Extract target data
      for (const field of job.target_fields) {
        const fieldData = await this.simulateExtractionStep('extract_field', field, executionTrace, stepNumber++);
        extractedData[field] = fieldData;
      }

      // Handle pagination if needed
      await this.simulateNavigationStep('check_pagination', 'pagination_check', executionTrace, stepNumber++);

      logger.info({ 
        job_id: job.id,
        extracted_fields: Object.keys(extractedData).length 
      }, 'Extraction plan executed successfully');

      return extractedData;

    } catch (error) {
      logger.error({ error, job_id: job.id }, 'Extraction plan execution failed');
      
      // Attempt recovery with screenshot analysis
      const recoveryResult = await this.attemptRecovery(job, error as Error, executionTrace);
      if (recoveryResult.success) {
        return recoveryResult.data;
      }

      throw error;
    }
  }

  private async simulateNavigationStep(
    stepType: string,
    target: string,
    executionTrace: ExecutionTrace,
    stepNumber: number
  ): Promise<void> {
    const stepStart = Date.now();
    
    try {
      // Simulate navigation action
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      executionTrace.steps_executed.push({
        step_number: stepNumber,
        step_type: stepType,
        action_taken: `Navigate to ${target}`,
        success: true,
        execution_time: Date.now() - stepStart
      });

      logger.debug({ step_number: stepNumber, step_type: stepType }, 'Navigation step completed');

    } catch (error) {
      executionTrace.steps_executed.push({
        step_number: stepNumber,
        step_type: stepType,
        action_taken: `Navigate to ${target}`,
        success: false,
        execution_time: Date.now() - stepStart,
        error_message: (error as Error).message
      });

      throw error;
    }
  }

  private async simulateExtractionStep(
    stepType: string,
    target: any,
    executionTrace: ExecutionTrace,
    stepNumber: number
  ): Promise<any> {
    const stepStart = Date.now();
    
    try {
      // Simulate extraction with some randomness for testing
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));

      let extractedValue: any;

      if (stepType === 'search') {
        extractedValue = `Searched for ${JSON.stringify(target)}`;
      } else if (stepType === 'extract_field') {
        // Generate mock data based on field type
        extractedValue = this.generateMockFieldData(target);
      } else {
        extractedValue = `Result for ${target}`;
      }

      executionTrace.steps_executed.push({
        step_number: stepNumber,
        step_type: stepType,
        action_taken: `Extract ${target}`,
        success: true,
        execution_time: Date.now() - stepStart
      });

      logger.debug({ 
        step_number: stepNumber, 
        step_type: stepType,
        extracted_value: extractedValue 
      }, 'Extraction step completed');

      return extractedValue;

    } catch (error) {
      executionTrace.steps_executed.push({
        step_number: stepNumber,
        step_type: stepType,
        action_taken: `Extract ${target}`,
        success: false,
        execution_time: Date.now() - stepStart,
        error_message: (error as Error).message
      });

      throw error;
    }
  }

  private generateMockFieldData(fieldName: string): any {
    const fieldLower = fieldName.toLowerCase();
    
    if (fieldLower.includes('permit_number')) {
      return `PERM-${Math.floor(Math.random() * 100000)}`;
    }
    
    if (fieldLower.includes('address')) {
      const addresses = [
        '1234 Rue Saint-Denis, Montréal',
        '567 Boulevard René-Lévesque, Québec',
        '890 Avenue Cartier, Gatineau'
      ];
      return addresses[Math.floor(Math.random() * addresses.length)];
    }
    
    if (fieldLower.includes('date')) {
      return new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
    
    if (fieldLower.includes('status')) {
      const statuses = ['Approved', 'Pending', 'Under Review', 'Rejected'];
      return statuses[Math.floor(Math.random() * statuses.length)];
    }
    
    if (fieldLower.includes('type')) {
      const types = ['Building Permit', 'Demolition Permit', 'Occupancy Permit', 'Renovation Permit'];
      return types[Math.floor(Math.random() * types.length)];
    }

    return `Sample ${fieldName} data`;
  }

  private async attemptRecovery(
    job: ExtractionJobV2,
    error: Error,
    executionTrace: ExecutionTrace
  ): Promise<{ success: boolean; data?: Record<string, any> }> {
    logger.warn({ job_id: job.id, error: error.message }, 'Attempting recovery with screenshot analysis');

    try {
      // Take screenshot for analysis
      const screenshot = Buffer.from('mock_screenshot_data'); // Would be actual screenshot
      executionTrace.screenshots_taken.push(`screenshot_${Date.now()}.png`);

      // Analyze screenshot to understand what went wrong
      const analysis = await this.screenshotAnalyzer.analyzeScreenshotForProgress(screenshot, {
        job_id: job.id,
        page_url: job.site_url,
        current_goal: `Extract ${job.target_fields.join(', ')}`,
        stuck_reason: error.message
      });

      if (analysis.recovery_action && analysis.recovery_successful) {
        logger.info({ job_id: job.id }, 'Recovery successful via screenshot analysis');
        
        // Execute recovery actions
        const recoveryData = await this.executeRecoveryAction(analysis.recovery_action, job);
        
        return { success: true, data: recoveryData };
      }

      return { success: false };

    } catch (recoveryError) {
      logger.error({ 
        error: recoveryError, 
        job_id: job.id 
      }, 'Recovery attempt failed');
      
      return { success: false };
    }
  }

  private async executeRecoveryAction(recoveryAction: any, job: ExtractionJobV2): Promise<Record<string, any>> {
    // Execute the AI-generated recovery actions
    const recoveredData: Record<string, any> = {};
    
    for (const step of recoveryAction.steps) {
      // Execute recovery step
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (step.type === 'extract') {
        recoveredData[step.target || 'recovered_field'] = `Recovered data for ${step.target}`;
      }
    }

    return recoveredData;
  }

  private async standardizeExtractedData(
    rawData: Record<string, any>,
    dataType: string,
    sitePattern: string
  ): Promise<Record<string, any>> {
    // This would use the data standardization engine
    // For now, return the raw data with some basic standardization
    
    const standardizedData: Record<string, any> = {};
    
    Object.entries(rawData).forEach(([key, value]) => {
      // Basic standardization
      let standardizedValue = value;
      
      if (key.includes('date') && typeof value === 'string') {
        standardizedValue = new Date(value).toISOString().split('T')[0];
      }
      
      if (key.includes('address') && typeof value === 'string') {
        standardizedValue = value.trim();
      }
      
      standardizedData[key] = standardizedValue;
    });

    return standardizedData;
  }

  private async validateExtractionResult(
    data: Record<string, any>,
    targetFields: string[]
  ): Promise<{ success: boolean; confidence: number; errors?: string[] }> {
    const errors: string[] = [];
    let successfulFields = 0;

    // Check if all target fields were extracted
    targetFields.forEach(field => {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        successfulFields++;
      } else {
        errors.push(`Missing or empty field: ${field}`);
      }
    });

    const success = errors.length === 0;
    const confidence = targetFields.length > 0 ? successfulFields / targetFields.length : 0;

    return {
      success,
      confidence,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  private calculateAICost(executionTrace: ExecutionTrace): number {
    // Calculate cost based on AI calls made
    const baseCostPerCall = 0.02;
    const screenshotAnalysisCost = 0.05;
    
    let totalCost = executionTrace.ai_calls_made * baseCostPerCall;
    totalCost += executionTrace.screenshots_taken.length * screenshotAnalysisCost;
    
    return totalCost;
  }

  private async completeJob(
    job: ExtractionJobV2,
    result: StandardizedExtractionResult,
    startTime: number
  ): Promise<void> {
    const totalTime = Date.now() - startTime;
    
    await supabaseV2.updateJobResult(job.id, {
      status: 'completed',
      result_data: result.data,
      standardized_data: result.data,
      actual_cost: result.cost,
      used_cache: result.source === 'cache',
      cache_hit_rate: result.source === 'cache' ? 1.0 : 0.0
    });

    // Update worker stats
    this.workerStatus.jobs_completed++;
    await supabaseV2.updateWorkerStats(this.workerId, this.workerStatus.jobs_completed, undefined);

    logger.info({ 
      job_id: job.id,
      worker_id: this.workerId,
      success: result.success,
      confidence: result.confidence,
      execution_time: totalTime,
      cost: result.cost,
      source: result.source
    }, 'Job completed successfully');
  }

  private async handleJobFailure(job: ExtractionJobV2, error: Error, startTime: number): Promise<void> {
    const totalTime = Date.now() - startTime;
    
    // Increment attempts
    await supabaseV2.incrementJobAttempts(job.id);
    
    // Check if we should retry or mark as failed
    const currentAttempts = (job.attempts || 0) + 1;
    const shouldRetry = currentAttempts < job.max_attempts;

    if (shouldRetry) {
      // For retry, we'll use a separate method - for now just mark as failed
      await supabaseV2.updateJobResult(job.id, {
        status: 'failed',
        error_message: `Attempt ${currentAttempts}/${job.max_attempts}: ${error.message}`
      });
    } else {
      await supabaseV2.updateJobResult(job.id, {
        status: 'failed',
        error_message: error.message
      });
    }

    // Update worker stats
    if (!shouldRetry) {
      this.workerStatus.jobs_failed++;
      await supabaseV2.updateWorkerStats(this.workerId, undefined, this.workerStatus.jobs_failed);
    }

    logger.error({ 
      job_id: job.id,
      worker_id: this.workerId,
      error: error.message,
      attempts: currentAttempts,
      will_retry: shouldRetry,
      execution_time: totalTime
    }, 'Job failed');
  }

  private async cleanupBrowserSession(): Promise<void> {
    if (this.browserSession) {
      logger.info({ 
        worker_id: this.workerId,
        browser_session_id: this.browserSession.id 
      }, 'Cleaning up browser session');
      
      // Would close actual browser session
      this.browserSession = null;
    }
  }

  async shutdown(): Promise<void> {
    logger.info({ worker_id: this.workerId }, 'Shutting down AI worker');

    this.shouldStop = true;

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Clean up browser session
    await this.cleanupBrowserSession();

    // Update worker status
    await supabaseV2.updateWorkerHeartbeat(this.workerId, 'offline');

    logger.info({ worker_id: this.workerId }, 'AI worker shutdown complete');
  }
}

// Main entry point
if (require.main === module) {
  const worker = new MunicipalAIWorker(process.env.WORKER_ID);

  process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  worker.initialize().catch((error) => {
    logger.error({ error }, 'AI worker failed to initialize');
    process.exit(1);
  });
}
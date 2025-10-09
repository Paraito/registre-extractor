// Municipal Data Extractor v2 - Supabase Database Client
// This is completely separate from the v1 extractor database operations

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../utils/logger';
import {
  ExtractionJobV2,
  AIWorker,
  CachedProcess,
  ScreenshotAnalysis,
  SitePattern,
  // DataSchema - commented out as unused
  // FieldMapping - commented out as unused
  ExtractionAnalytics,
  LearningEvent
} from '../types';

export class SupabaseClientV2 {
  private client: SupabaseClient;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    this.client = createClient(
      supabaseUrl || process.env.SUPABASE_URL!,
      supabaseKey || process.env.SUPABASE_SERVICE_KEY!
    );
  }

  // AI Workers operations
  async registerWorker(worker: Partial<AIWorker>): Promise<AIWorker> {
    const { data, error } = await this.client
      .from('ai_workers')
      .upsert({
        worker_id: worker.worker_id,
        status: worker.status || 'idle',
        last_heartbeat: new Date().toISOString(),
        jobs_completed: worker.jobs_completed || 0,
        jobs_failed: worker.jobs_failed || 0
      }, {
        onConflict: 'worker_id'
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, worker_id: worker.worker_id }, 'Failed to register AI worker');
      throw error;
    }

    logger.info({ worker_id: worker.worker_id }, 'AI worker registered successfully');
    return data;
  }

  async updateWorkerHeartbeat(workerId: string, status?: string, currentJobId?: string): Promise<void> {
    const updateData: any = {
      last_heartbeat: new Date().toISOString()
    };

    if (status) updateData.status = status;
    if (currentJobId !== undefined) updateData.current_job_id = currentJobId;

    const { error } = await this.client
      .from('ai_workers')
      .update(updateData)
      .eq('worker_id', workerId);

    if (error) {
      logger.error({ error, workerId }, 'Failed to update worker heartbeat');
      throw error;
    }
  }

  async updateWorkerStats(workerId: string, completed?: number, failed?: number): Promise<void> {
    const updateData: any = {};
    if (completed !== undefined) updateData.jobs_completed = completed;
    if (failed !== undefined) updateData.jobs_failed = failed;

    const { error } = await this.client
      .from('ai_workers')
      .update(updateData)
      .eq('worker_id', workerId);

    if (error) {
      logger.error({ error, workerId }, 'Failed to update worker stats');
      throw error;
    }
  }

  async getActiveWorkers(): Promise<AIWorker[]> {
    const { data, error } = await this.client
      .from('ai_workers')
      .select('*')
      .in('status', ['idle', 'busy'])
      .gte('last_heartbeat', new Date(Date.now() - 5 * 60 * 1000).toISOString()); // Active in last 5 minutes

    if (error) {
      logger.error({ error }, 'Failed to get active workers');
      throw error;
    }

    return data || [];
  }

  // Extraction Queue operations
  async createExtractionJob(job: Partial<ExtractionJobV2>): Promise<ExtractionJobV2> {
    const { data, error } = await this.client
      .from('extraction_queue_v2')
      .insert({
        site_url: job.site_url!,
        data_type: job.data_type!,
        target_fields: job.target_fields!,
        filters: job.filters,
        priority: job.priority || 'normal',
        max_attempts: job.max_attempts || 3,
        used_cache: false
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, job }, 'Failed to create extraction job');
      throw error;
    }

    logger.info({ job_id: data.id, site_url: job.site_url }, 'Extraction job created');
    return data;
  }

  async getNextJob(workerId: string): Promise<ExtractionJobV2 | null> {
    // First check for stale jobs (stuck in processing for more than 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: staleJobs } = await this.client
      .from('extraction_queue_v2')
      .select('*')
      .eq('status', 'processing')
      .lt('processing_started_at', tenMinutesAgo)
      .limit(1);

    if (staleJobs && staleJobs.length > 0) {
      // Reset stale job
      await this.client
        .from('extraction_queue_v2')
        .update({
          status: 'pending',
          worker_id: null,
          processing_started_at: null,
          error_message: 'Reset due to stale processing state'
        })
        .eq('id', staleJobs[0].id);

      logger.warn({ job_id: staleJobs[0].id }, 'Reset stale extraction job');
    }

    // Get next pending job
    const { data, error } = await this.client
      .from('extraction_queue_v2')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const job = data[0];

    // Try to claim the job
    const { data: claimedJob, error: claimError } = await this.client
      .from('extraction_queue_v2')
      .update({
        status: 'processing',
        worker_id: workerId,
        processing_started_at: new Date().toISOString()
      })
      .eq('id', job.id)
      .eq('status', 'pending') // Ensure it's still pending
      .select()
      .single();

    if (claimError || !claimedJob) {
      // Another worker claimed it
      return null;
    }

    logger.info({ job_id: claimedJob.id, worker_id: workerId }, 'Claimed extraction job');
    return claimedJob;
  }

  async updateJobResult(
    jobId: string,
    result: {
      status: 'completed' | 'failed';
      result_data?: any;
      standardized_data?: any;
      error_message?: string;
      execution_trace?: any;
      actual_cost?: number;
      used_cache?: boolean;
      cache_hit_rate?: number;
    }
  ): Promise<void> {
    const updateData: any = {
      status: result.status,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (result.result_data) updateData.result_data = result.result_data;
    if (result.standardized_data) updateData.standardized_data = result.standardized_data;
    if (result.error_message) updateData.error_message = result.error_message;
    if (result.execution_trace) updateData.execution_trace = result.execution_trace;
    if (result.actual_cost !== undefined) updateData.actual_cost = result.actual_cost;
    if (result.used_cache !== undefined) updateData.used_cache = result.used_cache;
    if (result.cache_hit_rate !== undefined) updateData.cache_hit_rate = result.cache_hit_rate;

    const { error } = await this.client
      .from('extraction_queue_v2')
      .update(updateData)
      .eq('id', jobId);

    if (error) {
      logger.error({ error, jobId }, 'Failed to update job result');
      throw error;
    }

    logger.info({ job_id: jobId, status: result.status }, 'Updated job result');
  }

  async incrementJobAttempts(jobId: string): Promise<void> {
    const { error } = await this.client
      .rpc('increment_job_attempts', { job_id: jobId });

    if (error) {
      logger.error({ error, jobId }, 'Failed to increment job attempts');
      throw error;
    }
  }

  // Process Cache operations
  async findCachedProcess(fingerprint: string): Promise<CachedProcess | null> {
    const { data, error } = await this.client
      .from('process_cache')
      .select('*')
      .eq('fingerprint', fingerprint)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async findSimilarCachedProcess(sitePattern: string, dataType: string): Promise<CachedProcess[]> {
    const { data, error } = await this.client
      .from('process_cache')
      .select('*')
      .eq('site_pattern', sitePattern)
      .eq('data_type', dataType)
      .gte('success_rate', 0.7)
      .order('usage_count', { ascending: false })
      .limit(5);

    if (error) {
      logger.error({ error, sitePattern, dataType }, 'Failed to find similar cached processes');
      throw error;
    }

    return data || [];
  }

  async saveCachedProcess(process: Partial<CachedProcess>): Promise<CachedProcess> {
    const { data, error } = await this.client
      .from('process_cache')
      .upsert({
        fingerprint: process.fingerprint!,
        site_pattern: process.site_pattern!,
        data_type: process.data_type!,
        extraction_steps: process.extraction_steps!,
        selectors: process.selectors,
        navigation_path: process.navigation_path,
        validation_rules: process.validation_rules,
        success_rate: process.success_rate || 1.0,
        usage_count: 1,
        avg_execution_time: process.avg_execution_time
      }, {
        onConflict: 'fingerprint'
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, process }, 'Failed to save cached process');
      throw error;
    }

    logger.info({ fingerprint: process.fingerprint }, 'Cached process saved');
    return data;
  }

  async updateCacheUsage(fingerprint: string, successful: boolean, executionTime?: number): Promise<void> {
    // This would typically be done with a stored procedure for atomic updates
    const { data: current } = await this.client
      .from('process_cache')
      .select('usage_count, success_rate, avg_execution_time')
      .eq('fingerprint', fingerprint)
      .single();

    if (!current) return;

    const newUsageCount = current.usage_count + 1;
    const newSuccessRate = successful 
      ? ((current.success_rate * current.usage_count) + 1) / newUsageCount
      : ((current.success_rate * current.usage_count)) / newUsageCount;
    
    const newAvgTime = executionTime && current.avg_execution_time
      ? ((current.avg_execution_time * current.usage_count) + executionTime) / newUsageCount
      : current.avg_execution_time || executionTime;

    const updateData: any = {
      usage_count: newUsageCount,
      success_rate: newSuccessRate,
      last_successful_use: successful ? new Date().toISOString() : undefined
    };

    if (newAvgTime) updateData.avg_execution_time = newAvgTime;

    const { error } = await this.client
      .from('process_cache')
      .update(updateData)
      .eq('fingerprint', fingerprint);

    if (error) {
      logger.error({ error, fingerprint }, 'Failed to update cache usage');
      throw error;
    }
  }

  // Screenshot Analysis operations
  async saveScreenshotAnalysis(analysis: Partial<ScreenshotAnalysis>): Promise<ScreenshotAnalysis> {
    const { data, error } = await this.client
      .from('screenshot_analysis')
      .insert({
        job_id: analysis.job_id!,
        screenshot_path: analysis.screenshot_path,
        screenshot_data: analysis.screenshot_data,
        page_url: analysis.page_url!,
        analysis_result: analysis.analysis_result!,
        visual_elements: analysis.visual_elements || [],
        recommended_action: analysis.recommended_action!,
        was_stuck: analysis.was_stuck || false,
        stuck_reason: analysis.stuck_reason,
        recovery_action: analysis.recovery_action,
        recovery_successful: analysis.recovery_successful,
        confidence_score: analysis.confidence_score!,
        processing_time_ms: analysis.processing_time_ms!
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, job_id: analysis.job_id }, 'Failed to save screenshot analysis');
      throw error;
    }

    return data;
  }

  // Site Patterns operations
  async getSitePattern(domain: string): Promise<SitePattern | null> {
    const { data, error } = await this.client
      .from('site_patterns')
      .select('*')
      .eq('site_domain', domain)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async getSitePatternByType(siteType: string): Promise<SitePattern[]> {
    const { data, error } = await this.client
      .from('site_patterns')
      .select('*')
      .eq('site_type', siteType)
      .order('success_rate', { ascending: false });

    if (error) {
      logger.error({ error, siteType }, 'Failed to get site patterns by type');
      throw error;
    }

    return data || [];
  }

  async updateSitePatternSuccess(domain: string, successful: boolean): Promise<void> {
    const { data: current } = await this.client
      .from('site_patterns')
      .select('success_rate')
      .eq('site_domain', domain)
      .single();

    if (!current) return;

    // Simple success rate update - in production, you might want more sophisticated tracking
    const newSuccessRate = successful 
      ? Math.min(1.0, current.success_rate + 0.01)
      : Math.max(0.0, current.success_rate - 0.05);

    const { error } = await this.client
      .from('site_patterns')
      .update({
        success_rate: newSuccessRate,
        last_validated: new Date().toISOString()
      })
      .eq('site_domain', domain);

    if (error) {
      logger.error({ error, domain }, 'Failed to update site pattern success');
      throw error;
    }
  }

  // Learning Events
  async recordLearningEvent(event: Partial<LearningEvent>): Promise<void> {
    const { error } = await this.client
      .from('learning_events')
      .insert({
        event_type: event.event_type!,
        job_id: event.job_id,
        site_pattern: event.site_pattern!,
        data_type: event.data_type!,
        event_data: event.event_data!,
        improvement_impact: event.improvement_impact,
        confidence_score: event.confidence_score!
      });

    if (error) {
      logger.error({ error, event }, 'Failed to record learning event');
      throw error;
    }

    logger.info({ event_type: event.event_type, site_pattern: event.site_pattern }, 'Learning event recorded');
  }

  // Analytics
  async recordDailyAnalytics(analytics: Partial<ExtractionAnalytics>): Promise<void> {
    const { error } = await this.client
      .from('extraction_analytics')
      .upsert({
        date: analytics.date!,
        site_pattern: analytics.site_pattern,
        data_type: analytics.data_type,
        total_extractions: analytics.total_extractions || 0,
        successful_extractions: analytics.successful_extractions || 0,
        failed_extractions: analytics.failed_extractions || 0,
        cache_hits: analytics.cache_hits || 0,
        cache_misses: analytics.cache_misses || 0,
        total_ai_cost: analytics.total_ai_cost || 0,
        avg_execution_time: analytics.avg_execution_time,
        avg_confidence_score: analytics.avg_confidence_score
      }, {
        onConflict: 'date,site_pattern,data_type'
      });

    if (error) {
      logger.error({ error, analytics }, 'Failed to record daily analytics');
      throw error;
    }
  }

  async getAnalytics(
    startDate: string,
    endDate: string,
    sitePattern?: string,
    dataType?: string
  ): Promise<ExtractionAnalytics[]> {
    let query = this.client
      .from('extraction_analytics')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate);

    if (sitePattern) query = query.eq('site_pattern', sitePattern);
    if (dataType) query = query.eq('data_type', dataType);

    const { data, error } = await query.order('date', { ascending: false });

    if (error) {
      logger.error({ error }, 'Failed to get analytics');
      throw error;
    }

    return data || [];
  }

  // Utility methods
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('ai_workers')
        .select('id')
        .limit(1);

      return !error;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return false;
    }
  }

  async cleanup(): Promise<void> {
    // Clean up old completed jobs (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const { error } = await this.client
      .from('extraction_queue_v2')
      .delete()
      .eq('status', 'completed')
      .lt('completed_at', thirtyDaysAgo);

    if (error) {
      logger.error({ error }, 'Failed to cleanup old jobs');
      throw error;
    }

    logger.info('Database cleanup completed');
  }
}

// Singleton instance
export const supabaseV2 = new SupabaseClientV2();
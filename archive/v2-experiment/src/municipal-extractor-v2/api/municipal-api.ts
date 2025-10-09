// Municipal Data Extractor v2 - REST API
// Completely separate API from the existing extractor

import express from 'express';
import { logger } from '../../utils/logger';
import { supabaseV2 } from '../database/supabase-client-v2';
import { municipalPatternRecognizer } from '../patterns/municipal-patterns';
import {
  ExtractionRequest,
  ExtractionResponse,
  BatchExtractionRequest,
  ExtractionJobV2,
  // StandardizedExtractionResult - commented out as unused
} from '../types';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.MUNICIPAL_API_PORT || 3001; // Different port from v1

// Middleware
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  next();
});
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((_req, _res, next) => {
  logger.info({ 
    method: _req.method, 
    url: _req.url,
    ip: _req.ip
  }, 'API request received');
  next();
});

// Health check endpoint
app.get('/health', async (_req, res) => {
  try {
    const dbHealth = await supabaseV2.healthCheck();
    const activeWorkers = await supabaseV2.getActiveWorkers();
    
    return res.json({
      status: 'healthy',
      version: '2.0.0',
      database: dbHealth ? 'connected' : 'disconnected',
      active_workers: activeWorkers.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return res.status(503).json({
      status: 'unhealthy',
      error: 'Service unavailable'
    });
  }
});

// Create extraction job
app.post('/api/v2/extractions', async (req, res) => {
  try {
    const request: ExtractionRequest = req.body;
    
    // Validate request
    const validation = validateExtractionRequest(request);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.errors
      });
    }

    // Check if site pattern is recognized
    const sitePattern = await municipalPatternRecognizer.recognizeSitePattern(request.site_url);
    
    // Estimate cost and completion time
    const estimates = await estimateJobCost(request, sitePattern);

    // Create job in database
    const job = await supabaseV2.createExtractionJob({
      site_url: request.site_url,
      data_type: request.data_type,
      target_fields: request.target_fields,
      filters: request.filters,
      priority: request.priority || 'normal',
      cost_estimate: estimates.cost,
      used_cache: false
    });

    const response: ExtractionResponse = {
      job_id: job.id,
      status: job.status,
      estimated_completion_time: estimates.completion_time,
      estimated_cost: estimates.cost
    };

    logger.info({ 
      job_id: job.id,
      site_url: request.site_url,
      data_type: request.data_type 
    }, 'Extraction job created');

    return res.status(201).json(response);

  } catch (error) {
    logger.error({ error, request: req.body }, 'Failed to create extraction job');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to create extraction job'
    });
  }
});

// Get job status
app.get('/api/v2/extractions/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Get job from database (this would need to be implemented in supabase client)
    const job = await getJobById(jobId);
    
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        job_id: jobId
      });
    }

    const response = {
      job_id: job.id,
      status: job.status,
      created_at: job.created_at,
      processing_started_at: job.processing_started_at,
      completed_at: job.completed_at,
      progress: calculateProgress(job),
      worker_id: job.worker_id,
      attempts: job.attempts,
      result_data: job.status === 'completed' ? job.result_data : undefined,
      standardized_data: job.status === 'completed' ? job.standardized_data : undefined,
      error_message: job.error_message,
      cost: job.actual_cost,
      used_cache: job.used_cache,
      cache_hit_rate: job.cache_hit_rate
    };

    return res.json(response);

  } catch (error) {
    logger.error({ error, job_id: req.params.jobId }, 'Failed to get job status');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get job status'
    });
  }
});

// List jobs
app.get('/api/v2/extractions', async (req, res) => {
  try {
    const {
      status,
      data_type,
      site_pattern,
      limit = 50,
      offset = 0
    } = req.query;

    // This would need to be implemented in the supabase client
    const jobs = await listJobs({
      status: status as string,
      data_type: data_type as string,
      site_pattern: site_pattern as string,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });

    return res.json({
      jobs: jobs.map(job => ({
        job_id: job.id,
        site_url: job.site_url,
        data_type: job.data_type,
        status: job.status,
        created_at: job.created_at,
        completed_at: job.completed_at,
        used_cache: job.used_cache,
        cost: job.actual_cost
      })),
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total: jobs.length // Would be actual total count
      }
    });

  } catch (error) {
    logger.error({ error, query: req.query }, 'Failed to list jobs');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list jobs'
    });
  }
});

// Batch extraction
app.post('/api/v2/extractions/batch', async (req, res) => {
  try {
    const batchRequest: BatchExtractionRequest = req.body;
    
    if (!batchRequest.jobs || batchRequest.jobs.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'At least one job must be provided'
      });
    }

    if (batchRequest.jobs.length > 100) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Maximum 100 jobs per batch'
      });
    }

    // Validate all jobs
    const validationResults = batchRequest.jobs.map(job => validateExtractionRequest(job));
    const invalidJobs = validationResults.filter(result => !result.valid);
    
    if (invalidJobs.length > 0) {
      return res.status(400).json({
        error: 'Invalid jobs in batch',
        invalid_jobs: invalidJobs
      });
    }

    // Create all jobs
    const createdJobs: ExtractionJobV2[] = [];
    let totalEstimatedCost = 0;

    for (const jobRequest of batchRequest.jobs) {
      const sitePattern = await municipalPatternRecognizer.recognizeSitePattern(jobRequest.site_url);
      const estimates = await estimateJobCost(jobRequest, sitePattern);
      
      const job = await supabaseV2.createExtractionJob({
        site_url: jobRequest.site_url,
        data_type: jobRequest.data_type,
        target_fields: jobRequest.target_fields,
        filters: jobRequest.filters,
        priority: batchRequest.batch_priority || 'normal',
        cost_estimate: estimates.cost,
        used_cache: false
      });
      
      createdJobs.push(job);
      totalEstimatedCost += estimates.cost;
    }

    logger.info({ 
      batch_size: createdJobs.length,
      total_estimated_cost: totalEstimatedCost 
    }, 'Batch extraction jobs created');

    return res.status(201).json({
      batch_id: uuidv4(),
      jobs: createdJobs.map(job => ({
        job_id: job.id,
        status: job.status
      })),
      total_jobs: createdJobs.length,
      estimated_total_cost: totalEstimatedCost
    });

  } catch (error) {
    logger.error({ error, request: req.body }, 'Failed to create batch extraction jobs');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to create batch extraction jobs'
    });
  }
});

// Cancel job
app.post('/api/v2/extractions/:jobId/cancel', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    const job = await getJobById(jobId);
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        job_id: jobId
      });
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(400).json({
        error: 'Cannot cancel job',
        message: `Job is already ${job.status}`,
        job_id: jobId
      });
    }

    // Update job status to cancelled (would need to be implemented)
    await cancelJob(jobId);

    logger.info({ job_id: jobId }, 'Job cancelled');

    return res.json({
      job_id: jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully'
    });

  } catch (error) {
    logger.error({ error, job_id: req.params.jobId }, 'Failed to cancel job');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to cancel job'
    });
  }
});

// Get system metrics
app.get('/api/v2/metrics', async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      site_pattern,
      data_type
    } = req.query;

    const startDate = start_date ? new Date(start_date as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = end_date ? new Date(end_date as string) : new Date();

    const analytics = await supabaseV2.getAnalytics(
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      site_pattern as string,
      data_type as string
    );

    const activeWorkers = await supabaseV2.getActiveWorkers();

    // Calculate aggregate metrics
    const totalExtractions = analytics.reduce((sum, day) => sum + day.total_extractions, 0);
    const successfulExtractions = analytics.reduce((sum, day) => sum + day.successful_extractions, 0);
    const totalCacheHits = analytics.reduce((sum, day) => sum + day.cache_hits, 0);
    const totalCacheMisses = analytics.reduce((sum, day) => sum + day.cache_misses, 0);
    const totalCost = analytics.reduce((sum, day) => sum + day.total_ai_cost, 0);

    const successRate = totalExtractions > 0 ? (successfulExtractions / totalExtractions) * 100 : 0;
    const cacheHitRate = (totalCacheHits + totalCacheMisses) > 0 
      ? (totalCacheHits / (totalCacheHits + totalCacheMisses)) * 100 
      : 0;

    return res.json({
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      },
      totals: {
        extractions: totalExtractions,
        successful_extractions: successfulExtractions,
        failed_extractions: totalExtractions - successfulExtractions,
        success_rate_percent: Math.round(successRate * 100) / 100,
        cache_hits: totalCacheHits,
        cache_misses: totalCacheMisses,
        cache_hit_rate_percent: Math.round(cacheHitRate * 100) / 100,
        total_ai_cost: Math.round(totalCost * 100) / 100,
        cost_savings_from_cache: Math.round((totalCacheHits * 0.09) * 100) / 100 // 90% savings per cache hit
      },
      workers: {
        active_count: activeWorkers.length,
        workers: activeWorkers.map(worker => ({
          worker_id: worker.worker_id,
          status: worker.status,
          jobs_completed: worker.jobs_completed,
          jobs_failed: worker.jobs_failed,
          last_heartbeat: worker.last_heartbeat
        }))
      },
      daily_breakdown: analytics.map(day => ({
        date: day.date,
        extractions: day.total_extractions,
        success_rate: day.total_extractions > 0 
          ? Math.round((day.successful_extractions / day.total_extractions) * 10000) / 100
          : 0,
        cache_hit_rate: (day.cache_hits + day.cache_misses) > 0
          ? Math.round((day.cache_hits / (day.cache_hits + day.cache_misses)) * 10000) / 100
          : 0,
        cost: day.total_ai_cost,
        avg_execution_time: day.avg_execution_time
      }))
    });

  } catch (error) {
    logger.error({ error, query: req.query }, 'Failed to get metrics');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get metrics'
    });
  }
});

// Get supported sites
app.get('/api/v2/sites', async (_req, res) => {
  try {
    const sitePatterns = await supabaseV2.getSitePatternByType('municipal');
    
    return res.json({
      supported_sites: sitePatterns.map(pattern => ({
        domain: pattern.site_domain,
        name: pattern.site_name,
        type: pattern.site_type,
        language: pattern.language,
        success_rate: Math.round(pattern.success_rate * 10000) / 100,
        supported_data_types: pattern.data_patterns.map(dp => dp.data_type),
        last_validated: pattern.last_validated
      }))
    });

  } catch (error) {
    logger.error({ error }, 'Failed to get supported sites');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get supported sites'
    });
  }
});

// Dashboard endpoint (serves HTML)
app.get('/dashboard', (_req, res) => {
  const dashboardHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Municipal Extractor v2 Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .metric { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 5px; }
        .metric h3 { margin-top: 0; color: #333; }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .danger { color: #dc3545; }
    </style>
</head>
<body>
    <h1>Municipal Data Extractor v2 Dashboard</h1>
    <div id="metrics"></div>
    
    <script>
        async function loadMetrics() {
            try {
                const response = await fetch('/api/v2/metrics');
                const data = await response.json();
                
                document.getElementById('metrics').innerHTML = \`
                    <div class="metric">
                        <h3>System Overview</h3>
                        <p><strong>Success Rate:</strong> <span class="success">\${data.totals.success_rate_percent}%</span></p>
                        <p><strong>Cache Hit Rate:</strong> <span class="success">\${data.totals.cache_hit_rate_percent}%</span></p>
                        <p><strong>Total Cost:</strong> $\${data.totals.total_ai_cost}</p>
                        <p><strong>Cost Savings:</strong> <span class="success">$\${data.totals.cost_savings_from_cache}</span></p>
                        <p><strong>Active Workers:</strong> \${data.workers.active_count}</p>
                    </div>
                    
                    <div class="metric">
                        <h3>Recent Activity</h3>
                        <p><strong>Total Extractions:</strong> \${data.totals.extractions}</p>
                        <p><strong>Successful:</strong> <span class="success">\${data.totals.successful_extractions}</span></p>
                        <p><strong>Failed:</strong> <span class="danger">\${data.totals.failed_extractions}</span></p>
                    </div>
                \`;
            } catch (error) {
                console.error('Failed to load metrics:', error);
                document.getElementById('metrics').innerHTML = '<p class="danger">Failed to load metrics</p>';
            }
        }
        
        loadMetrics();
        setInterval(loadMetrics, 30000); // Refresh every 30 seconds
    </script>
</body>
</html>
  `;

  res.send(dashboardHTML);
});

// Error handling
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ error, url: req.url, method: req.method }, 'Unhandled API error');
  
  return res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// Helper functions
function validateExtractionRequest(request: ExtractionRequest): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  if (!request.site_url) {
    errors.push('site_url is required');
  } else {
    try {
      new URL(request.site_url);
    } catch {
      errors.push('site_url must be a valid URL');
    }
  }

  if (!request.data_type) {
    errors.push('data_type is required');
  } else if (!['permits', 'zoning', 'flooding', 'taxes', 'notices'].includes(request.data_type)) {
    errors.push('data_type must be one of: permits, zoning, flooding, taxes, notices');
  }

  if (!request.target_fields || request.target_fields.length === 0) {
    errors.push('target_fields is required and must not be empty');
  }

  if (request.priority && !['low', 'normal', 'high'].includes(request.priority)) {
    errors.push('priority must be one of: low, normal, high');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

async function estimateJobCost(
  request: ExtractionRequest,
  sitePattern: any
): Promise<{ cost: number; completion_time: number }> {
  // Estimate based on whether we have cached processes
  let estimatedCost = 0.10; // Base AI cost
  let completionTime = 60000; // 1 minute base time

  if (sitePattern) {
    // Known site patterns are faster and cheaper
    estimatedCost *= 0.7;
    completionTime *= 0.8;
  }

  // More fields = higher cost and time
  const fieldMultiplier = Math.max(1, request.target_fields.length / 5);
  estimatedCost *= fieldMultiplier;
  completionTime *= fieldMultiplier;

  return {
    cost: Math.round(estimatedCost * 100) / 100,
    completion_time: Math.round(completionTime)
  };
}

function calculateProgress(job: ExtractionJobV2): number {
  if (job.status === 'pending') return 0;
  if (job.status === 'processing') return 50;
  if (job.status === 'completed' || job.status === 'failed') return 100;
  return 0;
}

// These would be implemented in the supabase client
async function getJobById(_jobId: string): Promise<ExtractionJobV2 | null> {
  // Mock implementation
  return null;
}

async function listJobs(_filters: any): Promise<ExtractionJobV2[]> {
  // Mock implementation
  return [];
}

async function cancelJob(_jobId: string): Promise<void> {
  // Mock implementation
}

// Start server
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Municipal Extractor v2 API server started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down API server');
  server.close(() => {
    logger.info('API server shut down');
  });
});

export default app;
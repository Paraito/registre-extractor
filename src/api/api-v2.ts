import express, { Request, Response, NextFunction } from 'express';
import { QueueManagerV2 } from '../queue/queue-manager-v2';
import { logger } from '../utils/logger';
import { config } from '../config';
import { z } from 'zod';
import path from 'path';

const app = express();
const queueManager = new QueueManagerV2();

// Middleware
app.use(express.json());
app.use((req, _res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
  }, 'API Request');
  next();
});

// Request validation schemas
const createExtractionSchema = z.object({
  document_source: z.enum(['acte', 'index', 'plan_cadastraux']),
  document_number: z.string().min(1),
  document_number_normalized: z.string().optional(),
  circonscription_fonciere: z.string().optional(),
  cadastre: z.string().optional(),
  designation_secondaire: z.string().optional(),
  acte_type: z.enum(['Acte', 'Avis d\'adresse', 'Radiation', 'Acte divers']).optional(),
}).refine((data) => {
  // Validation based on document source
  if (data.document_source === 'index' || data.document_source === 'plan_cadastraux') {
    return !!data.cadastre;
  }
  if (data.document_source === 'acte') {
    return !!data.acte_type;
  }
  return true;
}, {
  message: 'Missing required fields for the specified document source'
});

// Error handler middleware
const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err, url: req.url }, 'API Error');
  
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  return res.status(500).json({
    error: 'Internal server error',
    message: config.isDevelopment ? err.message : undefined,
  });
};

// Routes

// Serve monitoring dashboard
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'dashboard-v2.html'));
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get API info
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    name: 'Registre Extractor API V2',
    version: '2.0.0',
    endpoints: {
      'POST /api/extractions': 'Create new extraction job',
      'GET /api/extractions/:id': 'Get extraction job status',
      'GET /api/extractions': 'List extraction jobs',
      'POST /api/extractions/:id/retry': 'Retry failed extraction',
      'DELETE /api/extractions/:id': 'Cancel extraction job',
      'GET /api/metrics': 'Get system metrics',
      'GET /api/workers': 'Get worker status',
    },
  });
});

// Create extraction job
app.post('/api/extractions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createExtractionSchema.parse(req.body);
    
    const job = await queueManager.createJob(body);
    
    res.status(201).json({
      extraction_id: job.id,
      document_source: job.document_source,
      status: job.status,
      document_number: job.document_number,
      document_number_normalized: job.document_number_normalized,
      created_at: job.created_at,
      estimated_completion: new Date(Date.now() + 180000).toISOString(), // 3 minutes estimate
    });
  } catch (error) {
    next(error);
  }
});

// Get extraction job status
app.get('/api/extractions/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const job = await queueManager.getJobStatus(req.params.id);
    
    if (!job) {
      res.status(404).json({ error: 'Extraction job not found' });
      return;
    }
    
    res.json({
      extraction_id: job.id,
      document_source: job.document_source,
      status: job.status,
      document_number: job.document_number,
      document_number_normalized: job.document_number_normalized,
      supabase_path: job.supabase_path,
      error_message: job.error_message,
      created_at: job.created_at,
      processing_started_at: job.processing_started_at,
      worker_id: job.worker_id,
      attempts: job.attemtps,
    });
  } catch (error) {
    next(error);
  }
});

// List extraction jobs
app.get('/api/extractions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string || 'all';
    const jobs = await queueManager.getJobsByStatus(status);
    
    res.json({
      total: jobs.length,
      jobs: jobs.map(job => ({
        extraction_id: job.id,
        document_source: job.document_source,
        status: job.status,
        document_number: job.document_number,
        document_number_normalized: job.document_number_normalized,
        circonscription_fonciere: job.circonscription_fonciere,
        created_at: job.created_at,
        processing_started_at: job.processing_started_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Retry failed extraction
app.post('/api/extractions/:id/retry', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await queueManager.retryJob(_req.params.id);
    
    res.json({
      message: 'Extraction job requeued for retry',
      extraction_id: _req.params.id,
    });
  } catch (error) {
    next(error);
  }
});

// Cancel extraction job
app.delete('/api/extractions/:id', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await queueManager.cancelJob(_req.params.id);
    
    res.json({
      message: 'Extraction job cancelled',
      extraction_id: _req.params.id,
    });
  } catch (error) {
    next(error);
  }
});

// Get system metrics
app.get('/api/metrics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const queueMetrics = await queueManager.getQueueMetrics();
    const workerMetrics = await queueManager.getWorkerMetrics();
    
    res.json({
      queue: queueMetrics,
      workers: {
        total: workerMetrics.length,
        active: workerMetrics.filter((w: any) => w.status === 'busy').length,
        idle: workerMetrics.filter((w: any) => w.status === 'idle').length,
        error: workerMetrics.filter((w: any) => w.status === 'error').length,
        offline: workerMetrics.filter((w: any) => w.status === 'offline').length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// Get worker status
app.get('/api/workers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await queueManager.getWorkerMetrics();
    
    res.json({
      workers: workers.map((w: any) => ({
        worker_id: w.worker_id,
        status: w.status,
        current_job_id: w.current_job_id,
        last_heartbeat: w.last_heartbeat,
        jobs_completed: w.jobs_completed,
        jobs_failed: w.jobs_failed,
        uptime: Date.now() - new Date(w.started_at).getTime(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Apply error handler
app.use(errorHandler);

// Start server
const server = app.listen(config.api.port, config.api.host, () => {
  logger.info({
    port: config.api.port,
    host: config.api.host,
    env: config.env,
  }, 'API V2 server started');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    queueManager.close().then(() => {
      process.exit(0);
    });
  });
});

export { app };
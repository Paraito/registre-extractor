import express, { Request, Response, NextFunction } from 'express';
import { QueueManager } from '../queue/manager';
import { logger } from '../utils/logger';
import { config } from '../config';
import { z } from 'zod';
import path from 'path';
import { supabase } from '../utils/supabase';

const app = express();
const queueManager = new QueueManager();

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
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get API info
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    name: 'Registre Extractor API',
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
      status_id: job.status_id,
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
      status_id: job.status_id,
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
        status_id: job.status_id,
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

// Get worker status with account info
app.get('/api/workers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await queueManager.getWorkerMetrics();
    
    // Get account info for workers
    const workerIds = workers.map((w: any) => w.account_id).filter(Boolean);
    let accounts: any[] = [];
    
    if (workerIds.length > 0) {
      const { data } = await supabase
        .from('worker_accounts')
        .select('id, username')
        .in('id', workerIds);
      accounts = data || [];
    }
    
    res.json({
      workers: workers.map((w: any) => {
        const account = accounts.find(a => a.id === w.account_id);
        return {
          worker_id: w.worker_id,
          status: w.status,
          current_job_id: w.current_job_id,
          last_heartbeat: w.last_heartbeat,
          jobs_completed: w.jobs_completed,
          jobs_failed: w.jobs_failed,
          started_at: w.started_at,
          account_id: w.account_id,
          account_username: account?.username,
          uptime: Date.now() - new Date(w.started_at).getTime(),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

// Get all tasks (extraction, REQ, RDPRM) - unified view
app.get('/api/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    // Fetch from all three tables in parallel
    const [extractionJobs, reqSessions, rdprmSearches] = await Promise.all([
      // Extraction jobs
      (async () => {
        const { data, error } = await supabase
          .from('extraction_queue')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return (data || []).map((job: any) => ({
          id: job.id,
          type: 'Extraction',
          subtype: job.document_source,
          identifier: job.document_number,
          status: getStatusName(job.status_id),
          status_id: job.status_id,
          worker_id: job.worker_id,
          error_message: job.error_message,
          created_at: job.created_at,
          processing_started_at: job.processing_started_at,
        }));
      })(),

      // REQ sessions
      (async () => {
        const { data, error } = await supabase
          .from('search_sessions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return (data || []).map((session: any) => ({
          id: session.id,
          type: 'REQ',
          subtype: 'Business Registry',
          identifier: session.initial_search_query,
          status: session.status === 'completed' ? 'Complété' :
                  session.status === 'processing' ? 'En traitement' :
                  session.status === 'failed' ? 'Erreur' : 'En attente',
          status_id: session.status === 'completed' ? 3 :
                     session.status === 'processing' ? 2 :
                     session.status === 'failed' ? 4 : 1,
          worker_id: null,
          error_message: session.error_message,
          created_at: session.created_at,
          processing_started_at: null,
        }));
      })(),

      // RDPRM searches
      (async () => {
        const { data, error } = await supabase
          .from('rdprm_searches')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return (data || []).map((search: any) => ({
          id: search.id,
          type: 'RDPRM',
          subtype: 'Personal/Movable Rights',
          identifier: search.search_name,
          status: search.status === 'completed' ? 'Complété' :
                  search.status === 'processing' ? 'En traitement' :
                  search.status === 'failed' ? 'Erreur' : 'En attente',
          status_id: search.status === 'completed' ? 3 :
                     search.status === 'processing' ? 2 :
                     search.status === 'failed' ? 4 : 1,
          worker_id: null,
          error_message: search.error_message,
          created_at: search.created_at,
          processing_started_at: null,
        }));
      })(),
    ]);

    // Combine and sort all tasks by created_at
    const allTasks = [...extractionJobs, ...reqSessions, ...rdprmSearches]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    res.json({
      tasks: allTasks,
      total: allTasks.length,
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to get status name from status_id
function getStatusName(statusId: number): string {
  const statusMap: { [key: number]: string } = {
    1: 'En attente',
    2: 'En traitement',
    3: 'Complété',
    4: 'Erreur',
    5: 'Extraction Complété',
    6: 'OCR en traitement',
  };
  return statusMap[statusId] || 'Inconnu';
}

// Server-Sent Events endpoint for real-time updates
app.get('/api/stream', async (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial data
  const sendUpdate = async () => {
    try {
      // Fetch workers
      const { data: workers, error: workersError } = await supabase
        .from('worker_status')
        .select('*')
        .order('last_heartbeat', { ascending: false });

      if (workersError) throw workersError;

      // Fetch tasks from all three tables
      const [extractionJobs, reqSessions, rdprmSearches] = await Promise.all([
        // Extraction jobs
        (async () => {
          const { data, error } = await supabase
            .from('extraction_queue')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;
          return (data || []).map((job: any) => ({
            id: job.id,
            type: 'Extraction',
            subtype: job.document_source,
            identifier: job.document_number,
            status: getStatusName(job.status_id),
            status_id: job.status_id,
            worker_id: job.worker_id,
            error_message: job.error_message,
            created_at: job.created_at,
            processing_started_at: job.processing_started_at,
          }));
        })(),

        // REQ sessions
        (async () => {
          const { data, error } = await supabase
            .from('search_sessions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;
          return (data || []).map((session: any) => ({
            id: session.id,
            type: 'REQ',
            subtype: 'Business Registry',
            identifier: session.initial_search_query,
            status: session.status === 'completed' ? 'Complété' :
                    session.status === 'processing' ? 'En traitement' :
                    session.status === 'failed' ? 'Erreur' : 'En attente',
            status_id: session.status === 'completed' ? 3 :
                       session.status === 'processing' ? 2 :
                       session.status === 'failed' ? 4 : 1,
            worker_id: null,
            error_message: session.error_message,
            created_at: session.created_at,
            processing_started_at: null,
          }));
        })(),

        // RDPRM searches
        (async () => {
          const { data, error } = await supabase
            .from('rdprm_searches')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;
          return (data || []).map((search: any) => ({
            id: search.id,
            type: 'RDPRM',
            subtype: 'Personal/Movable Rights',
            identifier: search.search_name,
            status: search.status === 'completed' ? 'Complété' :
                    search.status === 'processing' ? 'En traitement' :
                    search.status === 'failed' ? 'Erreur' : 'En attente',
            status_id: search.status === 'completed' ? 3 :
                       search.status === 'processing' ? 2 :
                       search.status === 'failed' ? 4 : 1,
            worker_id: null,
            error_message: search.error_message,
            created_at: search.created_at,
            processing_started_at: null,
          }));
        })(),
      ]);

      // Combine and sort all tasks
      const allTasks = [...extractionJobs, ...reqSessions, ...rdprmSearches]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);

      const data = {
        workers: workers || [],
        tasks: allTasks,
        timestamp: new Date().toISOString(),
      };

      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error({ error }, 'Error sending SSE update');
    }
  };

  // Send initial update
  sendUpdate();

  // Send updates every 2 seconds
  const interval = setInterval(sendUpdate, 2000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// Apply error handler
app.use(errorHandler);

// Start server
const server = app.listen(config.api.port, config.api.host, () => {
  logger.info({
    port: config.api.port,
    host: config.api.host,
    env: config.env,
  }, 'API server started');
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
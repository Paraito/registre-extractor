import Bull from 'bull';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ExtractionQueueJob } from '../types';

export class QueueManager {
  private queue: Bull.Queue<ExtractionQueueJob>;

  constructor() {
    this.queue = new Bull('extraction-queue', {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
      },
    });

    this.setupQueueEvents();
    this.syncWithDatabase();
  }

  private setupQueueEvents(): void {
    this.queue.on('completed', async (job, result) => {
      logger.info({ jobId: job.id, result }, 'Queue job completed');
    });

    this.queue.on('failed', async (job, err) => {
      logger.error({ jobId: job.id, error: err }, 'Queue job failed');
    });

    this.queue.on('stalled', async (job) => {
      logger.warn({ jobId: job.id }, 'Queue job stalled');
    });
  }

  private async syncWithDatabase(): Promise<void> {
    // Sync pending jobs from database on startup
    try {
      const { data: pendingJobs, error } = await supabase
        .from('extraction_queue')
        .select('*')
        .in('status', ['En attente', 'En traitement'])
        .order('created_at', { ascending: true });

      if (error) {
        logger.error({ error }, 'Failed to fetch pending jobs');
        return;
      }

      if (pendingJobs && pendingJobs.length > 0) {
        logger.info({ count: pendingJobs.length }, 'Re-queuing pending jobs from database');
        
        for (const job of pendingJobs) {
          // Reset processing jobs back to waiting
          if (job.status === 'En traitement') {
            await supabase
              .from('extraction_queue')
              .update({ 
                status: 'En attente',
                worker_id: null,
                processing_started_at: null,
              })
              .eq('id', job.id);
          }

          await this.addJobToQueue(job);
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to sync with database');
    }
  }

  async createJob(params: {
    document_source: 'acte' | 'index' | 'plan_cadastraux';
    document_number: string;
    document_number_normalized?: string;
    circonscription_fonciere?: string;
    cadastre?: string;
    designation_secondaire?: string;
    acte_type?: 'Acte' | 'Avis d\'adresse' | 'Radiation' | 'Acte divers';
  }): Promise<ExtractionQueueJob> {
    const job: Partial<ExtractionQueueJob> = {
      document_source: params.document_source,
      document_number: params.document_number,
      document_number_normalized: params.document_number_normalized || params.document_number.replace(/\s+/g, ''),
      circonscription_fonciere: params.circonscription_fonciere,
      cadastre: params.cadastre,
      designation_secondaire: params.designation_secondaire,
      acte_type: params.acte_type,
      status: 'En attente',
      attemtps: 0,
      max_attempts: 3,
    };

    // Validate required fields
    if (params.document_source === 'index' || params.document_source === 'plan_cadastraux') {
      if (!params.cadastre) {
        throw new Error(`cadastre is required for ${params.document_source}`);
      }
    }

    if (params.document_source === 'acte' && !params.acte_type) {
      throw new Error('acte_type is required for acte documents');
    }

    // Save to database
    const { data, error } = await supabase
      .from('extraction_queue')
      .insert(job)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create job: ${error.message}`);
    }

    // Add to queue
    await this.addJobToQueue(data);

    logger.info({ 
      jobId: data.id, 
      documentNumber: data.document_number,
      documentSource: data.document_source 
    }, 'Job created');
    
    return data;
  }

  private async addJobToQueue(job: ExtractionQueueJob): Promise<void> {
    await this.queue.add(job, {
      jobId: job.id,
      priority: 2, // Default priority
      attempts: job.attemtps || 0, // Note: typo in database field
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
  }

  async getJobStatus(jobId: string): Promise<ExtractionQueueJob | null> {
    const { data, error } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async getJobsByStatus(status: string): Promise<ExtractionQueueJob[]> {
    const statusMap: Record<string, string> = {
      'all': '',
      'queued': 'En attente',
      'processing': 'En traitement',
      'completed': 'Complété',
      'failed': 'Erreur',
    };

    const mappedStatus = statusMap[status] || status;

    const query = supabase
      .from('extraction_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (mappedStatus && mappedStatus !== '') {
      query.eq('status', mappedStatus);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error }, 'Failed to fetch jobs by status');
      return [];
    }

    return data || [];
  }

  async retryJob(jobId: string): Promise<void> {
    const { data: job, error } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      throw new Error('Job not found');
    }

    if (job.status !== 'Erreur') {
      throw new Error('Can only retry failed jobs');
    }

    // Reset job status
    await supabase
      .from('extraction_queue')
      .update({
        status: 'En attente',
        error_message: null,
        worker_id: null,
        processing_started_at: null,
      })
      .eq('id', jobId);

    // Re-queue the job
    await this.addJobToQueue(job);
  }

  async cancelJob(jobId: string): Promise<void> {
    // Remove from Bull queue
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }

    // Update database
    await supabase
      .from('extraction_queue')
      .update({
        status: 'Erreur',
        error_message: 'Job cancelled by user',
      })
      .eq('id', jobId);
  }

  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
    };
  }

  async getWorkerMetrics() {
    const { data, error } = await supabase
      .from('worker_status')
      .select('*')
      .order('last_heartbeat', { ascending: false });

    if (error) {
      logger.error({ error }, 'Failed to fetch worker metrics');
      return [];
    }

    return data || [];
  }

  async getNextWaitingJob(): Promise<ExtractionQueueJob | null> {
    const { data, error } = await supabase
      .from('extraction_queue')
      .select('*')
      .eq('status', 'En attente')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

// Helper functions to convert between old and new formats
export function convertToExtractionConfig(job: ExtractionQueueJob): any {
  const config: any = {
    document_type: job.document_source === 'plan_cadastraux' ? 'plans_cadastraux' : job.document_source === 'acte' ? 'actes' : 'index',
    circumscription: job.circonscription_fonciere || 'Montréal',
    cadastre: job.cadastre,
    designation_secondaire: job.designation_secondaire,
  };

  // Use document_number_normalized if available, otherwise document_number
  const documentNumber = job.document_number_normalized || job.document_number;

  if (job.document_source === 'acte') {
    config.type_document = job.acte_type;
    config.numero_inscription = documentNumber;
  } else {
    config.lot_number = documentNumber;
  }

  return config;
}
/**
 * Worker Pool Manager
 * 
 * Dynamically allocates OCR workers between index and acte processing
 * based on queue composition. Rebalances every 30 seconds.
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface QueueAnalysis {
  indexCount: number;
  acteCount: number;
  totalCount: number;
  indexRatio: number;  // 0.0 - 1.0
  acteRatio: number;   // 0.0 - 1.0
}

export interface WorkerAllocation {
  indexWorkers: number;
  acteWorkers: number;
  totalWorkers: number;
}

export interface WorkerAssignment {
  workerId: string;
  assignedMode: 'index' | 'acte';
  lastUpdated: number;
}

export class WorkerPoolManager {
  private redis: RedisClientType;
  private isConnected: boolean = false;
  private supabaseClients: Map<string, SupabaseClient> = new Map();
  
  // Configuration
  private poolSize: number;
  private minIndexWorkers: number;
  private minActeWorkers: number;
  private rebalanceInterval: number;
  
  // Redis keys
  private readonly POOL_ALLOCATION_KEY = 'worker_pool:allocation';
  private readonly WORKER_ASSIGNMENTS_KEY = 'worker_pool:assignments';
  
  // Rebalance timer
  private rebalanceTimer?: NodeJS.Timeout;
  
  constructor(
    poolSize: number,
    minIndexWorkers: number = 1,
    minActeWorkers: number = 1,
    rebalanceInterval: number = 30000,
    redisUrl?: string
  ) {
    this.poolSize = poolSize;
    this.minIndexWorkers = minIndexWorkers;
    this.minActeWorkers = minActeWorkers;
    this.rebalanceInterval = rebalanceInterval;
    
    // Create Redis client
    this.redis = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // Handle Redis errors
    this.redis.on('error', (err: Error) => {
      logger.error({ error: err }, 'Redis error in worker pool manager');
      this.isConnected = false;
    });
    
    this.redis.on('connect', () => {
      logger.info('Worker pool manager connected to Redis');
      this.isConnected = true;
    });
  }
  
  /**
   * Initialize the pool manager
   */
  async initialize(): Promise<void> {
    // Connect to Redis
    await this.connect();
    
    // Initialize Supabase clients for all environments
    this.initializeSupabaseClients();
    
    // Set initial allocation (50/50 split)
    const initialAllocation: WorkerAllocation = {
      indexWorkers: Math.floor(this.poolSize / 2),
      acteWorkers: Math.ceil(this.poolSize / 2),
      totalWorkers: this.poolSize
    };
    
    await this.redis.set(
      this.POOL_ALLOCATION_KEY,
      JSON.stringify(initialAllocation)
    );
    
    logger.info({
      poolSize: this.poolSize,
      minIndexWorkers: this.minIndexWorkers,
      minActeWorkers: this.minActeWorkers,
      rebalanceInterval: this.rebalanceInterval,
      initialAllocation
    }, 'Worker pool manager initialized');
  }
  
  /**
   * Connect to Redis
   */
  private async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.redis.connect();
    }
  }
  
  /**
   * Initialize Supabase clients for all environments
   */
  private initializeSupabaseClients(): void {
    const environments = config.environments;

    for (const [envName, envConfig] of Object.entries(environments)) {
      if (envConfig && envConfig.url && envConfig.serviceKey) {
        const client = createSupabaseClient(envConfig.url, envConfig.serviceKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });

        this.supabaseClients.set(envName, client);
        logger.info({ environment: envName }, 'Initialized Supabase client for pool manager');
      }
    }
  }
  
  /**
   * Analyze queue composition across all environments
   */
  async analyzeQueue(): Promise<QueueAnalysis> {
    let totalIndexCount = 0;
    let totalActeCount = 0;
    
    // Query all environments
    for (const [envName, client] of this.supabaseClients.entries()) {
      try {
        // Count index documents
        const { count: indexCount } = await client
          .from('extraction_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status_id', 3)
          .eq('document_source', 'index');
        
        // Count acte documents
        const { count: acteCount } = await client
          .from('extraction_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status_id', 3)
          .eq('document_source', 'acte');
        
        totalIndexCount += indexCount || 0;
        totalActeCount += acteCount || 0;
        
        logger.debug({
          environment: envName,
          indexCount,
          acteCount
        }, 'Queue analysis for environment');
        
      } catch (error) {
        logger.error({
          error,
          environment: envName
        }, 'Failed to analyze queue for environment');
      }
    }
    
    const totalCount = totalIndexCount + totalActeCount;
    
    return {
      indexCount: totalIndexCount,
      acteCount: totalActeCount,
      totalCount,
      indexRatio: totalCount > 0 ? totalIndexCount / totalCount : 0.5,
      acteRatio: totalCount > 0 ? totalActeCount / totalCount : 0.5
    };
  }
  
  /**
   * Calculate optimal worker allocation based on queue analysis
   */
  calculateAllocation(analysis: QueueAnalysis): WorkerAllocation {
    // If queue is empty, use balanced allocation
    if (analysis.totalCount === 0) {
      return {
        indexWorkers: Math.floor(this.poolSize / 2),
        acteWorkers: Math.ceil(this.poolSize / 2),
        totalWorkers: this.poolSize
      };
    }
    
    // Calculate based on queue ratio
    let indexWorkers = Math.round(this.poolSize * analysis.indexRatio);
    let acteWorkers = this.poolSize - indexWorkers;
    
    // Enforce minimums
    if (indexWorkers < this.minIndexWorkers) {
      indexWorkers = this.minIndexWorkers;
      acteWorkers = this.poolSize - this.minIndexWorkers;
    }
    
    if (acteWorkers < this.minActeWorkers) {
      acteWorkers = this.minActeWorkers;
      indexWorkers = this.poolSize - this.minActeWorkers;
    }
    
    return {
      indexWorkers,
      acteWorkers,
      totalWorkers: this.poolSize
    };
  }
  
  /**
   * Update worker allocation in Redis
   */
  async updateAllocation(allocation: WorkerAllocation): Promise<void> {
    await this.redis.set(
      this.POOL_ALLOCATION_KEY,
      JSON.stringify(allocation)
    );
    
    logger.info({
      indexWorkers: allocation.indexWorkers,
      acteWorkers: allocation.acteWorkers,
      totalWorkers: allocation.totalWorkers
    }, 'Updated worker pool allocation');
  }
  
  /**
   * Get current worker allocation
   */
  async getCurrentAllocation(): Promise<WorkerAllocation> {
    const data = await this.redis.get(this.POOL_ALLOCATION_KEY);
    
    if (!data) {
      // Return default 50/50 split
      return {
        indexWorkers: Math.floor(this.poolSize / 2),
        acteWorkers: Math.ceil(this.poolSize / 2),
        totalWorkers: this.poolSize
      };
    }
    
    return JSON.parse(data);
  }
  
  /**
   * Assign a mode to a worker
   */
  async assignWorkerMode(workerId: string, mode: 'index' | 'acte'): Promise<void> {
    const assignment: WorkerAssignment = {
      workerId,
      assignedMode: mode,
      lastUpdated: Date.now()
    };
    
    await this.redis.hSet(
      this.WORKER_ASSIGNMENTS_KEY,
      workerId,
      JSON.stringify(assignment)
    );
  }
  
  /**
   * Get assigned mode for a worker
   */
  async getWorkerMode(workerId: string): Promise<'index' | 'acte' | null> {
    const data = await this.redis.hGet(this.WORKER_ASSIGNMENTS_KEY, workerId);
    
    if (!data) {
      return null;
    }
    
    const assignment: WorkerAssignment = JSON.parse(data);
    return assignment.assignedMode;
  }
  
  /**
   * Start automatic rebalancing
   */
  startRebalancing(): void {
    this.rebalanceTimer = setInterval(async () => {
      try {
        await this.rebalance();
      } catch (error) {
        logger.error({ error }, 'Failed to rebalance worker pool');
      }
    }, this.rebalanceInterval);
    
    logger.info({
      interval: this.rebalanceInterval
    }, 'Started automatic worker pool rebalancing');
  }
  
  /**
   * Stop automatic rebalancing
   */
  stopRebalancing(): void {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = undefined;
      logger.info('Stopped automatic worker pool rebalancing');
    }
  }
  
  /**
   * Rebalance worker pool based on current queue
   */
  async rebalance(): Promise<void> {
    // Analyze queue
    const analysis = await this.analyzeQueue();
    
    // Calculate optimal allocation
    const targetAllocation = this.calculateAllocation(analysis);
    
    // Update allocation in Redis
    await this.updateAllocation(targetAllocation);
    
    logger.info({
      queueAnalysis: analysis,
      targetAllocation
    }, 'Rebalanced worker pool');
  }
  
  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.stopRebalancing();
    
    if (this.isConnected) {
      await this.redis.disconnect();
      this.isConnected = false;
    }
  }
}


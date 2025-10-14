/**
 * Shared Rate Limiter for Gemini API
 * 
 * Manages rate limits across ALL workers (index OCR + acte OCR) using Redis.
 * Ensures we never exceed Gemini Tier 3 limits (2000 RPM, 8M TPM).
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

// Gemini Tier 3 Rate Limits (safe thresholds at 80% of max)
const GEMINI_TIER_3_LIMITS = {
  rpm: 2000,
  tpm: 8_000_000,
  safeRpm: 1600,      // 80% of max
  safeTpm: 6_400_000  // 80% of max
};

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  currentRPM: number;
  currentTPM: number;
  estimatedRPM: number;
  estimatedTPM: number;
}

export interface WorkerInfo {
  workerId: string;
  type: 'index' | 'acte';
  startedAt: number;
  lastHeartbeat: number;
  environment: string;
}

export class SharedRateLimiter {
  private redis: RedisClientType;
  private isConnected: boolean = false;
  
  // Redis keys
  private readonly RPM_KEY = 'gemini:rpm:current';
  private readonly TPM_KEY = 'gemini:tpm:current';
  private readonly WORKERS_KEY = 'gemini:workers';
  private readonly LAST_RESET_KEY = 'gemini:last_reset';
  
  // Rate limits (safe thresholds at 80% of max)
  private readonly MAX_RPM = GEMINI_TIER_3_LIMITS.safeRpm;
  private readonly MAX_TPM = GEMINI_TIER_3_LIMITS.safeTpm;
  
  constructor(redisUrl?: string) {
    // Create Redis client
    this.redis = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // Handle Redis errors
    this.redis.on('error', (err) => {
      logger.error({ error: err }, 'Redis error in rate limiter');
      this.isConnected = false;
    });
    
    this.redis.on('connect', () => {
      logger.info('Rate limiter connected to Redis');
      this.isConnected = true;
    });
  }
  
  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.redis.connect();
      await this.initializeCounters();
    }
  }
  
  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.redis.disconnect();
      this.isConnected = false;
    }
  }
  
  /**
   * Initialize rate limit counters
   */
  private async initializeCounters(): Promise<void> {
    const exists = await this.redis.exists(this.LAST_RESET_KEY);
    
    if (!exists) {
      await this.redis.set(this.RPM_KEY, '0');
      await this.redis.set(this.TPM_KEY, '0');
      await this.redis.set(this.LAST_RESET_KEY, Date.now().toString());
      
      logger.info('Initialized rate limit counters');
    }
  }
  
  /**
   * Check if we can make an API call with estimated token usage
   */
  async checkRateLimit(estimatedTokens: number = 15000): Promise<RateLimitCheck> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    // Get current usage
    const currentRPM = parseInt(await this.redis.get(this.RPM_KEY) || '0');
    const currentTPM = parseInt(await this.redis.get(this.TPM_KEY) || '0');
    
    // Calculate estimated usage after this request
    const estimatedRPM = currentRPM + 1;
    const estimatedTPM = currentTPM + estimatedTokens;
    
    // Check if we would exceed limits
    if (estimatedRPM > this.MAX_RPM) {
      return {
        allowed: false,
        reason: `Would exceed RPM limit (${estimatedRPM} > ${this.MAX_RPM})`,
        currentRPM,
        currentTPM,
        estimatedRPM,
        estimatedTPM
      };
    }
    
    if (estimatedTPM > this.MAX_TPM) {
      return {
        allowed: false,
        reason: `Would exceed TPM limit (${estimatedTPM} > ${this.MAX_TPM})`,
        currentRPM,
        currentTPM,
        estimatedRPM,
        estimatedTPM
      };
    }
    
    return {
      allowed: true,
      currentRPM,
      currentTPM,
      estimatedRPM,
      estimatedTPM
    };
  }
  
  /**
   * Record an API call with actual token usage
   */
  async recordApiCall(actualTokens: number): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    await this.redis.incrBy(this.RPM_KEY, 1);
    await this.redis.incrBy(this.TPM_KEY, actualTokens);
    
    logger.debug({
      tokens: actualTokens,
      currentRPM: await this.redis.get(this.RPM_KEY),
      currentTPM: await this.redis.get(this.TPM_KEY)
    }, 'Recorded API call');
  }
  
  /**
   * Reset rate limit counters (called every minute)
   */
  async resetCounters(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const oldRPM = await this.redis.get(this.RPM_KEY);
    const oldTPM = await this.redis.get(this.TPM_KEY);
    
    await this.redis.set(this.RPM_KEY, '0');
    await this.redis.set(this.TPM_KEY, '0');
    await this.redis.set(this.LAST_RESET_KEY, Date.now().toString());
    
    logger.info({
      previousRPM: oldRPM,
      previousTPM: oldTPM,
      maxRPM: this.MAX_RPM,
      maxTPM: this.MAX_TPM
    }, 'Reset rate limit counters');
  }
  
  /**
   * Start automatic counter reset every minute
   */
  startAutoReset(): NodeJS.Timeout {
    const interval = setInterval(async () => {
      await this.resetCounters();
    }, 60000); // Reset every 60 seconds
    
    logger.info('Started automatic rate limit reset (every 60s)');
    
    return interval;
  }
  
  /**
   * Register a worker
   */
  async registerWorker(workerInfo: WorkerInfo): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    await this.redis.hSet(
      this.WORKERS_KEY,
      workerInfo.workerId,
      JSON.stringify(workerInfo)
    );
    
    logger.info({
      workerId: workerInfo.workerId,
      type: workerInfo.type,
      environment: workerInfo.environment
    }, 'Registered worker in rate limiter');
  }
  
  /**
   * Update worker heartbeat
   */
  async updateWorkerHeartbeat(workerId: string): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const workerData = await this.redis.hGet(this.WORKERS_KEY, workerId);
    if (workerData) {
      const worker: WorkerInfo = JSON.parse(workerData);
      worker.lastHeartbeat = Date.now();
      
      await this.redis.hSet(
        this.WORKERS_KEY,
        workerId,
        JSON.stringify(worker)
      );
    }
  }
  
  /**
   * Unregister a worker
   */
  async unregisterWorker(workerId: string): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    await this.redis.hDel(this.WORKERS_KEY, workerId);
    
    logger.info({ workerId }, 'Unregistered worker from rate limiter');
  }
  
  /**
   * Get all active workers
   */
  async getActiveWorkers(): Promise<WorkerInfo[]> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const workers = await this.redis.hGetAll(this.WORKERS_KEY);
    const now = Date.now();
    const activeWorkers: WorkerInfo[] = [];
    
    for (const [workerId, data] of Object.entries(workers)) {
      const worker: WorkerInfo = JSON.parse(data);
      
      // Consider worker active if heartbeat within last 30 seconds
      if (now - worker.lastHeartbeat < 30000) {
        activeWorkers.push(worker);
      } else {
        // Remove stale worker
        await this.unregisterWorker(workerId);
      }
    }
    
    return activeWorkers;
  }
  
  /**
   * Get current rate limit status
   */
  async getStatus(): Promise<{
    currentRPM: number;
    currentTPM: number;
    maxRPM: number;
    maxTPM: number;
    rpmUsagePercent: number;
    tpmUsagePercent: number;
    activeWorkers: number;
    workersByType: { index: number; acte: number };
  }> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const currentRPM = parseInt(await this.redis.get(this.RPM_KEY) || '0');
    const currentTPM = parseInt(await this.redis.get(this.TPM_KEY) || '0');
    const workers = await this.getActiveWorkers();
    
    const workersByType = workers.reduce(
      (acc, w) => {
        acc[w.type]++;
        return acc;
      },
      { index: 0, acte: 0 }
    );
    
    return {
      currentRPM,
      currentTPM,
      maxRPM: this.MAX_RPM,
      maxTPM: this.MAX_TPM,
      rpmUsagePercent: (currentRPM / this.MAX_RPM) * 100,
      tpmUsagePercent: (currentTPM / this.MAX_TPM) * 100,
      activeWorkers: workers.length,
      workersByType
    };
  }
}


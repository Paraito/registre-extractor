/**
 * Server Capacity Manager
 * 
 * Manages server resources (CPU, RAM) across ALL worker types using Redis.
 * Prevents server overload by tracking resource allocation.
 */

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export type WorkerType = 'registre' | 'index-ocr' | 'acte-ocr';

export interface WorkerResourceRequirements {
  type: WorkerType;
  cpu: number;      // vCPUs
  ram: number;      // GB
  priority: number; // 1-10 (higher = more important)
}

export interface ServerCapacity {
  maxCPU: number;      // Total vCPUs available
  maxRAM: number;      // Total RAM in GB
  reservedCPU: number; // Reserved for OS/system
  reservedRAM: number; // Reserved for OS/system
}

export interface CapacityCheck {
  allowed: boolean;
  reason?: string;
  currentCPU: number;
  currentRAM: number;
  availableCPU: number;
  availableRAM: number;
}

export interface WorkerAllocation {
  workerId: string;
  type: WorkerType;
  cpu: number;
  ram: number;
  startedAt: number;
}

// Resource requirements per worker type
export const WORKER_RESOURCES: Record<WorkerType, WorkerResourceRequirements> = {
  'registre': {
    type: 'registre',
    cpu: 3,      // 2-4 vCPUs average (browser rendering)
    ram: 1,      // 1 GB
    priority: 10 // Highest priority (downloads documents)
  },
  'index-ocr': {
    type: 'index-ocr',
    cpu: 1.5,    // 1-2 vCPUs average (image processing)
    ram: 0.75,   // 750 MB
    priority: 5  // Medium priority
  },
  'acte-ocr': {
    type: 'acte-ocr',
    cpu: 1,      // 1 vCPU (API calls only)
    ram: 0.5,    // 512 MB
    priority: 5  // Medium priority
  }
};

export class ServerCapacityManager {
  private redis: RedisClientType;
  private isConnected: boolean = false;
  private serverLimits: ServerCapacity;
  
  // Redis keys
  private readonly CPU_KEY = 'server:cpu:allocated';
  private readonly RAM_KEY = 'server:ram:allocated';
  private readonly WORKERS_KEY = 'server:workers';
  
  constructor(serverLimits: ServerCapacity, redisUrl?: string) {
    this.serverLimits = serverLimits;
    
    // Create Redis client
    this.redis = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // Handle Redis errors
    this.redis.on('error', (err: Error) => {
      logger.error({ error: err }, 'Redis error in capacity manager');
      this.isConnected = false;
    });
    
    this.redis.on('connect', () => {
      logger.info('Capacity manager connected to Redis');
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
   * Initialize capacity counters
   */
  private async initializeCounters(): Promise<void> {
    const cpuExists = await this.redis.exists(this.CPU_KEY);
    
    if (!cpuExists) {
      await this.redis.set(this.CPU_KEY, '0');
      await this.redis.set(this.RAM_KEY, '0');
      
      logger.info({
        maxCPU: this.serverLimits.maxCPU,
        maxRAM: this.serverLimits.maxRAM,
        reservedCPU: this.serverLimits.reservedCPU,
        reservedRAM: this.serverLimits.reservedRAM
      }, 'Initialized capacity counters');
    }
  }
  
  /**
   * Check if we have capacity for a new worker
   */
  async checkCapacity(workerType: WorkerType): Promise<CapacityCheck> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const requirements = WORKER_RESOURCES[workerType];
    
    // Get current allocations
    const currentCPU = parseFloat(await this.redis.get(this.CPU_KEY) || '0');
    const currentRAM = parseFloat(await this.redis.get(this.RAM_KEY) || '0');
    
    // Calculate available
    const availableCPU = this.serverLimits.maxCPU - this.serverLimits.reservedCPU;
    const availableRAM = this.serverLimits.maxRAM - this.serverLimits.reservedRAM;
    
    // Check if we have capacity
    if (currentCPU + requirements.cpu > availableCPU) {
      return {
        allowed: false,
        reason: `Insufficient CPU (need ${requirements.cpu} vCPUs, available ${(availableCPU - currentCPU).toFixed(1)} vCPUs)`,
        currentCPU,
        currentRAM,
        availableCPU,
        availableRAM
      };
    }
    
    if (currentRAM + requirements.ram > availableRAM) {
      return {
        allowed: false,
        reason: `Insufficient RAM (need ${requirements.ram} GB, available ${(availableRAM - currentRAM).toFixed(2)} GB)`,
        currentCPU,
        currentRAM,
        availableCPU,
        availableRAM
      };
    }
    
    return {
      allowed: true,
      currentCPU,
      currentRAM,
      availableCPU,
      availableRAM
    };
  }
  
  /**
   * Allocate resources for a worker
   */
  async allocateResources(workerId: string, workerType: WorkerType): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const requirements = WORKER_RESOURCES[workerType];
    
    // Increment allocated resources
    await this.redis.incrByFloat(this.CPU_KEY, requirements.cpu);
    await this.redis.incrByFloat(this.RAM_KEY, requirements.ram);
    
    // Register worker
    const allocation: WorkerAllocation = {
      workerId,
      type: workerType,
      cpu: requirements.cpu,
      ram: requirements.ram,
      startedAt: Date.now()
    };
    
    await this.redis.hSet(
      this.WORKERS_KEY,
      workerId,
      JSON.stringify(allocation)
    );
    
    logger.info({
      workerId,
      type: workerType,
      cpu: requirements.cpu,
      ram: requirements.ram
    }, 'Allocated resources for worker');
  }
  
  /**
   * Release resources for a worker
   */
  async releaseResources(workerId: string): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const workerData = await this.redis.hGet(this.WORKERS_KEY, workerId);
    if (!workerData) {
      logger.warn({ workerId }, 'Worker not found in capacity manager');
      return;
    }
    
    const worker: WorkerAllocation = JSON.parse(workerData);
    
    // Decrement allocated resources
    await this.redis.incrByFloat(this.CPU_KEY, -worker.cpu);
    await this.redis.incrByFloat(this.RAM_KEY, -worker.ram);
    
    // Unregister worker
    await this.redis.hDel(this.WORKERS_KEY, workerId);
    
    logger.info({
      workerId,
      type: worker.type,
      cpu: worker.cpu,
      ram: worker.ram
    }, 'Released resources for worker');
  }
  
  /**
   * Get all active workers
   */
  async getActiveWorkers(): Promise<WorkerAllocation[]> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const workers = await this.redis.hGetAll(this.WORKERS_KEY);
    return Object.values(workers).map(data => JSON.parse(data as string));
  }
  
  /**
   * Get current capacity status
   */
  async getStatus(): Promise<{
    allocatedCPU: number;
    allocatedRAM: number;
    availableCPU: number;
    availableRAM: number;
    cpuUsagePercent: number;
    ramUsagePercent: number;
    activeWorkers: number;
    workersByType: Record<WorkerType, number>;
  }> {
    if (!this.isConnected) {
      await this.connect();
    }
    
    const allocatedCPU = parseFloat(await this.redis.get(this.CPU_KEY) || '0');
    const allocatedRAM = parseFloat(await this.redis.get(this.RAM_KEY) || '0');
    const workers = await this.getActiveWorkers();
    
    const availableCPU = this.serverLimits.maxCPU - this.serverLimits.reservedCPU;
    const availableRAM = this.serverLimits.maxRAM - this.serverLimits.reservedRAM;
    
    const workersByType = workers.reduce(
      (acc, w) => {
        acc[w.type] = (acc[w.type] || 0) + 1;
        return acc;
      },
      {} as Record<WorkerType, number>
    );
    
    return {
      allocatedCPU,
      allocatedRAM,
      availableCPU,
      availableRAM,
      cpuUsagePercent: (allocatedCPU / availableCPU) * 100,
      ramUsagePercent: (allocatedRAM / availableRAM) * 100,
      activeWorkers: workers.length,
      workersByType
    };
  }
}


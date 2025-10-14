/**
 * Resilient Retry Utility
 * 
 * Provides exponential backoff retry logic with jitter for API calls
 */

import { Logger } from './log.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
  retryableErrors?: string[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 500,
  retryableErrors: [
    'fetch failed',
    'timeout',
    'rate limit',
    'too many requests',
    '429',
    '500',
    '502',
    '503',
    '504',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND'
  ]
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error, retryableErrors: string[]): boolean {
  const errorMessage = error.message.toLowerCase();
  return retryableErrors.some(retryableError => 
    errorMessage.includes(retryableError.toLowerCase())
  );
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number, 
  baseDelayMs: number, 
  maxDelayMs: number, 
  backoffMultiplier: number, 
  jitterMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const jitter = Math.random() * jitterMs;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  operationName: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 1) {
        await logger.success('retry', `${operationName} succeeded on attempt ${attempt}`, {
          totalAttempts: attempt,
          maxAttempts: opts.maxAttempts
        });
      }
      
      return result;
    } catch (error) {
      lastError = error as Error;
      
      // Check if error is retryable
      if (!isRetryableError(lastError, opts.retryableErrors || [])) {
        await logger.error('retry', `${operationName} failed with non-retryable error`, lastError, {
          attemptNumber: attempt
        });
        throw lastError;
      }
      
      // If this was the last attempt, throw the error
      if (attempt === opts.maxAttempts) {
        await logger.error('retry', `${operationName} failed after ${opts.maxAttempts} attempts`, lastError, {
          totalAttempts: opts.maxAttempts
        });
        throw lastError;
      }
      
      // Calculate delay and wait
      const delay = calculateDelay(
        attempt, 
        opts.baseDelayMs, 
        opts.maxDelayMs, 
        opts.backoffMultiplier, 
        opts.jitterMs
      );
      
      await logger.warn('retry', `${operationName} failed, retrying in ${delay}ms`, {
        attemptNumber: attempt,
        maxAttempts: opts.maxAttempts,
        errorMessage: lastError.message,
        delayMs: delay
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Add delay between parallel operations to avoid rate limiting
 */
export async function withApiDelay(delayMs: number = 1000): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Process items in parallel with concurrency limit and API delays
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  logger: Logger,
  operationName: string,
  options: {
    maxConcurrency?: number;
    apiDelayMs?: number;
    retryOptions?: Partial<RetryOptions>;
  } = {}
): Promise<R[]> {
  const {
    maxConcurrency = 3,
    apiDelayMs = 1000,
    retryOptions = {}
  } = options;
  
  const results: R[] = new Array(items.length);
  
  await logger.info('parallel_processing', `Starting parallel ${operationName}`, {
    totalItems: items.length,
    maxConcurrency,
    apiDelayMs
  });
  
  // Process in batches with concurrency limit
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);
    
    const batchPromises = batch.map(async (item, batchIndex) => {
      const globalIndex = i + batchIndex;
      
      // Add staggered delay to avoid hitting API limits
      if (globalIndex > 0) {
        await withApiDelay(apiDelayMs);
      }
      
      const result = await withRetry(
        () => processor(item, globalIndex),
        logger,
        `${operationName}[${globalIndex}]`,
        retryOptions
      );
      
      results[globalIndex] = result;
      return result;
    });
    
    await Promise.all(batchPromises);
    
    await logger.info('parallel_processing', `Batch ${Math.floor(i / maxConcurrency) + 1} completed`, {
      itemsProcessed: Math.min(i + maxConcurrency, items.length),
      totalItems: items.length,
      operationName
    });
  }
  
  await logger.success('parallel_processing', `All ${operationName} completed`, {
    totalItems: items.length,
    successCount: results.filter(r => r !== undefined).length
  });
  
  return results;
}

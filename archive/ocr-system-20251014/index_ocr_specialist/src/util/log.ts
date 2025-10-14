/**
 * Structured Logging Utility
 * 
 * Provides JSONL (JSON Lines) structured logging for pipeline stages
 * with console output and file persistence.
 */

import { writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { CONFIG } from '../../config/runtime.js';

export interface LogEntry {
  ts: string;
  stage: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: Record<string, any>;
  page?: number;
  ms?: number;
  error?: string;
}

export class Logger {
  private runId: string;
  private logFile: string;
  private startTime: number;

  constructor(runId?: string) {
    this.runId = runId || `run-${Date.now()}`;
    this.logFile = `${CONFIG.logsDir}/${this.runId}.ndjson`;
    this.startTime = Date.now();
  }

  /**
   * Initialize logging (create directories, log file)
   */
  async init(): Promise<void> {
    if (!existsSync(CONFIG.logsDir)) {
      await mkdir(CONFIG.logsDir, { recursive: true });
    }
    
    await this.log('init', 'info', 'Pipeline logging started', {
      runId: this.runId,
      config: {
        maxLinesPerPage: CONFIG.maxLinesPerPage,
        extractWindow: CONFIG.extractWindow,
        upscaleFactor: CONFIG.upscaleFactor
      }
    });
  }

  /**
   * Log a structured entry
   */
  async log(
    stage: string, 
    level: LogEntry['level'], 
    message: string, 
    data?: Record<string, any>,
    page?: number,
    ms?: number,
    error?: Error
  ): Promise<void> {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      stage,
      level,
      message,
      ...(data && { data }),
      ...(page && { page }),
      ...(ms && { ms }),
      ...(error && { error: error.message })
    };

    // Write to file (JSONL format)
    await appendFile(this.logFile, JSON.stringify(entry) + '\n');

    // Console output with colors
    const timestamp = new Date().toLocaleTimeString();
    const pageStr = page ? ` [Page ${page}]` : '';
    const msStr = ms ? ` (${ms}ms)` : '';
    
    const colors = {
      info: '\x1b[36m',    // Cyan
      warn: '\x1b[33m',    // Yellow
      error: '\x1b[31m',   // Red
      success: '\x1b[32m', // Green
    };
    
    const reset = '\x1b[0m';
    const color = colors[level];
    
    console.log(`${color}[${timestamp}] ${stage.toUpperCase()}${pageStr}${reset} ${message}${msStr}`);
    
    if (data && Object.keys(data).length > 0) {
      console.log(`  ${JSON.stringify(data, null, 2).split('\n').join('\n  ')}`);
    }
    
    if (error) {
      console.log(`  Error: ${error.message}`);
    }
  }

  /**
   * Convenience methods for different log levels
   */
  async info(stage: string, message: string, data?: Record<string, any>, page?: number, ms?: number): Promise<void> {
    await this.log(stage, 'info', message, data, page, ms);
  }

  async warn(stage: string, message: string, data?: Record<string, any>, page?: number, ms?: number): Promise<void> {
    await this.log(stage, 'warn', message, data, page, ms);
  }

  async error(stage: string, message: string, error?: Error, data?: Record<string, any>, page?: number): Promise<void> {
    await this.log(stage, 'error', message, data, page, undefined, error);
  }

  async success(stage: string, message: string, data?: Record<string, any>, page?: number, ms?: number): Promise<void> {
    await this.log(stage, 'success', message, data, page, ms);
  }

  /**
   * Time a function and log the result
   */
  async time<T>(
    stage: string, 
    message: string, 
    fn: () => Promise<T>, 
    page?: number,
    data?: Record<string, any>
  ): Promise<T> {
    const start = Date.now();
    await this.info(stage, `${message}...`, data, page);
    
    try {
      const result = await fn();
      const ms = Date.now() - start;
      await this.success(stage, `${message} completed`, data, page, ms);
      return result;
    } catch (error) {
      const ms = Date.now() - start;
      await this.error(stage, `${message} failed`, error as Error, data, page);
      throw error;
    }
  }

  /**
   * Get the log file path for this run
   */
  getLogFile(): string {
    return this.logFile;
  }

  /**
   * Get the run ID
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get total runtime so far
   */
  getTotalRuntime(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(runId?: string): Logger {
  return new Logger(runId);
}

/**
 * Parse JSONL log file back into entries
 */
export async function parseLogFile(logFilePath: string): Promise<LogEntry[]> {
  try {
    const content = await import('fs').then(fs => fs.promises.readFile(logFilePath, 'utf-8'));
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (error) {
    throw new Error(`Failed to parse log file ${logFilePath}: ${(error as Error).message}`);
  }
}

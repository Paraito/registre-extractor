/**
 * Runtime Configuration for OCR King Pipeline
 * 
 * Centralized configuration management for all pipeline components.
 * Validates environment variables and provides typed configuration.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment files from root directory (one level up from index_ocr_specialist/)
// This ensures we use the same .env as the rest of the project
const rootDir = resolve(__dirname, '../../');
dotenv.config({ path: resolve(rootDir, '.env.local') }); // Local overrides (gitignored)
dotenv.config({ path: resolve(rootDir, '.env') });       // Main config (root level)

export interface RuntimeConfig {
  // Test Configuration
  testPdfUrl: string;
  
  // Model API Keys
  geminiApiKey: string;
  anthropicApiKey: string;
  qwenApiUrl: string;
  qwenModelName: string;
  qwenApiKey?: string;
  
  // Pipeline Limits
  maxLinesPerPage: number;
  extractWindow: number;
  
  // Processing Settings
  upscaleFactor: number;
  viewportScale: number;
  
  // Timeouts & Retries
  requestTimeoutMs: number;
  maxRetries: number;
  delayBetweenRequests: number;
  
  // Directories
  artifactsDir: string;
  logsDir: string;
  reportsDir: string;
  tempDir: string;
  
  // Server Ports
  geminiPort: number;
  qwenPort: number;
}

/**
 * Validate and resolve runtime configuration from environment
 */
export function createRuntimeConfig(): RuntimeConfig {
  // Validate required environment variables
  const requiredEnvVars = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  
  const missing = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required keys are set.');
  }
  
  return {
    // Test Configuration
    testPdfUrl: process.env.TEST_PDF_URL || 
      'https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/sign/index/856-Shefford-Canton_d_Ely-1756990434100.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85MzgyN2Y2MS04OGM3LTRkN2MtYWEyZi00NzlhZTc2YWE3MjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbmRleC84NTYtU2hlZmZvcmQtQ2FudG9uX2RfRWx5LTE3NTY5OTA0MzQxMDAucGRmIiwiaWF0IjoxNzYwMjAxNTYxLCJleHAiOjE3NjI3OTM1NjF9.pw4g89W86VUJLlEtNzMP6uKUZUcy3RBxEsNhKwsx7gc',
    
    // Model API Keys
    geminiApiKey: process.env.GEMINI_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    qwenApiUrl: process.env.QWEN_API_URL || 'http://localhost:8000/v1',
    qwenModelName: process.env.QWEN_MODEL_NAME || 'qwen3-vl',
    qwenApiKey: process.env.QWEN_API_KEY,
    
    // Pipeline Limits
    maxLinesPerPage: parseInt(process.env.MAX_LINES_PER_PAGE || '60'),
    extractWindow: parseInt(process.env.EXTRACT_WINDOW || '15'),
    
    // Processing Settings
    upscaleFactor: parseFloat(process.env.UPSCALE_FACTOR || '2.0'),
    viewportScale: parseFloat(process.env.VIEWPORT_SCALE || '4.0'),
    
    // Timeouts & Retries
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '300000'), // 5 minutes
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '2000'),
    
    // Directories
    artifactsDir: process.env.ARTIFACTS_DIR || './artifacts',
    logsDir: process.env.LOGS_DIR || './logs',
    reportsDir: process.env.REPORTS_DIR || './reports',
    tempDir: process.env.TEMP_DIR || './tmp',
    
    // Server Ports
    geminiPort: parseInt(process.env.PORT || process.env.GEMINI_PORT || '3001'),
    qwenPort: parseInt(process.env.QWEN_PORT || '3002'),
  };
}

/**
 * Global configuration instance
 */
export const CONFIG = createRuntimeConfig();

/**
 * Validate configuration on startup
 */
export function validateConfig(): void {
  console.log('🔧 Validating configuration...');
  
  // Check API keys are present
  if (!CONFIG.geminiApiKey.startsWith('AIza')) {
    console.warn('⚠️  GEMINI_API_KEY format looks incorrect (should start with AIza)');
  }
  
  if (!CONFIG.anthropicApiKey.startsWith('sk-ant-')) {
    console.warn('⚠️  ANTHROPIC_API_KEY format looks incorrect (should start with sk-ant-)');
  }
  
  // Check numeric ranges
  if (CONFIG.maxLinesPerPage < 1 || CONFIG.maxLinesPerPage > 100) {
    throw new Error('MAX_LINES_PER_PAGE must be between 1 and 100');
  }
  
  if (CONFIG.extractWindow < 1 || CONFIG.extractWindow > 50) {
    throw new Error('EXTRACT_WINDOW must be between 1 and 50');
  }
  
  if (CONFIG.upscaleFactor < 1.0 || CONFIG.upscaleFactor > 4.0) {
    throw new Error('UPSCALE_FACTOR must be between 1.0 and 4.0');
  }
  
  console.log('✅ Configuration validated');
  console.log(`   Test PDF: ${CONFIG.testPdfUrl.substring(0, 50)}...`);
  console.log(`   Max lines per page: ${CONFIG.maxLinesPerPage}`);
  console.log(`   Extract window: ${CONFIG.extractWindow}`);
  console.log(`   Upscale factor: ${CONFIG.upscaleFactor}x`);
  console.log(`   Artifacts: ${CONFIG.artifactsDir}`);
}

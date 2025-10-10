import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Legacy single-environment config (for backward compatibility)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),

  // Multi-environment configs
  PROD_SUPABASE_URL: z.string().url().optional(),
  PROD_SUPABASE_ANON_KEY: z.string().optional(),
  PROD_SUPABASE_SERVICE_KEY: z.string().optional(),

  STAGING_SUPABASE_URL: z.string().url().optional(),
  STAGING_SUPABASE_ANON_KEY: z.string().optional(),
  STAGING_SUPABASE_SERVICE_KEY: z.string().optional(),

  DEV_SUPABASE_URL: z.string().url().optional(),
  DEV_SUPABASE_ANON_KEY: z.string().optional(),
  DEV_SUPABASE_SERVICE_KEY: z.string().optional(),

  API_PORT: z.string().transform(Number).default('3000'),
  API_HOST: z.string().default('0.0.0.0'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  WORKER_CONCURRENCY: z.string().transform(Number).default('20'),
  EXTRACTION_TIMEOUT: z.string().transform(Number).default('180000'),
  SESSION_TIMEOUT: z.string().transform(Number).default('240000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  REGISTRY_BASE_URL: z.string().url().default('https://www.registrefoncier.gouv.qc.ca/Sirf/'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HEADLESS: z.string().transform(val => val !== 'false').default('true'),
  AGENTQL_API_KEY: z.string().optional(),
  USE_AI_EXTRACTOR: z.string().transform(val => val === 'true').default('true'),
  OPENAI_API_KEY: z.string().optional(),

  // OCR Configuration
  GEMINI_API_KEY: z.string().optional(),
  OCR_EXTRACT_MODEL: z.string().default('gemini-2.0-flash-exp'),
  OCR_BOOST_MODEL: z.string().default('gemini-2.5-pro'),
  OCR_EXTRACT_TEMPERATURE: z.string().transform(Number).default('0.1'),
  OCR_BOOST_TEMPERATURE: z.string().transform(Number).default('0.2'),
  OCR_POLL_INTERVAL_MS: z.string().transform(Number).default('10000'),
  OCR_TEMP_DIR: z.string().default('/tmp/ocr-processing'),

  // Acte OCR Configuration (uses File API)
  ACTE_OCR_EXTRACT_MODEL: z.string().default('gemini-2.0-flash-exp'),
  ACTE_OCR_BOOST_MODEL: z.string().default('gemini-2.5-pro'),
  ACTE_OCR_EXTRACT_TEMPERATURE: z.string().transform(Number).default('0.1'),
  ACTE_OCR_BOOST_TEMPERATURE: z.string().transform(Number).default('0.2'),

  // OCR Environment Control
  OCR_PROD: z.string().transform(val => val !== 'false').default('true'),
  OCR_STAGING: z.string().transform(val => val !== 'false').default('true'),
  OCR_DEV: z.string().transform(val => val !== 'false').default('true'),
});

const env = envSchema.parse(process.env);

// Helper to check if environment credentials are available
const hasEnvironmentConfig = (prefix: 'PROD' | 'STAGING' | 'DEV') => {
  const url = env[`${prefix}_SUPABASE_URL`];
  const anonKey = env[`${prefix}_SUPABASE_ANON_KEY`];
  const serviceKey = env[`${prefix}_SUPABASE_SERVICE_KEY`];
  return !!(url && anonKey && serviceKey);
};

// Build environment configs
const environments: Record<string, { url: string; anonKey: string; serviceKey: string } | null> = {
  prod: hasEnvironmentConfig('PROD')
    ? {
        url: env.PROD_SUPABASE_URL!,
        anonKey: env.PROD_SUPABASE_ANON_KEY!,
        serviceKey: env.PROD_SUPABASE_SERVICE_KEY!,
      }
    : null,
  staging: hasEnvironmentConfig('STAGING')
    ? {
        url: env.STAGING_SUPABASE_URL!,
        anonKey: env.STAGING_SUPABASE_ANON_KEY!,
        serviceKey: env.STAGING_SUPABASE_SERVICE_KEY!,
      }
    : null,
  dev: hasEnvironmentConfig('DEV')
    ? {
        url: env.DEV_SUPABASE_URL!,
        anonKey: env.DEV_SUPABASE_ANON_KEY!,
        serviceKey: env.DEV_SUPABASE_SERVICE_KEY!,
      }
    : null,
};

// Backward compatibility: if no multi-env configs, fall back to legacy SUPABASE_* vars
const legacyConfig = (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_KEY)
  ? {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    }
  : null;

export const config = {
  // Legacy single supabase config (backward compatibility)
  supabase: legacyConfig || environments.prod || {
    url: '',
    anonKey: '',
    serviceKey: '',
  },
  // Multi-environment configs
  environments,
  api: {
    port: env.API_PORT,
    host: env.API_HOST,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  },
  worker: {
    concurrency: env.WORKER_CONCURRENCY,
    extractionTimeout: env.EXTRACTION_TIMEOUT,
    sessionTimeout: env.SESSION_TIMEOUT,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
  registry: {
    baseUrl: env.REGISTRY_BASE_URL,
  },
  env: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  headless: env.HEADLESS,
  agentQL: {
    apiKey: env.AGENTQL_API_KEY,
  },
  useAIExtractor: env.USE_AI_EXTRACTOR,
  openai: {
    apiKey: env.OPENAI_API_KEY,
  },
  ocr: {
    geminiApiKey: env.GEMINI_API_KEY,
    extractModel: env.OCR_EXTRACT_MODEL,
    boostModel: env.OCR_BOOST_MODEL,
    extractTemperature: env.OCR_EXTRACT_TEMPERATURE,
    boostTemperature: env.OCR_BOOST_TEMPERATURE,
    pollIntervalMs: env.OCR_POLL_INTERVAL_MS,
    tempDir: env.OCR_TEMP_DIR,
    enabledEnvironments: {
      prod: env.OCR_PROD,
      staging: env.OCR_STAGING,
      dev: env.OCR_DEV,
    },
    acte: {
      extractModel: env.ACTE_OCR_EXTRACT_MODEL,
      boostModel: env.ACTE_OCR_BOOST_MODEL,
      extractTemperature: env.ACTE_OCR_EXTRACT_TEMPERATURE,
      boostTemperature: env.ACTE_OCR_BOOST_TEMPERATURE,
    },
  },
};
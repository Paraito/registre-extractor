import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().min(1),
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
  AGENTQL_API_KEY: z.string().optional(),
  USE_AI_EXTRACTOR: z.string().transform(val => val === 'true').default('true'),
  OPENAI_API_KEY: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_KEY,
  },
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
  agentQL: {
    apiKey: env.AGENTQL_API_KEY,
  },
  useAIExtractor: env.USE_AI_EXTRACTOR,
  openai: {
    apiKey: env.OPENAI_API_KEY,
  },
};
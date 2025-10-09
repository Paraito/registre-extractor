// Municipal Data Extractor v2 - Configuration
// All configuration completely separate from v1

export interface MunicipalExtractorConfig {
  database: {
    supabase_url: string;
    supabase_service_key: string;
  };
  ai: {
    max_tokens_per_call: number;
    temperature: number;
    cost_optimization_enabled: boolean;
    screenshot_analysis_enabled: boolean;
    learning_enabled: boolean;
  };
  workers: {
    max_concurrent_jobs: number;
    screenshot_interval: number;
    stuck_detection_timeout: number;
    max_recovery_attempts: number;
    idle_timeout_ms: number;
  };
  browser: {
    headless: boolean;
    viewport: { width: number; height: number };
    timeout: number;
    user_agent: string;
    locale: string;
  };
  api: {
    port: number;
    cors_origin: string;
    rate_limit: {
      requests_per_minute: number;
      burst_limit: number;
    };
  };
  cache: {
    enabled: boolean;
    min_confidence_to_cache: number;
    max_cache_age_days: number;
    similarity_threshold: number;
  };
  monitoring: {
    enabled: boolean;
    metrics_retention_days: number;
    alert_thresholds: {
      success_rate_min: number;
      cost_per_extraction_max: number;
      avg_execution_time_max: number;
    };
  };
  municipal_sites: {
    rate_limits: {
      default: {
        requests_per_minute: number;
        delay_between_requests: number;
      };
      montreal: {
        requests_per_minute: number;
        delay_between_requests: number;
      };
      quebec: {
        requests_per_minute: number;
        delay_between_requests: number;
      };
    };
    retry_config: {
      max_attempts: number;
      backoff_multiplier: number;
      initial_delay: number;
    };
  };
}

function loadConfig(): MunicipalExtractorConfig {
  // const isProduction = process.env.NODE_ENV === 'production'; // for future use

  return {
    database: {
      supabase_url: process.env.SUPABASE_URL || 'https://your-project.supabase.co',
      supabase_service_key: process.env.SUPABASE_SERVICE_KEY || ''
    },
    ai: {
      max_tokens_per_call: parseInt(process.env.AI_MAX_TOKENS || '4000'),
      temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
      cost_optimization_enabled: process.env.AI_COST_OPTIMIZATION !== 'false',
      screenshot_analysis_enabled: process.env.AI_SCREENSHOT_ANALYSIS !== 'false',
      learning_enabled: process.env.AI_LEARNING !== 'false'
    },
    workers: {
      max_concurrent_jobs: parseInt(process.env.WORKER_MAX_CONCURRENT_JOBS || '5'),
      screenshot_interval: parseInt(process.env.WORKER_SCREENSHOT_INTERVAL || '10000'),
      stuck_detection_timeout: parseInt(process.env.WORKER_STUCK_TIMEOUT || '30000'),
      max_recovery_attempts: parseInt(process.env.WORKER_MAX_RECOVERY_ATTEMPTS || '3'),
      idle_timeout_ms: parseInt(process.env.WORKER_IDLE_TIMEOUT || '300000') // 5 minutes
    },
    browser: {
      headless: process.env.BROWSER_HEADLESS !== 'false',
      viewport: {
        width: parseInt(process.env.BROWSER_WIDTH || '1280'),
        height: parseInt(process.env.BROWSER_HEIGHT || '720')
      },
      timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000'),
      user_agent: process.env.BROWSER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: process.env.BROWSER_LOCALE || 'fr-CA'
    },
    api: {
      port: parseInt(process.env.MUNICIPAL_API_PORT || '3001'),
      cors_origin: process.env.CORS_ORIGIN || '*',
      rate_limit: {
        requests_per_minute: parseInt(process.env.API_RATE_LIMIT || '100'),
        burst_limit: parseInt(process.env.API_BURST_LIMIT || '20')
      }
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      min_confidence_to_cache: parseFloat(process.env.CACHE_MIN_CONFIDENCE || '0.8'),
      max_cache_age_days: parseInt(process.env.CACHE_MAX_AGE_DAYS || '30'),
      similarity_threshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || '0.6')
    },
    monitoring: {
      enabled: process.env.MONITORING_ENABLED !== 'false',
      metrics_retention_days: parseInt(process.env.METRICS_RETENTION_DAYS || '90'),
      alert_thresholds: {
        success_rate_min: parseFloat(process.env.ALERT_SUCCESS_RATE_MIN || '0.95'),
        cost_per_extraction_max: parseFloat(process.env.ALERT_COST_MAX || '0.50'),
        avg_execution_time_max: parseInt(process.env.ALERT_TIME_MAX || '120000')
      }
    },
    municipal_sites: {
      rate_limits: {
        default: {
          requests_per_minute: 30,
          delay_between_requests: 2000
        },
        montreal: {
          requests_per_minute: 25,
          delay_between_requests: 2500
        },
        quebec: {
          requests_per_minute: 20,
          delay_between_requests: 3000
        }
      },
      retry_config: {
        max_attempts: 3,
        backoff_multiplier: 1.5,
        initial_delay: 1000
      }
    }
  };
}

export const config = loadConfig();

// Validation
export function validateConfig(cfg: MunicipalExtractorConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!cfg.database.supabase_url) {
    errors.push('SUPABASE_URL is required');
  }

  if (!cfg.database.supabase_service_key) {
    errors.push('SUPABASE_SERVICE_KEY is required');
  }

  if (cfg.workers.max_concurrent_jobs < 1 || cfg.workers.max_concurrent_jobs > 50) {
    errors.push('WORKER_MAX_CONCURRENT_JOBS must be between 1 and 50');
  }

  if (cfg.cache.min_confidence_to_cache < 0 || cfg.cache.min_confidence_to_cache > 1) {
    errors.push('CACHE_MIN_CONFIDENCE must be between 0 and 1');
  }

  if (cfg.api.port < 1000 || cfg.api.port > 65535) {
    errors.push('MUNICIPAL_API_PORT must be between 1000 and 65535');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Environment-specific configurations
export const environments = {
  development: {
    browser: {
      headless: false,
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: 'fr-CA'
    },
    monitoring: {
      enabled: false,
      metrics_retention_days: 7,
      alert_thresholds: {
        success_rate_min: 0.8,
        cost_per_extraction_max: 1.0,
        avg_execution_time_max: 30000
      }
    },
    api: {
      port: 3001,
      cors_origin: '*',
      rate_limit: {
        requests_per_minute: 100,
        burst_limit: 20
      }
    }
  },
  
  production: {
    browser: {
      headless: true,
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: 'fr-CA'
    },
    monitoring: {
      enabled: true,
      metrics_retention_days: 30,
      alert_thresholds: {
        success_rate_min: 0.95,
        cost_per_extraction_max: 0.5,
        avg_execution_time_max: 15000
      }
    },
    api: {
      port: parseInt(process.env.MUNICIPAL_API_PORT || '3001'),
      cors_origin: process.env.ALLOWED_ORIGINS || 'https://yourdomain.com',
      rate_limit: {
        requests_per_minute: 200,
        burst_limit: 50
      }
    }
  },
  
  testing: {
    database: {
      supabase_url: 'http://localhost:54321',
      supabase_service_key: 'test-key'
    },
    workers: {
      max_concurrent_jobs: 1,
      screenshot_interval: 5000,
      stuck_detection_timeout: 30000,
      max_recovery_attempts: 2,
      idle_timeout_ms: 60000
    },
    cache: {
      enabled: false,
      min_confidence_to_cache: 0.8,
      max_cache_age_days: 7,
      similarity_threshold: 0.85
    }
  }
};

// Get environment-specific config
export function getEnvironmentConfig(): Partial<MunicipalExtractorConfig> {
  const env = process.env.NODE_ENV || 'development';
  return environments[env as keyof typeof environments] || environments.development;
}

// Merge environment config with base config
export const finalConfig: MunicipalExtractorConfig = {
  ...config,
  ...getEnvironmentConfig()
};

// Export individual config sections for convenience
export const databaseConfig = finalConfig.database;
export const aiConfig = finalConfig.ai;
export const workerConfig = finalConfig.workers;
export const browserConfig = finalConfig.browser;
export const apiConfig = finalConfig.api;
export const cacheConfig = finalConfig.cache;
export const monitoringConfig = finalConfig.monitoring;
export const municipalSitesConfig = finalConfig.municipal_sites;
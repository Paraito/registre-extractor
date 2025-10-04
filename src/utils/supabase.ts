import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

// Legacy single client (backward compatibility)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export const supabaseAnon = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// Multi-environment clients
export type EnvironmentName = 'prod' | 'staging' | 'dev';

interface SupabaseEnvironmentClients {
  service: SupabaseClient;
  anon: SupabaseClient;
}

class SupabaseClientManager {
  private clients: Map<EnvironmentName, SupabaseEnvironmentClients> = new Map();

  constructor() {
    this.initializeClients();
  }

  private initializeClients(): void {
    // Initialize clients for each configured environment
    (['prod', 'staging', 'dev'] as EnvironmentName[]).forEach(env => {
      const envConfig = config.environments[env];

      if (envConfig) {
        this.clients.set(env, {
          service: createClient(envConfig.url, envConfig.serviceKey, {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          }),
          anon: createClient(envConfig.url, envConfig.anonKey),
        });
      }
    });
  }

  getClient(environment: EnvironmentName, type: 'service' | 'anon' = 'service'): SupabaseClient | null {
    const clients = this.clients.get(environment);
    return clients ? clients[type] : null;
  }

  getServiceClient(environment: EnvironmentName): SupabaseClient | null {
    return this.getClient(environment, 'service');
  }

  getAnonClient(environment: EnvironmentName): SupabaseClient | null {
    return this.getClient(environment, 'anon');
  }

  getAvailableEnvironments(): EnvironmentName[] {
    return Array.from(this.clients.keys());
  }

  hasEnvironment(environment: EnvironmentName): boolean {
    return this.clients.has(environment);
  }
}

export const supabaseManager = new SupabaseClientManager();
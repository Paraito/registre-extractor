const fs = require('fs');
const yaml = require('js-yaml');

const NUM_WORKERS = 20;

const baseConfig = {
  version: '3.8',
  services: {
    redis: {
      image: 'redis:7-alpine',
      restart: 'unless-stopped',
      ports: ['6379:6379'],
      volumes: ['redis_data:/data'],
      command: 'redis-server --appendonly yes',
      healthcheck: {
        test: ['CMD', 'redis-cli', 'ping'],
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
    },
    api: {
      build: {
        context: '.',
        dockerfile: 'Dockerfile.api',
      },
      restart: 'unless-stopped',
      ports: ['3000:3000'],
      environment: [
        'NODE_ENV=production',
        'REDIS_HOST=redis',
        'REDIS_PORT=6379',
      ],
      env_file: ['.env'],
      depends_on: {
        redis: {
          condition: 'service_healthy',
        },
      },
      volumes: ['./downloads:/app/downloads'],
      command: ['node', 'dist/api/index.js'],
    },
  },
  volumes: {
    redis_data: null,
  },
};

// Generate worker services
for (let i = 1; i <= NUM_WORKERS; i++) {
  baseConfig.services[`worker-${i}`] = {
    build: {
      context: '.',
      dockerfile: 'Dockerfile',
    },
    restart: 'unless-stopped',
    environment: [
      'NODE_ENV=production',
      `WORKER_ID=worker-${i}`,
      'REDIS_HOST=redis',
      'REDIS_PORT=6379',
    ],
    env_file: ['.env'],
    depends_on: {
      redis: {
        condition: 'service_healthy',
      },
    },
    volumes: [`./downloads/worker-${i}:/app/downloads`],
    deploy: {
      resources: {
        limits: {
          cpus: '0.5',
          memory: '1G',
        },
      },
    },
  };
}

// Generate the YAML
const yamlStr = yaml.dump(baseConfig, {
  styles: {
    '!!null': 'canonical',
  },
  sortKeys: false,
});

// Write to file
fs.writeFileSync('docker-compose.yml', yamlStr);
console.log('Generated docker-compose.yml with', NUM_WORKERS, 'workers');
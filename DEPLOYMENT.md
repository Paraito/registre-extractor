# 🚀 Deployment Guide for Registre Extractor

## Prerequisites

- Docker and Docker Compose installed
- 8GB+ RAM on server
- Supabase project with storage bucket named "documents"
- AgentQL API key
- 20 Quebec Registry accounts

## Quick Deploy to VPS

### 1. Server Setup (Ubuntu/Debian)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose -y

# Add user to docker group
sudo usermod -aG docker $USER
```

### 2. Clone and Configure

```bash
# Clone repository
git clone https://github.com/yourusername/registre_extractor.git
cd registre_extractor

# Copy production environment
cp .env.production .env

# Edit environment variables
nano .env
```

### 3. Deploy

```bash
# Run deployment script
./deploy.sh

# Or manually:
npm run build
docker-compose -f docker-compose.prod.yml up -d --scale worker=20
```

## Deploy to Fly.io

### 1. Create fly.toml

```toml
app = "registre-extractor"
primary_region = "yul"  # Montreal region

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  API_PORT = "3000"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]

[processes]
  api = "node dist/api/index.js"
  worker = "node dist/worker/index.js"

[[services]]
  processes = ["api"]

[experimental]
  auto_rollback = true
```

### 2. Deploy

```bash
fly launch
fly secrets set SUPABASE_URL=xxx SUPABASE_ANON_KEY=xxx AGENTQL_API_KEY=xxx
fly scale count worker=20
```

## Deploy to Railway

### 1. railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "numReplicas": 20,
    "restartPolicyType": "ALWAYS"
  }
}
```

### 2. Deploy via CLI

```bash
railway login
railway init
railway add
railway up
railway domain
```

## Deploy to DigitalOcean App Platform

### 1. app.yaml

```yaml
name: registre-extractor
region: tor
services:
  - name: api
    dockerfile_path: Dockerfile
    source_dir: /
    github:
      branch: main
      deploy_on_push: true
      repo: yourusername/registre_extractor
    http_port: 3000
    instance_count: 1
    instance_size_slug: basic-xs
    run_command: node dist/api/index.js
    
  - name: worker
    dockerfile_path: Dockerfile
    source_dir: /
    github:
      branch: main
      deploy_on_push: true
      repo: yourusername/registre_extractor
    instance_count: 20
    instance_size_slug: basic-s
    run_command: node dist/worker/index.js
    
  - name: redis
    image:
      registry_type: DOCKER_HUB
      registry: library
      repository: redis
      tag: 7-alpine
```

## Production Best Practices

### 1. Security

```nginx
# Nginx reverse proxy with rate limiting
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
    }
}
```

### 2. Monitoring

```bash
# Install monitoring stack
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

docker run -d \
  --name grafana \
  -p 3001:3000 \
  grafana/grafana
```

### 3. Backup Script

```bash
#!/bin/bash
# backup.sh - Run daily with cron

# Backup Redis
docker exec redis redis-cli BGSAVE

# Backup to S3
aws s3 sync /var/lib/redis s3://your-backup-bucket/redis/$(date +%Y%m%d)/

# Backup logs
tar -czf logs-$(date +%Y%m%d).tar.gz logs/
aws s3 cp logs-*.tar.gz s3://your-backup-bucket/logs/
```

### 4. Auto-restart on failure

```bash
# /etc/systemd/system/registre-extractor.service
[Unit]
Description=Registre Extractor Service
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
WorkingDirectory=/opt/registre_extractor
ExecStart=/usr/bin/docker-compose -f docker-compose.prod.yml up
ExecStop=/usr/bin/docker-compose -f docker-compose.prod.yml down

[Install]
WantedBy=multi-user.target
```

Enable auto-start:
```bash
sudo systemctl enable registre-extractor
sudo systemctl start registre-extractor
```

## Cost Comparison

| Provider | Monthly Cost | Specs | Pros |
|----------|-------------|-------|------|
| Hetzner VPS | €20 (~$22) | 8GB RAM, 4 vCPU | Best value |
| DigitalOcean | $48 | 8GB RAM, 4 vCPU | Good UI, backups |
| Fly.io | ~$50 | Auto-scaling | Global deployment |
| Railway | ~$60 | Managed | GitHub integration |
| AWS EC2 | ~$70 | t3.large | Enterprise features |

## Monitoring Endpoints

- Dashboard: `http://your-server:3000`
- Health: `http://your-server:3000/health`
- Metrics: `http://your-server:3000/api/metrics`
- Workers: `http://your-server:3000/api/workers`

## Troubleshooting

### Workers not starting
```bash
docker-compose -f docker-compose.prod.yml logs worker
```

### Redis connection issues
```bash
docker exec -it redis redis-cli ping
```

### Disk space issues
```bash
# Clean up old containers and images
docker system prune -a
```

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Monitor dashboard: `http://localhost:3000`
- Review worker status in Supabase
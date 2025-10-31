# PM2 Deployment Guide

## Why PM2 Instead of Docker?

For single-server deployments, **PM2 is the better choice** because:

✅ **Lower memory overhead** - No container overhead (critical after clearing 2130 zombie processes)  
✅ **Faster deployments** - Just `git pull && pm2 restart` (no image rebuilding)  
✅ **Simpler debugging** - Direct log access without `docker logs`  
✅ **Better for single server** - Docker is overkill for one machine  
✅ **Hot reload** - Update code without full restart  
✅ **Built-in clustering** - Native load balancing  

## Quick Start

### 1. Deploy with PM2

```bash
# Full deployment (pull code, build, restart)
./deploy-pm2.sh

# Quick restart (no pull/build)
./deploy-pm2.sh --quick

# Deploy and show logs
./deploy-pm2.sh --logs
```

### 2. Manual Deployment

```bash
# Pull latest code
git pull origin main

# Install dependencies
npm install

# Build TypeScript
npm run build

# Stop Docker if running
docker compose down

# Start PM2 services
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## PM2 Commands

### Service Management

```bash
# Start all services
pm2 start ecosystem.config.js

# Restart all services
pm2 restart all

# Stop all services
pm2 stop all

# Delete all services
pm2 delete all

# Restart specific service
pm2 restart registre-worker
pm2 restart registre-ocr
pm2 restart registre-api
pm2 restart registre-monitor
```

### Monitoring

```bash
# List all services
pm2 list

# Monitor in real-time
pm2 monit

# View all logs
pm2 logs

# View specific service logs
pm2 logs registre-worker
pm2 logs registre-ocr

# View last 100 lines
pm2 logs --lines 100

# Clear all logs
pm2 flush
```

### Process Information

```bash
# Show detailed info
pm2 show registre-worker

# Show process metrics
pm2 describe registre-worker
```

## Worker Configuration

### Current Setup (ecosystem.config.js)

| Service | Instances | Workers | Total | Status |
|---------|-----------|---------|-------|--------|
| **registre-worker** | 3 PM2 instances | 3 workers each | **9 workers** | ✅ WORKING |
| **registre-ocr** | 1 PM2 instance | 5 workers | **5 workers** | ✅ WORKING |
| **registre-monitor** | 1 PM2 instance | - | **1 instance** | ✅ WORKING |
| **registre-api** | 1 PM2 instance | - | **1 instance** | ✅ WORKING |

**Total**: 4 PM2 apps, 15 workers

### What Each Worker Does

#### 1. Registre Workers (9 workers)
- **Purpose**: Extract documents from Quebec Land Registry
- **Handles**: actes, index, plan_cadastraux
- **New Features**:
  - ✅ Acte fallback: Tries Acte → Acte divers → Radiation
  - ✅ Plan cadastraux fallback: Tries different cadastre/designation combinations
  - ✅ Confirmation page handling for large files
- **Script**: `dist/worker/index.js`
- **Memory**: 1GB per PM2 instance

#### 2. OCR Workers (5 workers)
- **Purpose**: Process extracted documents with Gemini/Claude OCR
- **Handles**: Documents with status_id=3 (COMPLETE)
- **Updates**: Sets status_id=5 (EXTRACTION_COMPLETE) with file_content
- **Script**: `dist/ocr/start-ocr-workers.js`
- **Memory**: 768MB
- **Requires**: `GEMINI_API_KEY` or `CLAUDE_API_KEY` and `OCR_PROD=true` in .env

#### 3. Monitor (1 instance)
- **Purpose**: Health monitoring and system status
- **Script**: `dist/monitor/index.js`
- **Memory**: 256MB

#### 4. API Server (1 instance)
- **Purpose**: REST API for job management
- **Port**: 3000
- **Script**: `dist/api/index.js`
- **Memory**: 512MB

## Not Implemented (Placeholders)

❌ **REQ Workers** - Registre des Entreprises du Québec  
❌ **RDPRM Workers** - Droits Personnels et Réels Mobiliers  

These exist in `src/worker/unified-worker.ts` but the scrapers (`src/req/scraper.ts`, `src/rdprm/scraper.ts`) just throw "not yet implemented" errors.

## Log Files

All logs are stored in `./logs/` directory:

```
logs/
├── registre-worker-error.log
├── registre-worker-out.log
├── registre-ocr-error.log
├── registre-ocr-out.log
├── registre-monitor-error.log
├── registre-monitor-out.log
├── registre-api-error.log
└── registre-api-out.log
```

## Troubleshooting

### Check for Zombie Processes

```bash
# Count zombie processes
ps aux | grep 'Z' | wc -l

# Find parent processes creating zombies
ps -eo ppid,pid,stat,cmd | grep 'Z' | awk '{print $1}' | sort | uniq -c | sort -rn

# Kill parent process (replace PID)
kill -9 <PID>
```

### Worker Not Starting

```bash
# Check logs
pm2 logs registre-worker --lines 100

# Check for errors
pm2 describe registre-worker

# Restart with fresh state
pm2 delete registre-worker
pm2 start ecosystem.config.js --only registre-worker
```

### High Memory Usage

```bash
# Check memory usage
pm2 list

# Restart specific service
pm2 restart registre-worker

# Adjust max_memory_restart in ecosystem.config.js
```

### Port 3000 Already in Use

```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process (replace PID)
kill -9 <PID>

# Or stop PM2 API
pm2 stop registre-api
```

## Auto-Start on Boot

```bash
# Generate startup script
pm2 startup

# Run the command it outputs (with sudo)
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u registry --hp /home/registry

# Save current PM2 configuration
pm2 save

# Test by rebooting
sudo reboot

# After reboot, verify services started
pm2 list
```

## Deployment Checklist

- [ ] Pull latest code: `git pull origin main`
- [ ] Install dependencies: `npm install`
- [ ] Build TypeScript: `npm run build`
- [ ] Stop Docker if running: `docker compose down`
- [ ] Restart PM2: `pm2 restart ecosystem.config.js`
- [ ] Save PM2 config: `pm2 save`
- [ ] Check status: `pm2 list`
- [ ] Check logs: `pm2 logs --lines 50`
- [ ] Check for zombies: `ps aux | grep 'Z' | wc -l`
- [ ] Verify API: `curl http://localhost:3000/api/workers | jq`

## Environment Variables

Required in `.env`:

```bash
# Supabase (required)
SUPABASE_URL_PROD=https://your-project.supabase.co
SUPABASE_SERVICE_KEY_PROD=your-service-key

# OCR (required for OCR workers)
GEMINI_API_KEY=your-gemini-key
# OR
CLAUDE_API_KEY=your-claude-key

# OCR Environment Flags
OCR_PROD=true
OCR_STAGING=false
OCR_DEV=false

# OpenAI (optional, for fallback LLM selection)
OPENAI_API_KEY=your-openai-key

# Node Environment
NODE_ENV=production
```

## Performance Tuning

### Scaling Workers

```bash
# Scale registre workers to 5 instances (15 workers total)
pm2 scale registre-worker 5

# Scale back to 3 instances (9 workers total)
pm2 scale registre-worker 3
```

### Adjusting Worker Count

Edit `ecosystem.config.js`:

```javascript
{
  name: 'registre-worker',
  env: {
    WORKER_COUNT: 5  // Change from 3 to 5 (total: 15 workers with 3 PM2 instances)
  }
}
```

Then restart:

```bash
pm2 restart registre-worker
```

## Comparison: PM2 vs Docker

| Feature | PM2 | Docker |
|---------|-----|--------|
| Memory Overhead | Low | High (container overhead) |
| Deployment Speed | Fast (no rebuild) | Slow (rebuild images) |
| Debugging | Easy (direct logs) | Harder (docker logs) |
| Scaling | Built-in clustering | Requires orchestration |
| Single Server | ✅ Excellent | ⚠️ Overkill |
| Multi-Server | ⚠️ Manual | ✅ Excellent |
| Hot Reload | ✅ Yes | ❌ No |
| Resource Limits | OS-level | Container-level |

**Recommendation**: Use PM2 for single-server deployments, Docker for multi-server/cloud deployments.


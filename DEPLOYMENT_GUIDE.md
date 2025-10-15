# 🚀 Registre Extractor Deployment Guide

**Last Updated**: October 15, 2025  
**Purpose**: Restore system to high-quality extraction with OCR support

---

## 📋 Prerequisites

### Required
- [ ] Server with Ubuntu 20.04+ or Debian 11+
- [ ] Docker and Docker Compose installed
- [ ] Git installed
- [ ] Access to server via SSH
- [ ] `.env` file with all required credentials

### Environment Variables Required

```bash
# Supabase (at least one environment)
PROD_SUPABASE_URL=
PROD_SUPABASE_ANON_KEY=
PROD_SUPABASE_SERVICE_KEY=

# AI Services
AGENTQL_API_KEY=        # For AI-powered extraction
OPENAI_API_KEY=         # For vision fallback
GEMINI_API_KEY=         # For OCR
CLAUDE_API_KEY=         # For OCR fallback (optional but recommended)

# Worker Accounts - STORED IN DATABASE (worker_accounts table)
# The system automatically fetches accounts from Supabase
# You do NOT need environment variables for worker accounts
# See "Setting Up Worker Accounts" section below

# Redis (if using external Redis)
REDIS_HOST=redis        # Use 'redis' for Docker, 'localhost' for PM2
REDIS_PORT=6379
```

---

## 🐳 Option A: Docker Deployment (RECOMMENDED)

### Why Docker?
- ✅ All dependencies managed automatically
- ✅ Proven to work (Oct 10-14 period)
- ✅ Easy to scale
- ✅ Reproducible environment
- ✅ Matches "golden period" setup

### Step 1: Install Docker (if not installed)

```bash
# Update package index
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get install docker-compose-plugin

# Add your user to docker group (optional, avoids sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

### Step 2: Clone and Configure

```bash
# Clone repository
git clone https://github.com/Paraito/registre-extractor.git
cd registre-extractor

# Create .env file
cp .env.example .env
nano .env  # Edit with your credentials
```

### Step 2.5: Set Up Worker Accounts in Database

**IMPORTANT**: Worker accounts are stored in the `worker_accounts` table in Supabase, NOT in environment variables.

```sql
-- In Supabase SQL Editor, insert your Quebec Registry accounts:

INSERT INTO worker_accounts (username, password, is_active) VALUES
  ('30F3315', 'Sainte-Clara1504!', true),
  ('account2', 'password2', true),
  ('account3', 'password3', true);
  -- Add as many accounts as you have

-- Verify accounts were added:
SELECT id, username, is_active, failure_count, last_used
FROM worker_accounts
ORDER BY created_at;
```

**How it works**:
- Each worker automatically fetches an available account from the database
- Accounts are selected based on `last_used` (least recently used first)
- Accounts with `failure_count >= 3` are automatically skipped
- Accounts with `is_active = false` are skipped
- When a worker logs in, it updates `last_used` timestamp
- This ensures accounts are distributed evenly across workers

**To check accounts from command line**:
```bash
npm run check-accounts
```

### Step 3: Build and Deploy

```bash
# Build Docker images
docker compose build

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Check status
docker compose ps
```

### Step 4: Verify Deployment

```bash
# Check all containers are running
docker compose ps

# Expected output:
# NAME                  STATUS
# registre-worker-1     Up
# registre-worker-2     Up
# registre-worker-3     Up
# registre-ocr          Up
# registre-monitor      Up
# registre-api          Up
# registre-redis        Up

# Check worker logs
docker compose logs registre-worker-1 --tail=50

# Check OCR logs
docker compose logs registre-ocr --tail=50

# Check API
curl http://localhost:3000/health
```

### Step 5: Monitor

```bash
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f registre-worker-1

# Check resource usage
docker stats

# Restart specific service
docker compose restart registre-worker-1

# Restart all
docker compose restart
```

### Scaling (if needed)

```bash
# Scale extraction workers to 5 instances
docker compose up -d --scale registre-worker-1=2 --scale registre-worker-2=2 --scale registre-worker-3=1

# Or edit docker-compose.yml and add more worker services
```

---

## ⚡ Option B: PM2 Deployment (Alternative)

### Why PM2?
- ✅ Simpler if Docker not available
- ✅ Direct Node.js execution
- ⚠️ Requires manual dependency management

### Step 1: Install System Dependencies

```bash
# Update package index
sudo apt-get update

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright system dependencies
sudo npx playwright install-deps chromium

# Install OCR dependencies (for OCR workers)
sudo apt-get install -y imagemagick poppler-utils

# Install PM2 globally
sudo npm install -g pm2

# Install Redis
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### Step 2: Clone and Configure

```bash
# Clone repository
git clone https://github.com/Paraito/registre-extractor.git
cd registre-extractor

# Create .env file
cp .env.example .env
nano .env  # Edit with your credentials

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build project
npm run build
```

### Step 2.5: Set Up Worker Accounts in Database

**IMPORTANT**: Worker accounts are stored in the `worker_accounts` table in Supabase, NOT in environment variables.

```sql
-- In Supabase SQL Editor, insert your Quebec Registry accounts:

INSERT INTO worker_accounts (username, password, is_active) VALUES
  ('30F3315', 'Sainte-Clara1504!', true),
  ('account2', 'password2', true),
  ('account3', 'password3', true);
  -- Add as many accounts as you have

-- Verify accounts were added:
SELECT id, username, is_active, failure_count, last_used
FROM worker_accounts
ORDER BY created_at;
```

**To check accounts from command line**:
```bash
npm run check-accounts
```

### Step 3: Deploy with PM2

```bash
# Start all services
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions printed by the command

# Verify
pm2 list
```

### Step 4: Verify Deployment

```bash
# Check PM2 status
pm2 list

# Expected output:
# ┌────┬────────────────────┬─────────┬─────────┬──────────┐
# │ id │ name               │ mode    │ status  │ memory   │
# ├────┼────────────────────┼─────────┼─────────┼──────────┤
# │ 0  │ registre-worker    │ cluster │ online  │ 150mb    │
# │ 1  │ registre-worker    │ cluster │ online  │ 145mb    │
# │ 2  │ registre-worker    │ cluster │ online  │ 148mb    │
# │ 3  │ registre-ocr       │ fork    │ online  │ 120mb    │
# │ 4  │ registre-monitor   │ fork    │ online  │ 85mb     │
# │ 5  │ registre-api       │ fork    │ online  │ 75mb     │
# └────┴────────────────────┴─────────┴─────────┴──────────┘

# Check logs
pm2 logs registre-worker --lines 50

# Check API
curl http://localhost:3000/health
```

### Step 5: Monitor

```bash
# View logs
pm2 logs

# View specific service
pm2 logs registre-worker

# Monitor resources
pm2 monit

# Restart specific service
pm2 restart registre-worker

# Restart all
pm2 restart all

# Stop all
pm2 stop all

# Delete all (careful!)
pm2 delete all
```

---

## 🔍 Troubleshooting

### Playwright Browser Not Found

**Docker**:
```bash
# Rebuild image
docker compose build --no-cache registre-worker-1
docker compose up -d
```

**PM2**:
```bash
# Reinstall Playwright dependencies
sudo npx playwright install-deps chromium
npx playwright install chromium

# Verify
npx playwright --version
```

### Workers Not Processing Jobs

**Check Database**:
```sql
-- In Supabase SQL editor
SELECT status_id, COUNT(*) 
FROM extraction_queue 
GROUP BY status_id;

-- Check for stuck jobs
SELECT * FROM extraction_queue 
WHERE status_id = 2 
AND processing_started_at < NOW() - INTERVAL '5 minutes';
```

**Reset Stuck Jobs**:
```sql
UPDATE extraction_queue 
SET status_id = 1, 
    worker_id = NULL, 
    processing_started_at = NULL 
WHERE status_id = 2 
AND processing_started_at < NOW() - INTERVAL '5 minutes';
```

### OCR Not Processing

**Check OCR Queue**:
```sql
SELECT * FROM extraction_queue 
WHERE status_id = 3 
AND supabase_path IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 10;
```

**Check Environment Variables**:
```bash
# Docker
docker compose exec registre-ocr env | grep -E 'GEMINI|OCR'

# PM2
pm2 env registre-ocr
```

### High Memory Usage

**Docker**:
```bash
# Check memory usage
docker stats

# Adjust memory limits in docker-compose.yml
# Then restart
docker compose up -d
```

**PM2**:
```bash
# Check memory
pm2 list

# Adjust max_memory_restart in ecosystem.config.js
# Then restart
pm2 restart ecosystem.config.js
```

---

## 📊 Performance Tuning

### Concurrency Settings

**Docker** (edit docker-compose.yml):
```yaml
environment:
  - WORKER_COUNT=3  # Workers per container
  - WORKER_CONCURRENCY=20  # Jobs per worker
```

**PM2** (edit ecosystem.config.js):
```javascript
{
  instances: 3,  // PM2 instances
  env: {
    WORKER_COUNT: 3  // Workers per instance
  }
}
```

**Total Concurrency Calculation**:
- Docker: containers × WORKER_COUNT × WORKER_CONCURRENCY
- PM2: instances × WORKER_COUNT × WORKER_CONCURRENCY

**Example**:
- 3 containers/instances × 3 workers × 20 concurrency = 180 potential concurrent jobs
- Practical limit: ~60-90 concurrent jobs (browser resource limits)

### Resource Allocation

**Recommended per Worker Container/Instance**:
- CPU: 0.5-1 core
- Memory: 1-2GB
- Disk: 10GB (for downloads)

**Recommended per OCR Container/Instance**:
- CPU: 0.25-0.5 core
- Memory: 512MB-1GB
- Disk: 5GB (for temp files)

---

## 🎯 Success Criteria

After deployment, verify:

- [ ] All containers/processes are running
- [ ] No Playwright browser errors in logs
- [ ] Workers are picking up jobs from queue
- [ ] Jobs move from status 1 → 2 → 3
- [ ] OCR picks up completed jobs (status 3)
- [ ] OCR completes successfully (status 5)
- [ ] API responds at http://localhost:3000/health
- [ ] Multiple jobs process concurrently
- [ ] Vision fallback works (check logs for "Vision analysis")
- [ ] IndexFallbackHandler triggers on errors (check logs for "Fallback attempt")

---

## 📞 Support

If issues persist:
1. Check logs: `docker compose logs` or `pm2 logs`
2. Check database for stuck jobs
3. Verify all environment variables are set
4. Ensure Playwright is properly installed
5. Check server resources (CPU, memory, disk)

**Common Issues**:
- Playwright errors → Reinstall dependencies
- No jobs processing → Check database connection
- OCR not working → Verify API keys
- High memory → Reduce concurrency or add resources


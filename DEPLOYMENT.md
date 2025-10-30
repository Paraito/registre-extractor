# Deployment Guide - Registre Extractor

This guide covers deploying the registre-extractor application with full REQ and RDPRM support.

## 📋 Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Deployment Steps](#deployment-steps)
- [Verification](#verification)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Overview

The registre-extractor is a unified worker system that handles three types of jobs:

1. **Land Registry Extraction** - Extracts documents from Quebec Land Registry
2. **REQ Scraping** - Scrapes company information from Registre des Entreprises du Québec
3. **RDPRM Scraping** - Scrapes personal and movable real rights documents

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Unified Worker (PM2)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │   Land      │  │     REQ     │  │      RDPRM       │    │
│  │  Registry   │  │   Scraper   │  │    Scraper       │    │
│  │ Extraction  │  │             │  │                  │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
│         ↓                 ↓                  ↓               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Supabase (Multi-Environment)                │  │
│  │   • extraction_queue                                  │  │
│  │   • search_sessions                                   │  │
│  │   • req_companies                                     │  │
│  │   • rdprm_searches                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Required Software

- **Node.js** v20+ (LTS recommended)
- **npm** v10+
- **PM2** (will be installed if missing)
- **Git** (for deployment script)

### Required Services

1. **Supabase** - At least one environment (prod/staging/dev)
   - Get credentials: https://app.supabase.com/project/_/settings/api
   - Required tables: `extraction_queue`, `search_sessions`, `req_companies`, `rdprm_searches`
   - Required storage buckets: `documents`, `rdprm-documents`

2. **BrowserBase** (for REQ scraping)
   - Sign up: https://www.browserbase.com/
   - Get API key and Project ID

3. **RDPRM Account** (for RDPRM scraping)
   - Create account at: https://www.rdprm.gouv.qc.ca/
   - Note your username, password, and security question answer

4. **AgentQL** (for AI-powered extraction)
   - Sign up: https://www.agentql.com/
   - Get API key

5. **Google Gemini** (for OCR processing - optional)
   - Get API key: https://aistudio.google.com/app/apikey

---

## Environment Setup

### 1. Clone the Repository

```bash
cd /path/to/your/projects
git clone <repository-url>
cd registre-extractor
```

### 2. Configure Environment Variables

Copy the example file and edit it:

```bash
cp .env.example .env
nano .env  # or vim, code, etc.
```

### 3. Required Environment Variables

#### Supabase Configuration (Required)

At minimum, configure one environment (prod, staging, or dev):

```bash
# Production Supabase
PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_ANON_KEY=your-prod-anon-key
PROD_SUPABASE_SERVICE_KEY=your-prod-service-role-key
```

#### BrowserBase Configuration (Required for REQ)

```bash
BROWSERBASE_API_KEY=your-browserbase-api-key
BROWSERBASE_PROJECT_ID=your-browserbase-project-id
```

#### RDPRM Configuration (Required for RDPRM)

```bash
RDPRM_USER=your-rdprm-username
RDPRM_PASS=your-rdprm-password
RDPRM_SEC=RDPRM  # Usually "RDPRM" - your security question answer
```

#### AgentQL Configuration (Required for Land Registry)

```bash
AGENTQL_API_KEY=your-agentql-api-key
USE_AI_EXTRACTOR=true
```

#### Optional but Recommended

```bash
# Gemini for OCR processing
GEMINI_API_KEY=your-gemini-api-key
OCR_PROD=true  # Enable OCR for production

# Logging
LOG_LEVEL=info

# Downloads
DOWNLOADS_DIR=/tmp/registre-downloads

# Debug mode (set to true to save debug screenshots)
DEBUG_PLAYWRIGHT=false
```

---

## Deployment Steps

### Method 1: Using the Deploy Script (Recommended)

The easiest way to deploy:

```bash
# Make the script executable
chmod +x deploy-pm2.sh

# Full deployment (pull, build, restart)
./deploy-pm2.sh

# Quick restart (no pull/build)
./deploy-pm2.sh --quick

# Deploy and show logs
./deploy-pm2.sh --logs
```

### Method 2: Manual Deployment

If you prefer manual control:

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Start/restart with PM2
pm2 restart ecosystem.config.js

# 5. Save PM2 configuration
pm2 save

# 6. Set up PM2 to start on boot (optional)
pm2 startup
```

---

## Verification

### Check PM2 Status

```bash
pm2 list
```

You should see:

```
┌─────┬──────────────────┬─────────┬─────────┬──────────┐
│ id  │ name             │ status  │ restart │ uptime   │
├─────┼──────────────────┼─────────┼─────────┼──────────┤
│ 0   │ unified-worker   │ online  │ 0       │ 5m       │
│ 1   │ registre-ocr     │ online  │ 0       │ 5m       │
│ 2   │ registre-monitor │ online  │ 0       │ 5m       │
│ 3   │ registre-api     │ online  │ 0       │ 5m       │
└─────┴──────────────────┴─────────┴─────────┴──────────┘
```

### View Logs

```bash
# All logs
pm2 logs

# Specific worker logs
pm2 logs unified-worker

# Last 50 lines
pm2 logs --lines 50

# Follow logs in real-time
pm2 logs --raw
```

### Test Job Processing

#### Test REQ Job

Insert a test job into your Supabase database:

```sql
INSERT INTO search_sessions (initial_search_query, status, req_completed)
VALUES ('Test Company Name', 'pending_company_selection', false);
```

Watch the logs:

```bash
pm2 logs unified-worker
```

You should see:
- `📋 Claimed REQ job`
- `[REQ] Starting scraping`
- `[REQ] Scraping completed successfully`
- `✅ REQ job completed`

#### Test RDPRM Job

Insert a test RDPRM job:

```sql
INSERT INTO rdprm_searches (search_session_id, search_name, status)
VALUES ('your-session-id', 'Test Person Name', 'pending');
```

Watch for:
- `📋 Claimed RDPRM job`
- `[RDPRM] Starting scraping`
- `[RDPRM] PDF uploaded successfully`
- `✅ RDPRM job completed`

---

## Monitoring

### Real-time Monitoring

```bash
pm2 monit
```

This shows:
- CPU usage per worker
- Memory usage per worker
- Real-time logs

### Health Check

```bash
# Check for errors
pm2 logs unified-worker --err --lines 50

# Check system health
./deploy-pm2.sh  # Shows zombie process check
```

### Job Statistics

The unified worker logs job statistics:

```
✅ Unified Worker registered and ready
🔄 Polling for jobs across environments
📋 Claimed REQ job
✅ REQ job completed
💤 No jobs found in any environment
```

### Performance Metrics

Monitor in PM2:

```bash
pm2 describe unified-worker
```

Shows:
- Uptime
- Restart count
- Memory usage
- CPU usage

---

## Troubleshooting

### Common Issues

#### 1. Worker Not Picking Up Jobs

**Symptoms:**
- Logs show `💤 No jobs found in any environment`
- Jobs stuck in pending state

**Solutions:**

a. Check database connection:
```bash
# Verify Supabase credentials
grep SUPABASE .env

# Test database connection
pm2 logs unified-worker | grep "available environments"
```

b. Verify job status:
```sql
-- Check REQ jobs
SELECT id, status, req_completed FROM search_sessions
WHERE status = 'pending_company_selection' AND req_completed = false;

-- Check RDPRM jobs
SELECT id, status FROM rdprm_searches WHERE status = 'pending';
```

#### 2. BrowserBase Connection Failed

**Symptoms:**
- `BrowserBase credentials not found`
- `Failed to connect to BrowserBase`

**Solutions:**

```bash
# Verify credentials
grep BROWSERBASE .env

# Check if keys are set
echo $BROWSERBASE_API_KEY
echo $BROWSERBASE_PROJECT_ID
```

#### 3. RDPRM Login Failed

**Symptoms:**
- `Missing required environment variable: RDPRM_USER`
- `Login failed`

**Solutions:**

```bash
# Verify RDPRM credentials
grep RDPRM .env

# Test credentials manually at https://www.rdprm.gouv.qc.ca/
```

#### 4. High Memory Usage

**Symptoms:**
- PM2 shows high memory usage
- Workers restarting frequently

**Solutions:**

a. Reduce worker count in `ecosystem.config.js`:
```javascript
instances: 2,  // Reduce from 3
env: {
  WORKER_COUNT: 2  // Reduce from 3
}
```

b. Restart workers:
```bash
pm2 restart unified-worker
```

#### 5. Jobs Stuck in `in_progress`

**Symptoms:**
- Jobs not completing
- Status stuck at `in_progress`

**Solutions:**

a. Check for stuck jobs:
```sql
SELECT * FROM rdprm_searches
WHERE status = 'in_progress'
AND updated_at < NOW() - INTERVAL '10 minutes';
```

b. Reset stuck jobs:
```sql
UPDATE rdprm_searches
SET status = 'pending', updated_at = NOW()
WHERE status = 'in_progress'
AND updated_at < NOW() - INTERVAL '10 minutes';
```

c. Restart workers:
```bash
pm2 restart unified-worker
```

### Debug Mode

Enable debug mode for detailed screenshots:

```bash
# Add to .env
DEBUG_PLAYWRIGHT=true

# Restart workers
pm2 restart unified-worker

# Screenshots will be saved to:
# /tmp/registre-downloads/{session-id}/debug_*.png
```

### View Full Error Stack

```bash
# View error logs with stack traces
pm2 logs unified-worker --err --lines 100 --raw
```

### Reset Everything

If all else fails:

```bash
# Stop all workers
pm2 stop all

# Delete PM2 processes
pm2 delete all

# Rebuild
npm run build

# Restart
pm2 start ecosystem.config.js

# Save
pm2 save
```

---

## Maintenance

### Regular Updates

```bash
# Pull latest code and restart
./deploy-pm2.sh

# Or manually:
git pull origin main
npm install
npm run build
pm2 restart ecosystem.config.js
```

### Log Rotation

PM2 handles log rotation automatically, but you can manually clear logs:

```bash
# Clear all logs
pm2 flush

# Clear specific app logs
pm2 flush unified-worker
```

### Database Maintenance

Clean up old completed jobs periodically:

```sql
-- Delete old completed REQ searches (older than 30 days)
DELETE FROM search_sessions
WHERE req_completed = true
AND updated_at < NOW() - INTERVAL '30 days';

-- Delete old completed RDPRM searches (older than 30 days)
DELETE FROM rdprm_searches
WHERE status IN ('completed', 'failed', 'not_found')
AND updated_at < NOW() - INTERVAL '30 days';
```

---

## Production Checklist

Before deploying to production:

- [ ] All environment variables configured in `.env`
- [ ] BrowserBase credentials tested
- [ ] RDPRM credentials tested
- [ ] Supabase tables created
- [ ] Supabase storage buckets created
- [ ] AgentQL API key valid
- [ ] Build completes without errors (`npm run build`)
- [ ] PM2 starts all workers successfully
- [ ] Test REQ job processes successfully
- [ ] Test RDPRM job processes successfully
- [ ] Logs are being written correctly
- [ ] PM2 startup script configured (`pm2 startup`)
- [ ] Monitoring dashboard accessible (if using)

---

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review PM2 logs: `pm2 logs unified-worker`
3. Check application logs in `./logs/`
4. Verify all environment variables are set correctly

---

## Summary

The unified worker is now deployed and will:

- ✅ Automatically pick up Land Registry extraction jobs
- ✅ Automatically pick up REQ scraping jobs
- ✅ Automatically pick up RDPRM scraping jobs
- ✅ Work across all configured Supabase environments
- ✅ Handle errors gracefully with automatic retries
- ✅ Process jobs with proper concurrency control

**Total Workers:** 9 extraction workers + 5 OCR workers = 14 concurrent workers

**Job Priority:**
1. Land Registry extraction (highest priority)
2. REQ scraping
3. RDPRM scraping (lowest priority)

All workers are managed by PM2 and will restart automatically if they crash.

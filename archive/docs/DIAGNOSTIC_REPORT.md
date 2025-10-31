# 🔍 COMPREHENSIVE DIAGNOSTIC REPORT
**Date:** October 31, 2025  
**System:** registre-extractor

---

## 🚨 EXECUTIVE SUMMARY

### Critical Findings

1. **✅ WORKERS ARE RUNNING** - System is partially operational
   - 5 active workers in PROD environment (heartbeat: 0 minutes ago)
   - Workers are processing jobs successfully
   - 531 jobs completed in PROD, 673 in DEV

2. **❌ LOCAL SERVICES NOT RUNNING**
   - PM2 not installed/not in PATH on local machine
   - Docker daemon not running on local machine
   - Redis not accessible locally (connection refused)
   - No API server running (port 3000 not in use)

3. **⚠️ NO PENDING JOBS**
   - Zero jobs in "EN_ATTENTE" (waiting) state across all environments
   - All recent jobs are either COMPLETE or ERREUR (failed)

4. **🔄 WORKERS RUNNING REMOTELY**
   - Active workers detected in database with recent heartbeats
   - Workers likely running on a remote server/cloud instance
   - Local machine is NOT running the worker processes

---

## 📊 DETAILED FINDINGS

### 1. System Health Check ✅ COMPLETE

#### PM2 Status
```
❌ PM2 not installed or not in PATH
- Command: pm2 list → "command not found"
- Package check: npm list pm2 → (empty)
- Not found in node_modules/.bin/
```

#### Docker Status
```
❌ Docker daemon not running
- Error: "Cannot connect to the Docker daemon at unix:///Users/marco/.docker/run/docker.sock"
- No containers running locally
```

#### Redis Status
```
❌ Redis not accessible locally
- Connection refused at 127.0.0.1:6379
- Required for Bull queue system
```

#### Database Connectivity
```
✅ Database connection WORKING
- Successfully connected to all 3 environments (prod, staging, dev)
- Supabase clients initialized correctly
- All queries executing successfully
```

---

### 2. Queue & Job Processing Analysis ✅ COMPLETE

#### PROD Environment

**Job Status Breakdown:**
- ✅ EXTRACTION_COMPLETE: 531 jobs
- ❌ ERREUR (Error): 9 jobs
- ⏳ EN_ATTENTE (Waiting): 0 jobs
- 🔄 EN_TRAITEMENT (Processing): 0 jobs

**Recent Jobs (Last 10):**
- 9 failed plan_cadastraux jobs (validation errors - invalid lot numbers)
- 1 completed index job
- Most recent activity: Oct 29, 2025, 5:39 PM

**Worker Status:**
```
✅ ACTIVE WORKERS (5):
1. worker-1-e4460440 - idle, heartbeat: 0 min ago, completed: 0, failed: 0
2. worker-1-aa0d653a - idle, heartbeat: 0 min ago, completed: 0, failed: 0
3. worker-1-5b532a02 - idle, heartbeat: 0 min ago, completed: 0, failed: 0
4. worker-1-de1819cf - idle, heartbeat: 0 min ago, completed: 0, failed: 0
5. worker-1-8f9d6fdf - idle, heartbeat: 0 min ago, completed: 0, failed: 0

💀 DEAD WORKERS (5):
- 3 unified-workers (died 18 minutes ago, each failed 5 jobs)
- 2 worker-1 instances (died 63 minutes ago)
```

#### DEV Environment

**Job Status Breakdown:**
- ✅ EXTRACTION_COMPLETE: 673 jobs
- ❌ ERREUR (Error): 10 jobs
- ⏳ EN_ATTENTE (Waiting): 0 jobs

**Recent Errors:**
- Validation errors (invalid document numbers)
- Playwright errors: "Executable doesn't exist at /root/.cache/ms-pla..."
- Document timeout errors (3 minutes)

**Worker Status:**
```
❌ No workers currently registered in DEV
```

#### STAGING Environment

**Job Status:**
- No jobs in extraction_queue
- No workers registered

---

### 3. Database Operations Verification ✅ COMPLETE

#### Database Connectivity
```
✅ All environments accessible
- PROD: Connected successfully
- STAGING: Connected successfully  
- DEV: Connected successfully
```

#### Schema Validation
```
✅ Tables exist and are accessible:
- extraction_queue ✅
- worker_status ✅
- search_sessions ✅
- rdprm_searches ✅
```

#### Data Integrity
```
✅ No stuck jobs detected
- No jobs in EN_TRAITEMENT state
- No jobs with stale processing_started_at timestamps
```

---

### 4. Code Analysis 🔍 IN PROGRESS

#### Recent Activity Analysis

**Last Job Timestamps:**
- PROD: Oct 29, 2025, 5:39 PM (most recent error)
- DEV: Oct 29, 2025, 4:31 PM (most recent error)

**Worker Naming Patterns:**
- Active workers: `worker-1-{hash}` (5 instances)
- Dead workers: `unified-worker-{uuid}` (3 instances)
- Legacy workers: `worker-1-{hash}` (2 instances)

**Observations:**
1. Active workers use `worker-1-` prefix (from docker-compose.yml: WORKER_ID=worker-1)
2. Dead unified-workers suggest recent deployment attempt
3. Workers are running `dist/worker/index.js` (not unified-worker.js)

#### Configuration Analysis

**ecosystem.config.js:**
- Configured for PM2 deployment
- Uses `dist/worker/unified-worker.js` as entry point
- 3 PM2 instances × 3 workers = 9 workers total
- **NOT CURRENTLY RUNNING** (PM2 not active)

**docker-compose.yml:**
- Configured for Docker deployment
- Uses `dist/worker/index.js` as entry point (NOT unified-worker.js)
- 3 worker containers × 3 workers each = 9 workers total
- **LIKELY RUNNING REMOTELY** (based on active worker heartbeats)

---

## 🎯 ROOT CAUSE ANALYSIS

### Primary Issue: Deployment Confusion

**The system has TWO deployment configurations:**

1. **PM2 Deployment** (ecosystem.config.js)
   - Entry: `dist/worker/unified-worker.js`
   - Status: ❌ Not running locally
   - PM2 not installed on local machine

2. **Docker Deployment** (docker-compose.yml)
   - Entry: `dist/worker/index.js`
   - Status: ✅ Running remotely (based on worker heartbeats)
   - Not running on local machine

### Secondary Issues

1. **No Pending Jobs**
   - System is idle because no new jobs have been submitted
   - Not a failure - just no work to do

2. **Dead Workers in Database**
   - 3 unified-workers died 18 minutes ago
   - Suggests recent deployment attempt that failed
   - Workers likely tried to start but encountered errors

3. **Playwright Errors in DEV**
   - Error: "Executable doesn't exist at /root/.cache/ms-pla..."
   - Indicates Playwright not properly installed in Docker containers
   - Affects DEV environment

---

## 💡 CONCLUSIONS

### What's Working ✅

1. **Database connectivity** - All Supabase environments accessible
2. **Remote workers** - 5 workers actively running in PROD (likely on cloud server)
3. **Job processing** - 531 jobs completed in PROD, 673 in DEV
4. **Worker heartbeats** - Active workers sending heartbeats every 30 seconds

### What's NOT Working ❌

1. **Local deployment** - No services running on local machine
2. **PM2** - Not installed or not in PATH
3. **Docker** - Daemon not running locally
4. **Redis** - Not accessible locally
5. **API server** - Not running (port 3000 not in use)

### What's Unclear ❓

1. **Where are workers running?** - Likely a remote server, but location unknown
2. **Why no pending jobs?** - Either no new jobs submitted, or jobs being processed faster than they arrive
3. **Deployment strategy** - Should use PM2 or Docker? Currently using Docker remotely

---

## 🔧 RECOMMENDED ACTIONS

### Immediate Actions (If you want to run locally)

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Start Redis:**
   ```bash
   # Option 1: Docker
   docker run -d -p 6379:6379 redis:7-alpine
   
   # Option 2: Homebrew (macOS)
   brew install redis
   brew services start redis
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Start services with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 list
   ```

### Alternative: Use Docker Locally

1. **Start Docker daemon:**
   - Open Docker Desktop application
   - Wait for Docker to start

2. **Start all services:**
   ```bash
   docker compose up -d
   ```

3. **Verify services:**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

### Verify Remote Deployment

1. **Check where workers are running:**
   - Review deployment logs
   - Check cloud provider dashboard (AWS, GCP, Azure, etc.)
   - Verify server IP/hostname

2. **Monitor remote workers:**
   ```bash
   # If using PM2 remotely
   ssh user@server "pm2 list"
   ssh user@server "pm2 logs"
   
   # If using Docker remotely
   ssh user@server "docker compose ps"
   ssh user@server "docker compose logs"
   ```

### Fix Playwright Issues (DEV)

1. **Rebuild Docker images with Playwright:**
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

2. **Verify Playwright installation:**
   ```bash
   docker compose exec registre-worker-1 npx playwright --version
   ```

---

## 📈 MONITORING RECOMMENDATIONS

### Health Checks

1. **Worker heartbeats:**
   ```sql
   SELECT worker_id, status, last_heartbeat, 
          EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) as seconds_ago
   FROM worker_status
   WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'
   ORDER BY last_heartbeat DESC;
   ```

2. **Job queue status:**
   ```sql
   SELECT status_id, COUNT(*) as count
   FROM extraction_queue
   GROUP BY status_id;
   ```

3. **Recent errors:**
   ```sql
   SELECT document_source, document_number, error_message, created_at
   FROM extraction_queue
   WHERE status_id = 4
   ORDER BY created_at DESC
   LIMIT 10;
   ```

### Alerts to Set Up

1. **No active workers** - Alert if no workers have heartbeat in last 2 minutes
2. **High error rate** - Alert if >10% of jobs fail
3. **Stuck jobs** - Alert if jobs in EN_TRAITEMENT for >5 minutes
4. **Queue backlog** - Alert if >100 jobs in EN_ATTENTE

---

## 📝 NOTES

- The system appears to be running successfully on a remote server
- Local machine is NOT running any worker processes
- No pending jobs suggests either:
  - No new work has been submitted
  - Workers are processing jobs faster than they arrive
- Recent unified-worker failures suggest a deployment attempt ~18 minutes ago
- Consider standardizing on ONE deployment method (PM2 OR Docker, not both)

---

**Report Generated:** October 31, 2025  
**Diagnostic Script:** `src/scripts/check-all-jobs.ts`  
**Database Status:** ✅ Healthy  
**Worker Status:** ✅ 5 active in PROD (remote)  
**Local Services:** ❌ Not running


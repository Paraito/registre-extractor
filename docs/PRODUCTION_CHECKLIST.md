# 🚀 Production Deployment Checklist

**Last Updated**: October 31, 2025  
**Deployment Method**: PM2

---

## ✅ Pre-Deployment Checklist

### 1. Environment Configuration

- [ ] `.env` file created and configured
- [ ] All required API keys added:
  - [ ] Supabase (PROD/STAGING/DEV)
  - [ ] BrowserBase (API key + Project ID)
  - [ ] RDPRM credentials
  - [ ] AgentQL API key
  - [ ] Gemini API key (optional, for OCR)
- [ ] Worker configuration set:
  - [ ] `WORKER_COUNT=3`
  - [ ] `OCR_WORKER_COUNT=5`
  - [ ] `OCR_PROD=true` (if using OCR)

### 2. Database Setup

- [ ] Supabase project created
- [ ] Required tables exist:
  - [ ] `extraction_queue`
  - [ ] `search_sessions`
  - [ ] `req_companies`
  - [ ] `req_company_details`
  - [ ] `rdprm_searches`
  - [ ] `worker_accounts`
  - [ ] `worker_status`
- [ ] Storage buckets created:
  - [ ] `documents`
  - [ ] `rdprm-documents`
- [ ] Worker accounts added to `worker_accounts` table

### 3. Server Setup

- [ ] Node.js v20+ installed
- [ ] PM2 installed globally (`npm install -g pm2`)
- [ ] Git installed
- [ ] Repository cloned
- [ ] Dependencies installed (`npm install`)
- [ ] TypeScript compiled (`npm run build`)
- [ ] Playwright browsers installed (`npx playwright install --with-deps chromium`)

### 4. Firewall & Security

- [ ] Port 3000 open (for API, if needed)
- [ ] SSH access configured
- [ ] `.env` file permissions set (`chmod 600 .env`)
- [ ] Git configured to ignore `.env`

---

## 🚀 Deployment Steps

### Initial Deployment

```bash
# 1. Navigate to project directory
cd /opt/registre-extractor  # Or your path

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm install

# 4. Build TypeScript
npm run build

# 5. Start PM2 services
pm2 start ecosystem.config.js

# 6. Save PM2 configuration
pm2 save

# 7. Setup PM2 to start on boot
pm2 startup
# Follow the instructions printed by the command

# 8. Verify services are running
pm2 list
```

### Subsequent Deployments

```bash
# Use the deployment script
./scripts/deploy-pm2.sh

# Or manually:
git pull origin main
npm install
npm run build
pm2 restart all
pm2 logs --lines 50
```

---

## ✅ Post-Deployment Verification

### 1. Check PM2 Services

```bash
# List all services (should show 4 services)
pm2 list

# Expected output:
# ┌─────┬────────────────────┬─────────┬─────────┬─────────┬──────────┐
# │ id  │ name               │ status  │ restart │ uptime  │ cpu      │
# ├─────┼────────────────────┼─────────┼─────────┼─────────┼──────────┤
# │ 0   │ unified-worker     │ online  │ 0       │ 5s      │ 0%       │
# │ 1   │ unified-worker     │ online  │ 0       │ 5s      │ 0%       │
# │ 2   │ unified-worker     │ online  │ 0       │ 5s      │ 0%       │
# │ 3   │ registre-ocr       │ online  │ 0       │ 5s      │ 0%       │
# │ 4   │ registre-monitor   │ online  │ 0       │ 5s      │ 0%       │
# │ 5   │ registre-api       │ online  │ 0       │ 5s      │ 0%       │
# └─────┴────────────────────┴─────────┴─────────┴─────────┴──────────┘
```

### 2. Check Logs for Errors

```bash
# View all logs
pm2 logs --lines 50

# Check for errors
pm2 logs --err --lines 20

# Verify workers are polling
pm2 logs unified-worker --lines 20
# Should see: "🔍 No extraction jobs found" or "📋 Claimed extraction job"
```

### 3. Run Verification Scripts

```bash
# Verify deployment
./scripts/verify-deployment.sh

# Verify workers
./scripts/verify-workers.sh

# Run diagnostics
npm run diagnose
```

### 4. Check Database

```bash
# Check worker status in database
npm run diagnose

# Expected output:
# ✅ 9 active workers in PROD
# ✅ Workers have recent heartbeats (< 1 minute ago)
# ✅ Jobs being processed
```

### 5. Test Job Processing

Create a test job and verify it's processed:

```bash
# Create test extraction job via Supabase dashboard or API
# Monitor logs to see it being picked up
pm2 logs unified-worker --lines 0
```

---

## 📊 Monitoring Checklist

### Daily Checks

- [ ] Check PM2 status: `pm2 list`
- [ ] Check for errors: `pm2 logs --err --lines 50`
- [ ] Verify worker heartbeats in database
- [ ] Check job completion rate

### Weekly Checks

- [ ] Review memory usage: `pm2 monit`
- [ ] Check disk space: `df -h`
- [ ] Review error logs for patterns
- [ ] Verify all environments are accessible

### Monthly Checks

- [ ] Update dependencies: `npm update`
- [ ] Rotate API keys (if needed)
- [ ] Review and archive old logs
- [ ] Check for Node.js updates

---

## 🔧 Common Issues & Solutions

### Issue: Services Not Starting

**Solution:**
```bash
# Check logs for errors
pm2 logs --err

# Delete and restart
pm2 delete all
pm2 start ecosystem.config.js
```

### Issue: High Memory Usage

**Solution:**
```bash
# Check memory usage
pm2 monit

# Restart service
pm2 restart unified-worker

# Adjust max_memory_restart in ecosystem.config.js if needed
```

### Issue: Jobs Not Being Processed

**Checklist:**
- [ ] Workers are running: `pm2 list`
- [ ] No errors in logs: `pm2 logs --err`
- [ ] Database connection working: `npm run diagnose`
- [ ] Jobs exist in database with correct status
- [ ] Environment variables correct

### Issue: Playwright Browser Errors

**Solution:**
```bash
# Reinstall browsers
npx playwright install --with-deps chromium

# Verify installation
npx playwright install --dry-run chromium
```

---

## 🛑 Emergency Procedures

### Complete System Restart

```bash
# Stop all services
pm2 stop all

# Wait 10 seconds
sleep 10

# Start all services
pm2 start all

# Monitor logs
pm2 logs --lines 50
```

### Rollback Deployment

```bash
# Go back to previous commit
git log --oneline -5  # Find previous commit hash
git checkout <previous-commit-hash>

# Rebuild and restart
npm install
npm run build
pm2 restart all
```

### Clear Stuck Jobs

```bash
# Run diagnostics to see stuck jobs
npm run diagnose

# Workers automatically reset jobs stuck > 2 minutes on startup
pm2 restart unified-worker
```

---

## 📝 Service Details

### Unified Worker (9 workers)
- **Script**: `dist/worker/unified-worker.js`
- **Instances**: 3 PM2 instances × 3 workers each
- **Handles**: Extraction, REQ, RDPRM jobs
- **Memory Limit**: 1GB per instance

### OCR Worker (5 workers)
- **Script**: `dist/ocr/start-ocr-workers.js`
- **Instances**: 1 PM2 instance
- **Workers**: 5 concurrent OCR workers
- **Memory Limit**: 768MB

### Monitor (1 worker)
- **Script**: `dist/monitor/index.js`
- **Instances**: 1 PM2 instance
- **Purpose**: Health monitoring
- **Memory Limit**: 256MB

### API Server (1 worker)
- **Script**: `dist/api/index.js`
- **Instances**: 1 PM2 instance
- **Port**: 3000
- **Memory Limit**: 512MB

---

## 📚 Additional Resources

- **Main Deployment Guide**: `DEPLOYMENT.md`
- **PM2 Deployment Details**: `docs/PM2-DEPLOYMENT.md`
- **Full Documentation**: `docs/DEPLOYMENT.md`
- **Worker Status**: `docs/WORKER-STATUS.md`
- **Worker Accounts**: `docs/WORKER_ACCOUNTS.md`

---

**Deployment Method**: PM2 only  
**Configuration File**: `ecosystem.config.js`  
**Last Updated**: October 31, 2025


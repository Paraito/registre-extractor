# OCR Worker Pool Deployment Guide

## Problem Summary

**Issue**: OCR jobs are not being picked up by workers.

**Root Cause**: The old `registre-ocr` process was using the outdated OCR monitor (`dist/ocr/monitor.js`) instead of the new unified OCR worker pool (`dist/ocr/start-worker-pool.js`).

**Solution**: Deploy the new unified OCR worker pool system.

---

## Quick Deployment (On Server)

### Option 1: Automated Deployment Script (Recommended)

```bash
# SSH to your server
ssh your-server

# Navigate to project directory
cd /path/to/registre-extractor

# Pull latest changes
git pull

# Run deployment script
./deploy-ocr-workers.sh
```

The script will:
1. ✅ Build the project
2. ✅ Stop old `registre-ocr` worker
3. ✅ Start new `ocr-pool` worker
4. ✅ Restart `registre-workers`
5. ✅ Save PM2 configuration

---

### Option 2: Manual Deployment

If you prefer to do it manually:

```bash
# 1. Build the project
npm run build

# 2. Stop and remove old OCR worker
pm2 stop registre-ocr
pm2 delete registre-ocr

# 3. Stop and remove old registre worker
pm2 stop registre-worker
pm2 delete registre-worker

# 4. Start new workers using updated ecosystem.config.js
pm2 start ecosystem.config.js --only registre-workers
pm2 start ecosystem.config.js --only ocr-pool

# 5. Ensure monitor and API are running
pm2 restart registre-monitor
pm2 restart registre-api

# 6. Save PM2 configuration
pm2 save

# 7. Check status
pm2 list
```

---

## Verification

### 1. Check PM2 Status

```bash
pm2 list
```

You should see:
- ✅ `registre-workers` - running
- ✅ `ocr-pool` - running
- ✅ `registre-monitor` - running
- ✅ `registre-api` - running
- ❌ `registre-ocr` - should NOT be present (old worker)
- ❌ `registre-worker` - should NOT be present (old worker)

### 2. Check OCR Worker Logs

```bash
# Watch OCR pool logs in real-time
pm2 logs ocr-pool

# Or view last 50 lines
pm2 logs ocr-pool --lines 50
```

You should see:
```
🚀 UNIFIED OCR WORKER POOL STARTING
📊 Initializing shared rate limiter...
💾 Initializing server capacity manager...
🎯 Initializing worker pool manager...
✅ All managers initialized
👷 Starting worker pool...
✅ Started ocr-worker-1 (mode: index)
✅ Started ocr-worker-2 (mode: acte)
```

### 3. Check Queue Status

```bash
npx tsx check-ocr-queue.ts
```

You should see the 19 documents in DEV environment being processed.

### 4. Monitor Processing

Watch for log messages like:
```
Claimed job { jobId: '...', environment: 'dev', documentNumber: '...' }
Processing job...
Job completed successfully
```

---

## What Changed

### Old System (REMOVED)
- **Process**: `registre-ocr`
- **Script**: `dist/ocr/monitor.js`
- **Type**: Single OCR monitor
- **Issues**: 
  - Not picking up jobs
  - Outdated architecture
  - No dynamic allocation

### New System (DEPLOYED)
- **Process**: `ocr-pool`
- **Script**: `dist/ocr/start-worker-pool.js`
- **Type**: Unified worker pool
- **Features**:
  - ✅ Dynamic worker allocation
  - ✅ Handles both index and acte documents
  - ✅ Automatic rebalancing
  - ✅ Shared rate limiting
  - ✅ Server capacity management

---

## Configuration

The new system is configured in `ecosystem.config.js`:

```javascript
{
  name: 'ocr-pool',
  script: 'dist/ocr/start-worker-pool.js',
  instances: 1,
  autorestart: true,
  max_memory_restart: '2G',
  env: {
    OCR_WORKER_POOL_SIZE: '2',      // 2 OCR workers
    OCR_MIN_INDEX_WORKERS: '1',     // Min 1 index worker
    OCR_MIN_ACTE_WORKERS: '1',      // Min 1 acte worker
    OCR_DEV: 'true',                // Process DEV environment
    OCR_STAGING: 'false',           // Skip STAGING
    OCR_PROD: 'false'               // Skip PROD
  }
}
```

---

## Troubleshooting

### Workers Not Starting

**Check build output:**
```bash
ls -la dist/ocr/start-worker-pool.js
ls -la dist/worker/start-registre-workers.js
```

Both files should exist. If not:
```bash
npm run build
```

### Workers Not Picking Up Jobs

**Check environment configuration:**
```bash
pm2 env ocr-pool | grep OCR_
```

Should show:
- `OCR_DEV=true`
- `OCR_STAGING=false`
- `OCR_PROD=false`

**Check Redis connection:**
```bash
redis-cli ping
```

Should return `PONG`.

### High Memory Usage

If workers are using too much memory:

1. Reduce pool size in `.env`:
   ```bash
   OCR_WORKER_POOL_SIZE=1
   ```

2. Restart workers:
   ```bash
   pm2 restart ocr-pool
   ```

---

## Monitoring Commands

```bash
# View all PM2 processes
pm2 list

# View OCR pool logs
pm2 logs ocr-pool

# View registre workers logs
pm2 logs registre-workers

# View all logs
pm2 logs

# Monitor system resources
pm2 monit

# Check queue status
npx tsx check-ocr-queue.ts

# Check Redis status
redis-cli info stats
```

---

## Rollback (If Needed)

If you need to rollback to the old system:

```bash
# Stop new workers
pm2 stop ocr-pool
pm2 stop registre-workers
pm2 delete ocr-pool
pm2 delete registre-workers

# Restore old configuration
git checkout HEAD~1 ecosystem.config.js

# Start old workers
pm2 start ecosystem.config.js
pm2 save
```

---

## Next Steps After Deployment

1. ✅ Verify workers are running: `pm2 list`
2. ✅ Check logs for errors: `pm2 logs ocr-pool`
3. ✅ Monitor queue processing: `npx tsx check-ocr-queue.ts`
4. ✅ Watch for completed jobs in Supabase
5. ✅ Verify documents are being processed (status_id changes from 3 → 6 → 5)

---

## Support

If you encounter issues:

1. Check logs: `pm2 logs ocr-pool --lines 100`
2. Check queue: `npx tsx check-ocr-queue.ts`
3. Check Redis: `redis-cli ping`
4. Restart workers: `pm2 restart ocr-pool`
5. Review this guide for troubleshooting steps


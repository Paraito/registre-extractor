# 🚀 URGENT: Deploy OCR Worker Pool Fix

## Problem
**OCR jobs are not being picked up by workers on the server.**

## Root Cause
The PM2 configuration (`ecosystem.config.js`) was using the **old OCR monitor** instead of the **new unified OCR worker pool**.

## Solution
Updated `ecosystem.config.js` to use the new worker pool system.

---

## 📋 Deployment Steps (On Server)

### Quick Deploy (Recommended)

```bash
# 1. SSH to server
ssh your-server

# 2. Navigate to project
cd /path/to/registre-extractor

# 3. Pull latest changes
git pull

# 4. Run deployment script
./deploy-ocr-workers.sh
```

**That's it!** The script handles everything automatically.

---

### What the Script Does

1. ✅ Builds the project (`npm run build`)
2. ✅ Stops old `registre-ocr` worker
3. ✅ Deletes old `registre-worker` 
4. ✅ Starts new `ocr-pool` worker (unified pool)
5. ✅ Starts new `registre-workers` (capacity-managed)
6. ✅ Ensures monitor and API are running
7. ✅ Saves PM2 configuration

---

## ✅ Verification

After deployment, check:

```bash
# 1. Check PM2 status
pm2 list
```

Expected output:
```
┌─────────────────────┬────┬─────────┬──────┐
│ Name                │ id │ status  │ cpu  │
├─────────────────────┼────┼─────────┼──────┤
│ registre-workers    │ 0  │ online  │ 0%   │
│ ocr-pool            │ 1  │ online  │ 0%   │
│ registre-monitor    │ 2  │ online  │ 0%   │
│ registre-api        │ 3  │ online  │ 0%   │
└─────────────────────┴────┴─────────┴──────┘
```

```bash
# 2. Watch OCR logs
pm2 logs ocr-pool --lines 20
```

Expected output:
```
🚀 UNIFIED OCR WORKER POOL STARTING
✅ All managers initialized
✅ Started ocr-worker-1 (mode: index)
✅ Started ocr-worker-2 (mode: acte)
Claimed job { jobId: '...', environment: 'dev' }
```

```bash
# 3. Check queue
npx tsx check-ocr-queue.ts
```

You should see the 19 documents being processed.

---

## 📊 What Changed

### Before (Broken)
```javascript
{
  name: 'registre-ocr',
  script: 'dist/ocr/monitor.js',  // ❌ Old system
  env: {
    OCR_WORKER_COUNT: '5'
  }
}
```

### After (Fixed)
```javascript
{
  name: 'ocr-pool',
  script: 'dist/ocr/start-worker-pool.js',  // ✅ New system
  env: {
    OCR_WORKER_POOL_SIZE: '2',
    OCR_MIN_INDEX_WORKERS: '1',
    OCR_MIN_ACTE_WORKERS: '1',
    OCR_DEV: 'true'
  }
}
```

---

## 🆘 Troubleshooting

### Issue: Script fails with "command not found"

**Solution:**
```bash
chmod +x deploy-ocr-workers.sh
./deploy-ocr-workers.sh
```

### Issue: Workers not picking up jobs

**Check environment:**
```bash
pm2 env ocr-pool | grep OCR_DEV
```

Should show: `OCR_DEV=true`

**Restart workers:**
```bash
pm2 restart ocr-pool
```

### Issue: Build fails

**Clean and rebuild:**
```bash
rm -rf dist/
npm run build
```

---

## 📚 Additional Documentation

- **Full deployment guide**: `OCR_WORKER_DEPLOYMENT.md`
- **Worker pool architecture**: `UNIFIED_OCR_WORKER_POOL.md`
- **Server capacity management**: `SERVER_CAPACITY_MANAGEMENT.md`

---

## 🎯 Expected Results

After deployment:
- ✅ 2 OCR workers running (1 index, 1 acte)
- ✅ 19 documents in DEV queue being processed
- ✅ Documents transitioning: status_id 3 → 6 → 5
- ✅ Logs showing "Claimed job" and "Job completed successfully"

---

## ⏱️ Timeline

- **Deployment time**: ~2 minutes
- **First job pickup**: Within 30 seconds
- **All 19 documents processed**: ~10-30 minutes (depending on document size)

---

## 🔗 Quick Links

```bash
# Monitor everything
pm2 monit

# View logs
pm2 logs ocr-pool

# Check queue
npx tsx check-ocr-queue.ts

# Restart if needed
pm2 restart ocr-pool
```

---

**Questions?** Check `OCR_WORKER_DEPLOYMENT.md` for detailed troubleshooting.


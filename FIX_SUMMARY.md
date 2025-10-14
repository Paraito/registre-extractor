# OCR Worker Pool Fix - Summary

## 🎯 Problem Identified

**Issue**: None of the OCR jobs are being picked up by workers on the server.

**Root Cause**: The PM2 configuration was using the **old OCR monitor system** (`dist/ocr/monitor.js`) instead of the **new unified OCR worker pool** (`dist/ocr/start-worker-pool.js`).

**Evidence**:
- ✅ 19 documents waiting in DEV queue with `status_id = 3` (ready for OCR)
- ✅ All documents are eligible (have PDF paths, haven't exceeded max attempts)
- ✅ `OCR_DEV=true` is configured
- ❌ Workers using old system that doesn't properly poll the queue

---

## ✅ Solution Implemented

### 1. Updated `ecosystem.config.js`

**Changed from:**
```javascript
{
  name: 'registre-ocr',
  script: 'dist/ocr/monitor.js',  // ❌ Old system
  env: {
    OCR_WORKER_COUNT: '5'
  }
}
```

**Changed to:**
```javascript
{
  name: 'ocr-pool',
  script: 'dist/ocr/start-worker-pool.js',  // ✅ New unified pool
  env: {
    OCR_WORKER_POOL_SIZE: '2',
    OCR_MIN_INDEX_WORKERS: '1',
    OCR_MIN_ACTE_WORKERS: '1',
    OCR_DEV: 'true'
  }
}
```

Also updated `registre-worker` → `registre-workers` to use the new capacity-managed system.

### 2. Created Deployment Scripts

- **`deploy-ocr-workers.sh`**: Automated deployment script
- **`verify-ocr-setup.sh`**: Pre-deployment verification script
- **`OCR_WORKER_DEPLOYMENT.md`**: Detailed deployment guide
- **`DEPLOYMENT_INSTRUCTIONS.md`**: Quick reference guide

---

## 📦 Files Changed

### Modified
- ✅ `ecosystem.config.js` - Updated PM2 configuration

### Created
- ✅ `deploy-ocr-workers.sh` - Deployment automation script
- ✅ `verify-ocr-setup.sh` - Pre-deployment verification
- ✅ `OCR_WORKER_DEPLOYMENT.md` - Full deployment guide
- ✅ `DEPLOYMENT_INSTRUCTIONS.md` - Quick instructions
- ✅ `FIX_SUMMARY.md` - This file

---

## 🚀 Deployment Steps

### Step 1: Verify Locally (Optional)

```bash
./verify-ocr-setup.sh
```

Expected: ✅ All checks pass (Redis warning is OK)

### Step 2: Commit and Push

```bash
git add .
git commit -m "Fix: Update ecosystem.config.js to use unified OCR worker pool"
git push
```

### Step 3: Deploy to Server

```bash
# SSH to server
ssh your-server

# Navigate to project
cd /path/to/registre-extractor

# Pull changes
git pull

# Run deployment script
./deploy-ocr-workers.sh
```

### Step 4: Verify Deployment

```bash
# Check PM2 status
pm2 list

# Watch OCR logs
pm2 logs ocr-pool --lines 20

# Check queue
npx tsx check-ocr-queue.ts
```

---

## 📊 Expected Results

### Immediate (Within 30 seconds)
- ✅ `ocr-pool` process running in PM2
- ✅ 2 OCR workers initialized (1 index, 1 acte)
- ✅ Workers start claiming jobs from the queue
- ✅ Logs show: "Claimed job", "Processing job"

### Short-term (5-10 minutes)
- ✅ Documents transitioning: `status_id` 3 → 6 → 5
- ✅ `file_content` and `boosted_file_content` populated
- ✅ Queue count decreasing

### Complete (10-30 minutes)
- ✅ All 19 documents processed
- ✅ No documents with `status_id = 3` remaining
- ✅ All documents have `status_id = 5` (OCR complete)

---

## 🔍 Verification Commands

```bash
# Check PM2 processes
pm2 list

# Expected output:
# ┌─────────────────────┬────┬─────────┐
# │ Name                │ id │ status  │
# ├─────────────────────┼────┼─────────┤
# │ registre-workers    │ 0  │ online  │
# │ ocr-pool            │ 1  │ online  │  ← NEW
# │ registre-monitor    │ 2  │ online  │
# │ registre-api        │ 3  │ online  │
# └─────────────────────┴────┴─────────┘

# Watch OCR worker logs
pm2 logs ocr-pool

# Expected output:
# 🚀 UNIFIED OCR WORKER POOL STARTING
# ✅ Started ocr-worker-1 (mode: index)
# ✅ Started ocr-worker-2 (mode: acte)
# Claimed job { jobId: '...', environment: 'dev' }

# Check queue status
npx tsx check-ocr-queue.ts

# Expected: Documents being processed, count decreasing
```

---

## 🎯 Key Improvements

### Old System Issues
- ❌ Not picking up jobs from queue
- ❌ Outdated architecture
- ❌ No dynamic worker allocation
- ❌ No capacity management

### New System Benefits
- ✅ **Active job polling**: Workers actively claim jobs from queue
- ✅ **Dynamic allocation**: Workers switch between index/acte based on queue
- ✅ **Capacity management**: Respects server CPU/RAM limits
- ✅ **Shared rate limiting**: Coordinates API usage across workers
- ✅ **Auto-rebalancing**: Adjusts worker allocation every 30 seconds
- ✅ **Better logging**: Structured logs with clear status updates

---

## 📈 Performance Expectations

### Server Configuration
- **CPU**: 8 vCPUs (6.4 available after 20% reserve)
- **RAM**: 16 GB (12.8 GB available after 20% reserve)

### Worker Allocation
- **Registre workers**: 1 worker (3 vCPUs, 1 GB RAM)
- **OCR workers**: 2 workers (~2.5 vCPUs, ~1.25 GB RAM)
- **Total usage**: ~5.5 vCPUs, ~2.25 GB RAM
- **Headroom**: ~1 vCPU, ~10.5 GB RAM available

### Processing Speed
- **Index documents**: ~30-60 seconds per document
- **Acte documents**: ~20-40 seconds per document
- **19 documents**: ~10-30 minutes total (parallel processing)

---

## 🆘 Troubleshooting

### Workers Not Starting

**Check build:**
```bash
ls -la dist/ocr/start-worker-pool.js
```

If missing:
```bash
npm run build
```

### Workers Not Picking Up Jobs

**Check environment:**
```bash
pm2 env ocr-pool | grep OCR_DEV
```

Should show: `OCR_DEV=true`

**Restart workers:**
```bash
pm2 restart ocr-pool
```

### High Memory Usage

**Reduce pool size:**
```bash
# Edit .env
OCR_WORKER_POOL_SIZE=1

# Restart
pm2 restart ocr-pool
```

---

## 📚 Documentation

- **Quick Start**: `DEPLOYMENT_INSTRUCTIONS.md`
- **Full Guide**: `OCR_WORKER_DEPLOYMENT.md`
- **Architecture**: `UNIFIED_OCR_WORKER_POOL.md`
- **Capacity Management**: `SERVER_CAPACITY_MANAGEMENT.md`

---

## ✅ Checklist

Before deployment:
- [x] Verified all source files exist
- [x] Updated `ecosystem.config.js`
- [x] Created deployment scripts
- [x] Created documentation
- [x] Ran verification script
- [x] Committed changes

After deployment:
- [ ] Pull changes on server
- [ ] Run deployment script
- [ ] Verify PM2 status
- [ ] Check OCR logs
- [ ] Monitor queue processing
- [ ] Confirm documents are being processed

---

## 🎉 Success Criteria

Deployment is successful when:
1. ✅ `pm2 list` shows `ocr-pool` running
2. ✅ `pm2 logs ocr-pool` shows workers initialized
3. ✅ Workers are claiming jobs from queue
4. ✅ Documents are transitioning from status 3 → 6 → 5
5. ✅ Queue count is decreasing
6. ✅ No errors in logs

---

## 📞 Support

If issues persist after deployment:
1. Check logs: `pm2 logs ocr-pool --lines 100`
2. Check queue: `npx tsx check-ocr-queue.ts`
3. Check Redis: `redis-cli ping`
4. Review: `OCR_WORKER_DEPLOYMENT.md` troubleshooting section
5. Restart workers: `pm2 restart ocr-pool`

---

**Status**: ✅ Ready for deployment
**Estimated deployment time**: ~2 minutes
**Estimated processing time**: ~10-30 minutes for 19 documents


# Server Deployment Guide - Quick Reference

## ✅ Prerequisites Complete

- [x] Redis installed and running on server
- [x] TypeScript compilation errors fixed
- [x] Code pushed to GitHub

---

## 🚀 Deployment Commands (Copy & Paste)

### Step 1: Switch to Registry User & Navigate

```bash
su - registry
cd ~/apps/registre-extractor
```

---

### Step 2: Backup Current Configuration

```bash
cp ecosystem.config.js ecosystem.config.old.js
cp .env .env.backup
pm2 list > pm2-processes-before.txt
```

---

### Step 3: Pull Latest Code

```bash
git pull
```

**Expected**: Should pull the unified worker system code with TypeScript fixes.

---

### Step 4: Update Environment Variables

```bash
nano .env
```

**Add these lines at the end of the file**:

```bash
# ============================================
# REDIS (REQUIRED FOR NEW WORKER SYSTEM)
# ============================================
REDIS_URL=redis://localhost:6379

# ============================================
# SERVER CAPACITY (REQUIRED)
# ============================================
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20

# ============================================
# WORKER CONFIGURATION
# ============================================
WORKER_COUNT=1                  # Registre workers
OCR_WORKER_POOL_SIZE=2          # OCR workers
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1
OCR_REBALANCE_INTERVAL_MS=30000
```

**Save**: `Ctrl+X`, then `Y`, then `Enter`

---

### Step 5: Install Dependencies & Build

```bash
npm install
npm run build
```

**Expected**: 
- `npm install` should install the `redis` package
- `npm run build` should complete without errors

**Verify new files exist**:
```bash
ls -la dist/worker/start-registre-workers.js
ls -la dist/ocr/start-worker-pool.js
ls -la dist/start-all-workers.js
ls -la dist/shared/
```

All should exist.

---

### Step 6: Update PM2 Configuration

```bash
cp ecosystem.config.new.js ecosystem.config.js
```

---

### Step 7: Restart Workers

```bash
# Stop and delete old workers
pm2 stop all
pm2 delete all

# Start new workers
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
```

---

### Step 8: Verify Deployment

```bash
# Check PM2 status
pm2 list
```

**Expected**:
```
┌─────┬────────────────────┬─────────┬─────────┐
│ id  │ name               │ status  │ restart │
├─────┼────────────────────┼─────────┼─────────┤
│ 0   │ registre-workers   │ online  │ 0       │
│ 1   │ ocr-pool           │ online  │ 0       │
│ 2   │ registre-monitor   │ online  │ 0       │
│ 3   │ registre-api       │ online  │ 0       │
└─────┴────────────────────┴─────────┴─────────┘
```

**All should be "online"**.

---

### Step 9: Check Logs

```bash
# Check registre workers
pm2 logs registre-workers --lines 30

# Check OCR pool
pm2 logs ocr-pool --lines 30
```

**Expected in registre-workers**:
```
============================================================
🚀 REGISTRE EXTRACTOR WORKERS STARTING
============================================================
✅ Capacity manager initialized
✅ Sufficient capacity for 1 worker(s)
✅ Started registre-worker-1-xxxxx
============================================================
✅ REGISTRE WORKERS STARTED SUCCESSFULLY
============================================================
```

**Expected in ocr-pool**:
```
============================================================
🚀 UNIFIED OCR WORKER POOL STARTING
============================================================
✅ All managers initialized
✅ Started ocr-worker-1 (mode: index)
✅ Started ocr-worker-2 (mode: acte)
============================================================
✅ WORKER POOL STARTED SUCCESSFULLY
============================================================
```

---

### Step 10: Verify Redis Coordination

```bash
redis-cli GET server:cpu:allocated
redis-cli GET server:ram:allocated
redis-cli GET worker_pool:allocation
```

**Expected**:
- `server:cpu:allocated`: ~5.5
- `server:ram:allocated`: ~2.25
- `worker_pool:allocation`: Should show worker allocation

---

## 🐛 Troubleshooting

### If Workers Show "errored" Status

```bash
# Check error logs
pm2 logs --err --lines 50

# Common fixes:
# 1. Redis not running
exit  # Exit from registry user
sudo systemctl status redis
sudo systemctl start redis
su - registry
cd ~/apps/registre-extractor
pm2 restart all

# 2. Missing environment variables
nano .env  # Add missing variables
pm2 restart all
```

---

### If Build Fails

```bash
# Check for errors
npm run build

# If TypeScript errors, pull latest code again
git pull
npm install
npm run build
```

---

### If Workers Keep Restarting

```bash
# Check logs for the issue
pm2 logs --lines 100

# Reduce worker counts if capacity issue
nano .env
# Change: OCR_WORKER_POOL_SIZE=1
pm2 restart all
```

---

## 🔄 Rollback (If Needed)

```bash
pm2 stop all
pm2 delete all
cp ecosystem.config.old.js ecosystem.config.js
cp .env.backup .env
pm2 start ecosystem.config.js
pm2 save
```

---

## ✅ Success Criteria

After deployment, verify:

1. ✅ All PM2 processes show "online" status
2. ✅ Logs show "WORKERS STARTED SUCCESSFULLY"
3. ✅ Redis shows CPU/RAM allocation (~5.5 vCPUs, ~2.25 GB)
4. ✅ No error messages in logs
5. ✅ Documents are being processed (check Supabase queue)

---

## 📊 Monitoring

### Check Worker Status (Every Hour)

```bash
pm2 list
pm2 logs --lines 20
redis-cli GET server:cpu:allocated
```

### Check Queue Processing (In Supabase)

```sql
SELECT 
  status_id,
  document_source,
  COUNT(*) as count
FROM extraction_queue
GROUP BY status_id, document_source
ORDER BY status_id, document_source;
```

**Expected**: Documents moving through statuses (1 → 2 → 3 → 4)

---

## 📞 Quick Reference

**Start workers**: `pm2 start ecosystem.config.js`  
**Stop workers**: `pm2 stop all`  
**Restart workers**: `pm2 restart all`  
**View logs**: `pm2 logs`  
**View status**: `pm2 list`  
**Save config**: `pm2 save`  

**Check Redis**: `redis-cli GET server:cpu:allocated`  
**Check capacity**: `redis-cli HGETALL server:workers`  
**Check pool**: `redis-cli GET worker_pool:allocation`  

---

## 🎯 Expected Downtime

**Total**: ~2-5 minutes (during PM2 restart)

**Timeline**:
- Backup: 10 seconds
- Git pull: 5 seconds
- Update .env: 30 seconds
- npm install: 10 seconds
- npm build: 15 seconds
- PM2 restart: 30 seconds
- Verification: 60 seconds

---

## 📁 Files Reference

- **`DEPLOYMENT_CHECKLIST.md`** - Detailed step-by-step guide
- **`DEV_SERVER_CONFIGURATION.md`** - Server-specific configuration options
- **`ecosystem.config.new.js`** - New PM2 configuration
- **`.env.example`** - Environment variable template

---

**Good luck with the deployment!** 🚀


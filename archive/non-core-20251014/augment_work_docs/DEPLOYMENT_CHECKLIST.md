# Deployment Checklist - New Unified Worker System

## ⚠️ CRITICAL: This is a BREAKING CHANGE

The new unified worker system requires:
1. **Redis** to be installed and running
2. **Updated PM2 configuration**
3. **Updated environment variables**

**DO NOT** just run `pm2 restart all` - it will use the old configuration!

---

## 🔍 Pre-Deployment Verification

### 1. Check Current PM2 Processes

```bash
su - registry
cd ~/apps/registre-extractor
pm2 list
```

**Expected output**:
```
┌─────┬────────────────────┬─────────┬─────────┐
│ id  │ name               │ status  │ restart │
├─────┼────────────────────┼─────────┼─────────┤
│ 0   │ registre-worker    │ online  │ 5       │
│ 1   │ registre-monitor   │ online  │ 2       │
│ 2   │ registre-ocr       │ online  │ 3       │
│ 3   │ registre-api       │ online  │ 1       │
└─────┴────────────────────┴─────────┴─────────┘
```

**Note**: These are the OLD workers that will be replaced.

---

### 2. Check if Redis is Installed

```bash
redis-cli ping
```

**Expected**: `PONG`

**If not installed**:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis

# Verify
redis-cli ping
```

---

### 3. Check Environment Variables

```bash
cat .env | grep -E "(REDIS_URL|SERVER_MAX_CPU|SERVER_MAX_RAM|OCR_WORKER_POOL_SIZE|WORKER_COUNT)"
```

**Required variables**:
```bash
REDIS_URL=redis://localhost:6379
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20
WORKER_COUNT=1
OCR_WORKER_POOL_SIZE=2
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1
```

**If missing**, add them to `.env` before deploying.

---

## 📋 Deployment Steps

### Step 1: Backup Current Configuration

```bash
su - registry
cd ~/apps/registre-extractor

# Backup PM2 config
cp ecosystem.config.js ecosystem.config.old.js

# Backup .env
cp .env .env.backup

# Save PM2 process list
pm2 list > pm2-processes-before.txt
```

---

### Step 2: Pull Latest Code

```bash
git pull
```

**Expected**: Should pull the new worker system code.

---

### Step 3: Update Environment Variables

```bash
nano .env
```

**Add/Update these variables**:

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

**Save and exit**: `Ctrl+X`, `Y`, `Enter`

---

### Step 4: Install Dependencies

```bash
npm install
```

**Expected**: Should install the new `redis` package.

**Verify**:
```bash
npm list redis
```

**Expected**: `redis@4.6.13` or similar

---

### Step 5: Build

```bash
npm run build
```

**Expected**: Should compile TypeScript to JavaScript in `dist/` folder.

**Verify new files exist**:
```bash
ls -la dist/worker/start-registre-workers.js
ls -la dist/ocr/start-worker-pool.js
ls -la dist/start-all-workers.js
ls -la dist/shared/
```

**All should exist**.

---

### Step 6: Update PM2 Configuration

```bash
# Replace old config with new config
cp ecosystem.config.new.js ecosystem.config.js

# Or manually edit ecosystem.config.js
nano ecosystem.config.js
```

**Choose ONE of two options in the file**:

**Option 1: All Workers Together** (Simpler)
- Uncomment the `registre-all-workers` app
- Comment out `registre-workers` and `ocr-pool` apps

**Option 2: Separate Workers** (More Control) - **RECOMMENDED**
- Keep `registre-workers` and `ocr-pool` apps uncommented
- Comment out `registre-all-workers` app

---

### Step 7: Stop Old Workers

```bash
pm2 stop all
```

**Expected**: All processes should stop.

---

### Step 8: Delete Old Workers

```bash
pm2 delete all
```

**Expected**: All processes should be removed from PM2.

**Verify**:
```bash
pm2 list
```

**Expected**: Empty list or "No processes running"

---

### Step 9: Start New Workers

```bash
pm2 start ecosystem.config.js
```

**Expected output**:
```
[PM2] Starting /home/registry/apps/registre-extractor/dist/worker/start-registre-workers.js in fork_mode (1 instance)
[PM2] Done.
[PM2] Starting /home/registry/apps/registre-extractor/dist/ocr/start-worker-pool.js in fork_mode (1 instance)
[PM2] Done.
[PM2] Starting /home/registry/apps/registre-extractor/dist/monitor/index.js in fork_mode (1 instance)
[PM2] Done.
[PM2] Starting /home/registry/apps/registre-extractor/dist/api/index.js in fork_mode (1 instance)
[PM2] Done.
```

---

### Step 10: Verify Workers Started

```bash
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

### Step 11: Check Logs

```bash
# Check registre workers
pm2 logs registre-workers --lines 50

# Check OCR pool
pm2 logs ocr-pool --lines 50
```

**Expected in registre-workers log**:
```
============================================================
🚀 REGISTRE EXTRACTOR WORKERS STARTING
============================================================
💾 Initializing server capacity manager...
✅ Capacity manager initialized
✅ Sufficient capacity for 1 worker(s)
✅ Started registre-worker-1-xxxxx
============================================================
✅ REGISTRE WORKERS STARTED SUCCESSFULLY
============================================================
```

**Expected in ocr-pool log**:
```
============================================================
🚀 UNIFIED OCR WORKER POOL STARTING
============================================================
📊 Initializing shared rate limiter...
💾 Initializing server capacity manager...
🎯 Initializing worker pool manager...
✅ All managers initialized
✅ Started ocr-worker-1 (mode: index)
✅ Started ocr-worker-2 (mode: acte)
============================================================
✅ WORKER POOL STARTED SUCCESSFULLY
============================================================
```

---

### Step 12: Verify Redis Coordination

```bash
redis-cli

# Check capacity allocation
GET server:cpu:allocated
GET server:ram:allocated

# Check active workers
HGETALL server:workers

# Check OCR pool allocation
GET worker_pool:allocation

# Exit Redis
exit
```

**Expected**:
- `server:cpu:allocated`: ~5.5 (3 for registre + 2.5 for OCR)
- `server:ram:allocated`: ~2.25 (1 for registre + 1.25 for OCR)
- `server:workers`: Should show all workers
- `worker_pool:allocation`: Should show index/acte split

---

### Step 13: Save PM2 Configuration

```bash
pm2 save
```

**Expected**: "Successfully saved in /home/registry/.pm2/dump.pm2"

This ensures workers restart on server reboot.

---

### Step 14: Monitor for 10 Minutes

```bash
# Watch logs in real-time
pm2 logs

# In another terminal, check status every minute
watch -n 60 'pm2 list && redis-cli GET server:cpu:allocated'
```

**Watch for**:
- Workers staying "online"
- No error messages
- Jobs being processed
- CPU/RAM allocation stable

---

## ✅ Post-Deployment Verification

### 1. Check Queue Processing

```sql
-- In Supabase SQL editor
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

### 2. Check Worker Health

```bash
pm2 list
```

**All should be**:
- Status: `online`
- Restart: Low number (< 5)
- Uptime: Increasing

---

### 3. Check Resource Usage

```bash
# CPU usage
top -bn1 | grep "Cpu(s)"

# RAM usage
free -h

# PM2 resource usage
pm2 monit
```

**Expected**:
- CPU: 50-80% (depending on workload)
- RAM: 2-4 GB used
- No swap usage

---

## 🚨 Rollback Plan (If Something Goes Wrong)

### Quick Rollback

```bash
# Stop new workers
pm2 stop all
pm2 delete all

# Restore old config
cp ecosystem.config.old.js ecosystem.config.js

# Restore old .env
cp .env.backup .env

# Start old workers
pm2 start ecosystem.config.js
pm2 save

# Verify
pm2 list
pm2 logs
```

---

## 🐛 Troubleshooting

### Workers Not Starting

**Check logs**:
```bash
pm2 logs --err
```

**Common issues**:
1. Redis not running: `sudo systemctl start redis`
2. Missing env vars: Check `.env` file
3. Build failed: Run `npm run build` again

---

### Workers Crashing

**Check**:
```bash
pm2 logs registre-workers --err --lines 100
pm2 logs ocr-pool --err --lines 100
```

**Common issues**:
1. Insufficient capacity: Reduce `WORKER_COUNT` or `OCR_WORKER_POOL_SIZE`
2. Redis connection failed: Check `REDIS_URL`
3. Supabase credentials: Check `.env` credentials

---

### High CPU Usage

**Check allocation**:
```bash
redis-cli GET server:cpu:allocated
```

**If > 6.4**:
- Reduce `WORKER_COUNT` or `OCR_WORKER_POOL_SIZE`
- Restart workers: `pm2 restart all`

---

## 📞 Summary

**DO NOT** just run `pm2 restart all` - it will use the old configuration!

**Correct deployment process**:
1. ✅ Install Redis
2. ✅ Update `.env` with new variables
3. ✅ Run `npm install`
4. ✅ Run `npm run build`
5. ✅ Update `ecosystem.config.js`
6. ✅ Stop and delete old PM2 processes
7. ✅ Start new PM2 processes
8. ✅ Verify logs and Redis
9. ✅ Save PM2 configuration

**Estimated downtime**: 2-5 minutes (during PM2 restart)

**Rollback time**: < 1 minute (if needed)


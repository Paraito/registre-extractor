# Unified OCR Worker Pool - Quick Start Guide

## 🎯 What Is This?

A **single pool of workers** that dynamically processes **both index and acte documents** based on queue composition. Workers automatically rebalance every 30 seconds to maximize efficiency.

**Key Benefits**:
- ✅ No wasted resources (workers adapt to workload)
- ✅ Automatic optimization (system finds best allocation)
- ✅ Guaranteed parallelism (always processes both types)
- ✅ Simple configuration (just set pool size)

---

## 📋 Prerequisites

### 1. Redis Server

**Required** for coordinating workers across the pool.

**Option A: Local Redis (Development)**
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Verify
redis-cli ping  # Should return "PONG"
```

**Option B: Redis Cloud (Production)**
1. Sign up at https://redis.com/try-free/
2. Create a database
3. Copy the connection URL
4. Add to `.env`: `REDIS_URL=redis://...`

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# ============================================
# UNIFIED OCR WORKER POOL
# ============================================
OCR_WORKER_POOL_SIZE=4          # Total workers (start small!)
OCR_MIN_INDEX_WORKERS=1         # Always keep at least 1 index worker
OCR_MIN_ACTE_WORKERS=1          # Always keep at least 1 acte worker
OCR_REBALANCE_INTERVAL_MS=30000 # Rebalance every 30 seconds

# ============================================
# REDIS CONFIGURATION
# ============================================
REDIS_URL=redis://localhost:6379

# ============================================
# SERVER CAPACITY
# ============================================
SERVER_MAX_CPU=8                # Your server's total vCPUs
SERVER_MAX_RAM=16               # Your server's total RAM (GB)
SERVER_RESERVE_CPU_PERCENT=20   # Reserve 20% for OS
SERVER_RESERVE_RAM_PERCENT=20   # Reserve 20% for OS

# ============================================
# GEMINI API
# ============================================
GEMINI_API_KEY=your_gemini_api_key_here

# ============================================
# SUPABASE ENVIRONMENTS
# ============================================
# Configure at least one environment

# Development
DEV_SUPABASE_URL=https://your-dev-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your_dev_service_key

# Staging (optional)
STAGING_SUPABASE_URL=https://your-staging-project.supabase.co
STAGING_SUPABASE_SERVICE_KEY=your_staging_service_key

# Production (optional)
PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_SERVICE_KEY=your_prod_service_key
```

### 3. Install Dependencies

```bash
npm install
```

This will install the new `redis` package and other dependencies.

---

## 🚀 Starting the Worker Pool

### Development Mode (with auto-reload)

```bash
npm run ocr:pool:dev
```

### Production Mode

```bash
# Build first
npm run build

# Start pool
npm run ocr:pool:start
```

---

## 📊 What You'll See

When the pool starts, you'll see:

```
============================================================
🚀 UNIFIED OCR WORKER POOL STARTING
============================================================
📊 Initializing shared rate limiter...
💾 Initializing server capacity manager...
🎯 Initializing worker pool manager...
✅ All managers initialized

👷 Starting worker pool...

📋 Initial Worker Allocation:
   Index workers: 2
   Acte workers: 2
   Total workers: 4

✅ Started ocr-worker-1 (mode: index)
✅ Started ocr-worker-2 (mode: index)
✅ Started ocr-worker-3 (mode: acte)
✅ Started ocr-worker-4 (mode: acte)

============================================================
✅ WORKER POOL STARTED SUCCESSFULLY
============================================================

⚙️  Configuration:
   Pool size: 4 workers
   Min index workers: 1
   Min acte workers: 1
   Rebalance interval: 30000ms
   Server capacity: 8 vCPUs, 16 GB RAM
   Reserved: 20% CPU, 20% RAM
```

Every 60 seconds, you'll see a status update:

```
============================================================
📊 WORKER POOL STATUS
============================================================

🎯 Worker Allocation:
   Index workers: 3
   Acte workers: 1
   Active workers: 4
     - Index: 3
     - Acte: 1

📡 Gemini API Usage:
   RPM: 12 / 1600 (0.8%)
   TPM: 180,000 / 6,400,000 (2.8%)

💾 Server Capacity:
   CPU: 5.5 / 6.4 vCPUs (85.9%)
   RAM: 3.25 / 12.8 GB (25.4%)
   Workers by type:
     - Registre: 0
     - Index OCR: 3
     - Acte OCR: 1

============================================================
```

---

## 🔄 How Dynamic Rebalancing Works

### Example 1: Morning - Mostly Index Documents

**Queue**: 50 index, 5 acte

**Before rebalance**:
- Index workers: 2
- Acte workers: 2

**After rebalance** (30 seconds later):
- Index workers: 3 (75% of queue)
- Acte workers: 1 (25% of queue)

**Result**: Faster index processing while still handling actes

---

### Example 2: Afternoon - Mostly Acte Documents

**Queue**: 5 index, 50 acte

**Before rebalance**:
- Index workers: 3
- Acte workers: 1

**After rebalance** (30 seconds later):
- Index workers: 1 (min enforced)
- Acte workers: 3 (remaining)

**Result**: Faster acte processing while still handling index

---

## 🛑 Stopping the Worker Pool

Press `Ctrl+C` to gracefully shutdown:

```
============================================================
🛑 SHUTTING DOWN WORKER POOL
============================================================
Stopping workers...
Stopping pool manager...
Stopping rate limiter...
Stopping capacity manager...

✅ WORKER POOL STOPPED SUCCESSFULLY
============================================================
```

All workers will finish their current jobs before stopping.

---

## 📈 Scaling Recommendations

### By Server Size

| Server | Pool Size | Why |
|--------|-----------|-----|
| Small (4 vCPU, 8 GB) | 2 | Safe starting point |
| Medium (8 vCPU, 16 GB) | 4 | Balanced performance |
| Large (16 vCPU, 32 GB) | 8 | High throughput |
| XL (32 vCPU, 64 GB) | 15 | Maximum capacity |

### Scaling Strategy

1. **Start small** (2-4 workers)
2. **Monitor for 1 hour**
   - Check API usage (should be < 80%)
   - Check CPU usage (should be < 80%)
   - Check RAM usage (should be < 80%)
3. **Gradually increase** pool size
4. **Watch for bottlenecks**
   - If API usage hits 80%, you're at max
   - If CPU/RAM hits 80%, you're at max
5. **Set alerts** for high usage

---

## 🔍 Monitoring

### Check Redis Status

```bash
redis-cli

# Check rate limit counters
GET gemini:rpm:current
GET gemini:tpm:current

# Check active workers
HGETALL gemini:workers

# Check pool allocation
GET worker_pool:allocation

# Check worker assignments
HGETALL worker_pool:assignments
```

### Check Supabase Queue

```sql
-- Count documents by type and status
SELECT 
  document_source,
  status_id,
  COUNT(*) as count
FROM extraction_queue
WHERE status_id IN (3, 2)  -- COMPLETE (ready for OCR) or EN_TRAITEMENT (processing)
GROUP BY document_source, status_id
ORDER BY document_source, status_id;
```

---

## 🐛 Troubleshooting

### Workers Not Starting

**Problem**: Workers fail to start

**Check**:
1. Redis is running: `redis-cli ping`
2. Environment variables are set: `cat .env`
3. Gemini API key is valid
4. Supabase credentials are correct

### Workers Not Processing Jobs

**Problem**: Workers idle, but queue has documents

**Check**:
1. Documents have `status_id = 3` (COMPLETE)
2. Documents have `worker_id = null`
3. Worker mode matches document type
4. Check logs for errors

### Rate Limit Errors

**Problem**: Getting 429 errors from Gemini

**Solution**:
1. Reduce `OCR_WORKER_POOL_SIZE`
2. Check current usage: `redis-cli GET gemini:rpm:current`
3. Wait for counter reset (every 60 seconds)

### Server Overload

**Problem**: Server running slow, high CPU/RAM

**Solution**:
1. Reduce `OCR_WORKER_POOL_SIZE`
2. Check capacity: `redis-cli GET server:cpu:allocated`
3. Increase `SERVER_RESERVE_CPU_PERCENT`

---

## 📚 Next Steps

1. **Start with 2 workers** and monitor
2. **Check status every hour** for first day
3. **Gradually scale up** based on queue depth
4. **Set up monitoring** and alerts
5. **Review logs** for any errors

---

## 💡 Key Takeaways

1. ✅ **Start small** (2-4 workers) and scale gradually
2. ✅ **Redis is required** for coordination
3. ✅ **Workers adapt automatically** to queue composition
4. ✅ **Monitor API and server usage** to avoid limits
5. ✅ **Graceful shutdown** finishes current jobs
6. ✅ **Both document types** always processed in parallel

---

**The unified worker pool is ready to use!** 🎉

For more details, see:
- `UNIFIED_OCR_WORKER_POOL.md` - Complete architecture
- `SHARED_RATE_LIMITING_STRATEGY.md` - API rate limiting
- `SERVER_CAPACITY_MANAGEMENT.md` - Server resources


# Dev Server Configuration Guide

## 🖥️ Your Server Specs

```
Machine Type: Basic
CPU Type: Regular
vCPUs: 8 vCPUs
Memory: 16 GB
SSD: 80 GB
Transfer: 6 TB
```

---

## 📊 Capacity Analysis

### Available Resources (with 20% reserve)

```
Total:     8 vCPUs, 16 GB RAM
Reserved:  1.6 vCPUs (20%), 3.2 GB (20%)
Available: 6.4 vCPUs, 12.8 GB RAM
```

---

## ⚙️ Recommended Configuration

### Option 1: Balanced (RECOMMENDED)

**Best for**: Normal workload, both document download and OCR processing

```bash
# Registre Extractor
WORKER_COUNT=1                  # 1 registre worker

# OCR Worker Pool
OCR_WORKER_POOL_SIZE=2          # 2 OCR workers (dynamic allocation)
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1

# Server Capacity
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20
```

**Resource Usage**:
```
Registre:  3.0 vCPUs, 1.0 GB   (1 worker)
OCR Pool:  2.5 vCPUs, 1.25 GB  (2 workers, avg mix)
─────────────────────────────
Total:     5.5 vCPUs, 2.25 GB
Available: 6.4 vCPUs, 12.8 GB
Usage:     86% CPU, 18% RAM    ✅ Comfortable
```

**Throughput**:
- Downloads: ~20 documents/hour (1 registre worker)
- OCR: ~8-12 documents/hour (2 OCR workers, depends on type)

---

### Option 2: OCR-Heavy

**Best for**: Large OCR backlog, downloads already complete

```bash
# Registre Extractor
WORKER_COUNT=0                  # No registre workers (or run separately)

# OCR Worker Pool
OCR_WORKER_POOL_SIZE=5          # 5 OCR workers
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1

# Server Capacity
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20
```

**Resource Usage**:
```
Registre:  0 vCPUs, 0 GB       (no workers)
OCR Pool:  6.25 vCPUs, 3.1 GB  (5 workers, avg mix)
─────────────────────────────
Total:     6.25 vCPUs, 3.1 GB
Available: 6.4 vCPUs, 12.8 GB
Usage:     98% CPU, 24% RAM    ⚠️ Near limit
```

**Throughput**:
- Downloads: 0 (no registre workers)
- OCR: ~20-30 documents/hour (5 OCR workers)

---

### Option 3: Download-Heavy

**Best for**: Building up document queue, OCR can wait

```bash
# Registre Extractor
WORKER_COUNT=2                  # 2 registre workers

# OCR Worker Pool
OCR_WORKER_POOL_SIZE=0          # No OCR workers (or run separately)

# Server Capacity
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20
```

**Resource Usage**:
```
Registre:  6.0 vCPUs, 2.0 GB   (2 workers)
OCR Pool:  0 vCPUs, 0 GB       (no workers)
─────────────────────────────
Total:     6.0 vCPUs, 2.0 GB
Available: 6.4 vCPUs, 12.8 GB
Usage:     94% CPU, 16% RAM    ⚠️ Near limit
```

**Throughput**:
- Downloads: ~40 documents/hour (2 registre workers)
- OCR: 0 (no OCR workers)

---

### Option 4: Maximum (Aggressive)

**Best for**: Testing limits, high workload

```bash
# Registre Extractor
WORKER_COUNT=1                  # 1 registre worker

# OCR Worker Pool
OCR_WORKER_POOL_SIZE=3          # 3 OCR workers
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1

# Server Capacity
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20
```

**Resource Usage**:
```
Registre:  3.0 vCPUs, 1.0 GB   (1 worker)
OCR Pool:  3.75 vCPUs, 1.9 GB  (3 workers, avg mix)
─────────────────────────────
Total:     6.75 vCPUs, 2.9 GB
Available: 6.4 vCPUs, 12.8 GB
Usage:     105% CPU, 23% RAM   ⚠️ OVER LIMIT (but may work)
```

**Note**: This exceeds available CPU by 5%, but OCR workers are dynamic and don't always use full allocation. May work in practice, but monitor closely.

**Throughput**:
- Downloads: ~20 documents/hour (1 registre worker)
- OCR: ~12-18 documents/hour (3 OCR workers)

---

## 🎯 Recommended Approach

### Phase 1: Start Conservative (Week 1)

```bash
WORKER_COUNT=1
OCR_WORKER_POOL_SIZE=2
```

**Why**: Safe, proven to work, leaves headroom for spikes

**Monitor**:
- CPU usage (should be 60-80%)
- RAM usage (should be < 20%)
- Queue depth (documents waiting)
- API usage (should be < 50% of limits)

---

### Phase 2: Scale Based on Bottleneck (Week 2+)

**If download is bottleneck** (queue empty, OCR idle):
```bash
WORKER_COUNT=2          # Increase registre workers
OCR_WORKER_POOL_SIZE=1  # Reduce OCR workers
```

**If OCR is bottleneck** (large queue at status 3):
```bash
WORKER_COUNT=1          # Keep registre workers
OCR_WORKER_POOL_SIZE=3  # Increase OCR workers
```

**If both are busy** (queue growing at all stages):
- Keep current config
- Consider upgrading server
- Or run workers on separate machines

---

## 📈 Scaling Limits

### Maximum Workers by Type

| Worker Type | Max Count | Why |
|-------------|-----------|-----|
| **Registre** | 2 | 2 × 3 vCPUs = 6 vCPUs (94% of available) |
| **OCR Pool** | 5 | 5 × 1.25 vCPUs = 6.25 vCPUs (98% of available) |
| **Combined** | 1 registre + 2 OCR | Total 5.5 vCPUs (86% - recommended) |

### Gemini API Limits (Tier 3)

```
Safe limits: 1600 RPM, 6.4M TPM

OCR Worker Usage:
- Index: 6.7 RPM, 53K TPM per worker
- Acte: 7.2 RPM, 242K TPM per worker

Maximum OCR workers (API-limited):
- Index only: 238 workers (not CPU-limited)
- Acte only: 26 workers (not CPU-limited)
- Your server: 5 workers (CPU-limited)

Conclusion: CPU is your bottleneck, not API
```

---

## 🔍 Monitoring Commands

### Check Current Resource Usage

```bash
# Redis capacity status
redis-cli GET server:cpu:allocated
redis-cli GET server:ram:allocated
redis-cli HGETALL server:workers

# System resources
top -bn1 | grep "Cpu(s)"
free -h

# Worker processes
ps aux | grep -E "(registre|ocr)" | grep -v grep
```

### Check Queue Status

```sql
-- Supabase query
SELECT 
  status_id,
  document_source,
  COUNT(*) as count
FROM extraction_queue
GROUP BY status_id, document_source
ORDER BY status_id, document_source;
```

### Check API Usage

```bash
# Gemini API usage
redis-cli GET gemini:rpm:current
redis-cli GET gemini:tpm:current

# Worker pool allocation
redis-cli GET worker_pool:allocation
```

---

## ⚠️ Warning Signs

### CPU Overload

**Symptoms**:
- Server becomes slow/unresponsive
- Workers timing out
- High system load (> 8.0)

**Solution**:
1. Reduce `WORKER_COUNT` or `OCR_WORKER_POOL_SIZE`
2. Check: `top -bn1 | grep "Cpu(s)"`
3. Increase `SERVER_RESERVE_CPU_PERCENT` to 30%

### RAM Overload

**Symptoms**:
- Out of memory errors
- Workers crashing
- Swap usage increasing

**Solution**:
1. Reduce worker counts
2. Check: `free -h`
3. Increase `SERVER_RESERVE_RAM_PERCENT` to 30%

### API Rate Limiting

**Symptoms**:
- 429 errors in logs
- OCR workers idle
- "Rate limit exceeded" messages

**Solution**:
1. Reduce `OCR_WORKER_POOL_SIZE`
2. Check: `redis-cli GET gemini:rpm:current`
3. Wait 60 seconds for reset

---

## 💡 Pro Tips

### 1. Run Workers Separately

Instead of running all workers together, run them separately for better control:

```bash
# Terminal 1: Registre workers only
npm run registre:dev

# Terminal 2: OCR pool only
npm run ocr:pool:dev
```

This allows you to:
- Start/stop each independently
- Scale each based on workload
- Monitor each separately

### 2. Use Different Configs for Different Times

**Business hours** (9 AM - 5 PM):
```bash
WORKER_COUNT=1          # Download during day
OCR_WORKER_POOL_SIZE=1  # Light OCR
```

**Off hours** (5 PM - 9 AM):
```bash
WORKER_COUNT=0          # No downloads
OCR_WORKER_POOL_SIZE=5  # Heavy OCR processing
```

### 3. Monitor and Adjust

Check status every hour for first week:
```bash
# Quick status check
redis-cli GET server:cpu:allocated
redis-cli GET gemini:rpm:current
```

Adjust based on actual usage, not estimates.

---

## ✅ Quick Start for Your Server

**Copy this to your `.env`**:

```bash
# ============================================
# WORKER CONFIGURATION (8 vCPU, 16 GB SERVER)
# ============================================
WORKER_COUNT=1
OCR_WORKER_POOL_SIZE=2
OCR_MIN_INDEX_WORKERS=1
OCR_MIN_ACTE_WORKERS=1
OCR_REBALANCE_INTERVAL_MS=30000

# ============================================
# SERVER CAPACITY
# ============================================
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
SERVER_RESERVE_CPU_PERCENT=20
SERVER_RESERVE_RAM_PERCENT=20

# ============================================
# REDIS
# ============================================
REDIS_URL=redis://localhost:6379

# ============================================
# GEMINI API
# ============================================
GEMINI_API_KEY=your_key_here

# ============================================
# SUPABASE
# ============================================
DEV_SUPABASE_URL=https://your-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your_service_key
```

**Start workers**:
```bash
npm run workers:dev
```

**Expected output**:
```
Total: 5.5 vCPUs, 2.25 GB
Available: 6.4 vCPUs, 12.8 GB
✅ Configuration fits within server capacity
```

---

## 📞 Need More Capacity?

If you consistently hit limits, consider:

1. **Upgrade server** to 16 vCPU, 32 GB
   - Would allow: 2 registre + 5 OCR workers
   - Cost: ~2x current server

2. **Add second server** for OCR only
   - Server 1: Registre workers only
   - Server 2: OCR pool only
   - Share same Redis and Supabase

3. **Use serverless** for OCR
   - Keep registre on current server
   - Run OCR workers on serverless (AWS Lambda, etc.)
   - Pay per use instead of fixed cost

---

**Your server is perfectly sized for the recommended config (1 registre + 2 OCR)!** 🎉


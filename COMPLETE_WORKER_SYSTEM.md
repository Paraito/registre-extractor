# Complete Worker System - Architecture & Usage

## 🎯 Overview

The complete system consists of **THREE** worker types that coordinate through **shared capacity management**:

1. **Registre Extractor Workers** - Download documents from Quebec Land Registry
2. **Index OCR Workers** - Process index documents with OCR
3. **Acte OCR Workers** - Process acte documents with OCR

All workers share the same server resources and coordinate through **Redis** to prevent overload.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTRACTION QUEUE                         │
│  (Supabase - dev, staging, prod)                            │
│                                                              │
│  Status Flow:                                               │
│  1 (EN_ATTENTE) → 2 (EN_TRAITEMENT) → 3 (COMPLETE)         │
│                                    ↓                         │
│                              4 (OCR_COMPLETE)               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              SERVER CAPACITY MANAGER (Redis)                │
│  Tracks total resource allocation across ALL workers        │
│                                                              │
│  - Registre workers: 3 vCPUs, 1 GB each                     │
│  - Index OCR workers: 1.5 vCPUs, 750 MB each                │
│  - Acte OCR workers: 1 vCPU, 512 MB each                    │
│                                                              │
│  Prevents starting workers if insufficient capacity          │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  REGISTRE    │  │  WORKER POOL     │  │  RATE LIMITER    │
│  WORKERS     │  │  MANAGER         │  │  (Redis)         │
│              │  │                  │  │                  │
│  Download    │  │  Analyzes queue  │  │  Gemini API:     │
│  documents   │  │  every 30s       │  │  - 1600 RPM max  │
│  from        │  │                  │  │  - 6.4M TPM max  │
│  registry    │  │  Allocates OCR   │  │                  │
│              │  │  workers:        │  │  Shared by:      │
│  Status:     │  │  - Index mode    │  │  - Index OCR     │
│  1 → 2 → 3   │  │  - Acte mode     │  │  - Acte OCR      │
└──────────────┘  └──────────────────┘  └──────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
        ┌──────────────┐        ┌──────────────┐
        │  INDEX OCR   │        │  ACTE OCR    │
        │  WORKERS     │        │  WORKERS     │
        │              │        │              │
        │  Process     │        │  Process     │
        │  index docs  │        │  acte docs   │
        │              │        │              │
        │  Status:     │        │  Status:     │
        │  3 → 4       │        │  3 → 4       │
        └──────────────┘        └──────────────┘
```

---

## 📊 Worker Types Comparison

| Worker Type | CPU | RAM | What It Does | Why Heavy/Light |
|-------------|-----|-----|--------------|-----------------|
| **Registre** | 3 vCPUs | 1 GB | Downloads documents via browser | Heavy - runs Chromium, renders pages |
| **Index OCR** | 1.5 vCPUs | 750 MB | OCR on index images | Moderate - image processing with Sharp |
| **Acte OCR** | 1 vCPU | 512 MB | OCR on acte PDFs | Light - just API calls to Gemini |

---

## 🔄 Document Flow

### 1. Registre Extractor Downloads Document

```
Status: EN_ATTENTE (1)
   ↓
Registre worker claims job
   ↓
Status: EN_TRAITEMENT (2)
   ↓
Worker downloads PDF from registry
   ↓
Worker uploads to Supabase Storage
   ↓
Status: COMPLETE (3) ← Ready for OCR
```

### 2. OCR Worker Processes Document

```
Status: COMPLETE (3)
   ↓
OCR worker (index or acte) claims job
   ↓
Status: EN_TRAITEMENT (2)
   ↓
Worker downloads from Supabase Storage
   ↓
Worker processes with Gemini API
   ↓
Worker saves results to database
   ↓
Status: OCR_COMPLETE (4) ← Done!
```

---

## ⚙️ Configuration

### Environment Variables

```bash
# ============================================
# REGISTRE EXTRACTOR WORKERS
# ============================================
WORKER_COUNT=1                  # Number of registre workers (HEAVY!)

# ============================================
# UNIFIED OCR WORKER POOL
# ============================================
OCR_WORKER_POOL_SIZE=4          # Total OCR workers (dynamic allocation)
OCR_MIN_INDEX_WORKERS=1         # Always keep at least 1 index worker
OCR_MIN_ACTE_WORKERS=1          # Always keep at least 1 acte worker
OCR_REBALANCE_INTERVAL_MS=30000 # Rebalance every 30 seconds

# ============================================
# SERVER CAPACITY (SHARED BY ALL WORKERS)
# ============================================
SERVER_MAX_CPU=8                # Your server's total vCPUs
SERVER_MAX_RAM=16               # Your server's total RAM (GB)
SERVER_RESERVE_CPU_PERCENT=20   # Reserve 20% for OS
SERVER_RESERVE_RAM_PERCENT=20   # Reserve 20% for OS

# ============================================
# REDIS (REQUIRED FOR COORDINATION)
# ============================================
REDIS_URL=redis://localhost:6379

# ============================================
# GEMINI API (REQUIRED FOR OCR)
# ============================================
GEMINI_API_KEY=your_gemini_api_key_here

# ============================================
# SUPABASE ENVIRONMENTS
# ============================================
DEV_SUPABASE_URL=https://your-dev-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your_dev_service_key

STAGING_SUPABASE_URL=https://your-staging-project.supabase.co
STAGING_SUPABASE_SERVICE_KEY=your_staging_service_key

PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_SERVICE_KEY=your_prod_service_key
```

---

## 🚀 Starting Workers

### Option 1: Start ALL Workers Together (Recommended)

```bash
# Development mode (with auto-reload)
npm run workers:dev

# Production mode
npm run build
npm run workers:start
```

This starts:
- Registre extractor workers (based on `WORKER_COUNT`)
- OCR worker pool (based on `OCR_WORKER_POOL_SIZE`)
- Automatic capacity checking before startup
- Coordinated shutdown on Ctrl+C

---

### Option 2: Start Workers Separately

**Registre Extractor Only:**
```bash
# Development
npm run registre:dev

# Production
npm run build
npm run registre:start
```

**OCR Pool Only:**
```bash
# Development
npm run ocr:pool:dev

# Production
npm run build
npm run ocr:pool:start
```

---

## 📈 Capacity Planning

### Example Configurations by Server Size

#### Small Server (4 vCPU, 8 GB RAM)

```bash
WORKER_COUNT=1                  # 1 registre worker
OCR_WORKER_POOL_SIZE=0          # No OCR workers (not enough capacity)
SERVER_MAX_CPU=4
SERVER_MAX_RAM=8
```

**Resources**:
- Registre: 3 vCPUs, 1 GB
- Available: 3.2 vCPUs, 6.4 GB (80% of total)
- **Result**: Can only run registre workers

---

#### Medium Server (8 vCPU, 16 GB RAM) ← YOUR DEV SERVER

```bash
WORKER_COUNT=1                  # 1 registre worker
OCR_WORKER_POOL_SIZE=2          # 2 OCR workers (RECOMMENDED)
SERVER_MAX_CPU=8
SERVER_MAX_RAM=16
```

**Resources**:
- Registre: 3 vCPUs, 1 GB
- OCR: 2.5 vCPUs, 1.25 GB (avg)
- Total: 5.5 vCPUs, 2.25 GB
- Available: 6.4 vCPUs, 12.8 GB
- **Result**: ✅ Fits comfortably (86% CPU, 18% RAM)

**See `DEV_SERVER_CONFIGURATION.md` for detailed configuration guide for your server.**

---

#### Large Server (16 vCPU, 32 GB RAM)

```bash
WORKER_COUNT=2                  # 2 registre workers
OCR_WORKER_POOL_SIZE=4          # 4 OCR workers
SERVER_MAX_CPU=16
SERVER_MAX_RAM=32
```

**Resources**:
- Registre: 6 vCPUs, 2 GB
- OCR: 5 vCPUs, 2.5 GB (avg)
- Total: 11 vCPUs, 4.5 GB
- Available: 12.8 vCPUs, 25.6 GB
- **Result**: ✅ Fits well (86% CPU, 18% RAM)

---

#### XL Server (32 vCPU, 64 GB RAM)

```bash
WORKER_COUNT=4                  # 4 registre workers
OCR_WORKER_POOL_SIZE=8          # 8 OCR workers
SERVER_MAX_CPU=32
SERVER_MAX_RAM=64
```

**Resources**:
- Registre: 12 vCPUs, 4 GB
- OCR: 10 vCPUs, 5 GB (avg)
- Total: 22 vCPUs, 9 GB
- Available: 25.6 vCPUs, 51.2 GB
- **Result**: ✅ Fits with room to spare (86% CPU, 18% RAM)

---

## 🔍 Monitoring

### Check Capacity Status (Redis)

```bash
redis-cli

# Check allocated resources
GET server:cpu:allocated
GET server:ram:allocated

# Check active workers
HGETALL server:workers

# Check Gemini API usage
GET gemini:rpm:current
GET gemini:tpm:current

# Check OCR pool allocation
GET worker_pool:allocation
```

### Check Queue Status (Supabase)

```sql
-- Count documents by status
SELECT 
  status_id,
  document_source,
  COUNT(*) as count
FROM extraction_queue
GROUP BY status_id, document_source
ORDER BY status_id, document_source;

-- Find stuck jobs (processing > 10 minutes)
SELECT *
FROM extraction_queue
WHERE status_id = 2
  AND processing_started_at < NOW() - INTERVAL '10 minutes';
```

---

## 💡 Best Practices

### 1. Start Small, Scale Gradually

```bash
# Day 1: Minimal configuration
WORKER_COUNT=1
OCR_WORKER_POOL_SIZE=2

# Monitor for 24 hours, then increase if needed
```

### 2. Monitor Resource Usage

- Check CPU/RAM usage every hour
- Check API usage (should stay < 80%)
- Watch for stuck jobs

### 3. Respect Limits

- **Server capacity**: Keep total usage < 80%
- **Gemini API**: Stay under 1600 RPM, 6.4M TPM
- **Queue depth**: Don't start more workers than jobs available

### 4. Graceful Shutdown

- Always use Ctrl+C (SIGTERM)
- Workers finish current jobs before stopping
- Resources released properly

---

## 🐛 Troubleshooting

### "Insufficient server capacity"

**Problem**: Can't start workers

**Solution**:
1. Reduce `WORKER_COUNT` or `OCR_WORKER_POOL_SIZE`
2. Increase `SERVER_MAX_CPU` or `SERVER_MAX_RAM`
3. Check Redis: `redis-cli GET server:cpu:allocated`

### Workers idle, queue has jobs

**Problem**: Workers not processing

**Check**:
1. Jobs have correct status (3 for OCR, 1 for registre)
2. Jobs have `worker_id = null`
3. Check logs for errors

### Rate limit errors (429)

**Problem**: Exceeding Gemini API limits

**Solution**:
1. Reduce `OCR_WORKER_POOL_SIZE`
2. Check: `redis-cli GET gemini:rpm:current`
3. Wait for reset (every 60 seconds)

---

## 📚 Related Documentation

- `UNIFIED_OCR_WORKER_POOL.md` - OCR pool architecture
- `UNIFIED_WORKER_POOL_QUICKSTART.md` - OCR pool quick start
- `SHARED_RATE_LIMITING_STRATEGY.md` - API rate limiting
- `SERVER_CAPACITY_MANAGEMENT.md` - Server resources

---

## ✅ Summary

**Three worker types, one coordinated system**:

1. ✅ **Registre workers** download documents (heavy)
2. ✅ **OCR pool** processes documents dynamically (adaptive)
3. ✅ **Capacity manager** prevents overload (shared)
4. ✅ **Rate limiter** prevents API errors (shared)
5. ✅ **Simple configuration** - just set worker counts
6. ✅ **Automatic coordination** - Redis handles the rest

**Start all workers with one command**: `npm run workers:dev` 🚀


# Index OCR Worker - Setup Guide

## 📋 Overview

The Index OCR Worker is a distributed worker system that continuously processes documents from the `extraction_queue` table. It supports:

- ✅ **Multi-environment**: Polls dev, staging, and prod databases
- ✅ **Distributed workers**: Multiple workers can run in parallel
- ✅ **Shared rate limiting**: Uses Redis to coordinate API usage across all workers
- ✅ **Automatic job claiming**: Atomic database operations prevent duplicate processing
- ✅ **Graceful shutdown**: Finishes current job before stopping

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd index_ocr_specialist
npm install
```

This will install:
- `redis` - Redis client for rate limiting
- `@supabase/supabase-js` - Supabase client (if not already installed)

### 2. Set Up Redis

**Option A: Local Redis (Development)**

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Verify Redis is running
redis-cli ping
# Should return: PONG
```

**Option B: Redis Cloud (Production)**

1. Sign up at https://redis.com/try-free/
2. Create a new database
3. Copy the connection URL
4. Add to your `.env`:

```bash
REDIS_URL=redis://default:password@redis-12345.cloud.redislabs.com:12345
```

### 3. Configure Environment Variables

Add to your root `.env` file:

```bash
# Redis Configuration (for rate limiting)
REDIS_URL=redis://localhost:6379

# Gemini API Key (required)
GEMINI_API_KEY=your-gemini-api-key-here

# Supabase Environments (configure at least one)
DEV_SUPABASE_URL=https://your-dev-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your-dev-service-key-here

STAGING_SUPABASE_URL=https://your-staging-project.supabase.co
STAGING_SUPABASE_SERVICE_KEY=your-staging-service-key-here

PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_SERVICE_KEY=your-prod-service-key-here
```

### 4. Build the Project

```bash
npm run build
```

### 5. Start a Worker

```bash
npm run worker
```

You should see:

```
================================================================================
🤖 INDEX OCR WORKER
================================================================================

🚀 Worker started - polling for jobs...

Press Ctrl+C to stop gracefully

================================================================================
```

---

## 🔧 Worker Commands

### Start Worker

```bash
npm run worker
```

### Start Worker with Custom ID

```bash
npm run worker -- --worker-id my-worker-1
```

### Start Worker with Custom Redis URL

```bash
npm run worker -- --redis-url redis://my-redis:6379
```

### Stop Worker

Press `Ctrl+C` - the worker will finish its current job and then stop gracefully.

---

## 📊 How It Works

### 1. Worker Startup

```
1. Connect to Redis
2. Register worker in Redis (with ID, type, timestamp)
3. Initialize Supabase clients for all environments
4. Start heartbeat (updates every 10 seconds)
5. Start rate limit auto-reset (every 60 seconds)
6. Begin polling for jobs
```

### 2. Job Polling

```
1. Poll environments in priority order: prod → staging → dev
2. Query for documents with status_id = 3 (COMPLETE, ready for OCR)
3. Filter for worker_id = null (not claimed)
4. Order by created_at (oldest first)
5. Limit 1 (get one job at a time)
```

### 3. Atomic Job Claiming

```sql
UPDATE extraction_queue
SET 
  status_id = 2,           -- EN_TRAITEMENT (processing)
  worker_id = 'worker-123'
WHERE 
  id = 456
  AND status_id = 3        -- Still COMPLETE
  AND worker_id IS NULL    -- Still unclaimed
RETURNING *;
```

If another worker claimed it first, this returns nothing and we try the next job.

### 4. Job Processing

```
1. Download PDF from Supabase Storage
2. Save to temporary file
3. Run OCR pipeline (Gemini-only, no Claude)
4. Update database with results (status_id = 4, OCR_COMPLETE)
5. Clean up temporary file
```

### 5. Rate Limiting

Before each Gemini API call:

```typescript
// Check if we have capacity
const check = await rateLimiter.checkRateLimit(15000); // 15K tokens estimated

if (!check.allowed) {
  // Wait for rate limit window to reset
  await sleep(60000);
}

// Make API call
const result = await gemini.extractText(...);

// Record actual usage
await rateLimiter.recordApiCall(actualTokens);
```

---

## 🏗️ Production Deployment

### Recommended Setup

**For production workload (5 index OCR workers):**

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  index-ocr-worker-1:
    build: ./index_ocr_specialist
    environment:
      - REDIS_URL=redis://redis:6379
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - DEV_SUPABASE_URL=${DEV_SUPABASE_URL}
      - DEV_SUPABASE_SERVICE_KEY=${DEV_SUPABASE_SERVICE_KEY}
      - STAGING_SUPABASE_URL=${STAGING_SUPABASE_URL}
      - STAGING_SUPABASE_SERVICE_KEY=${STAGING_SUPABASE_SERVICE_KEY}
      - PROD_SUPABASE_URL=${PROD_SUPABASE_URL}
      - PROD_SUPABASE_SERVICE_KEY=${PROD_SUPABASE_SERVICE_KEY}
    command: npm run worker -- --worker-id index-ocr-1
    depends_on:
      - redis
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G

  index-ocr-worker-2:
    # Same as worker-1 but with --worker-id index-ocr-2
    ...

  # Add workers 3, 4, 5...

volumes:
  redis-data:
```

### Scaling Guidelines

| Workers | RPM Usage | TPM Usage | Recommended For |
|---------|-----------|-----------|-----------------|
| 1 worker | ~7 RPM | ~53K TPM | Development |
| 2 workers | ~13 RPM | ~106K TPM | Staging |
| 5 workers | ~34 RPM | ~265K TPM | Production (light) |
| 10 workers | ~67 RPM | ~530K TPM | Production (medium) |
| 20 workers | ~134 RPM | ~1.06M TPM | Production (heavy) |

**Maximum safe capacity: ~100 workers** (limited by TPM, not RPM)

---

## 📈 Monitoring

### Check Worker Status

```bash
# Connect to Redis
redis-cli

# Get all active workers
HGETALL gemini:workers

# Get current rate limit usage
GET gemini:rpm:current
GET gemini:tpm:current
```

### Monitor Logs

Workers log to `logs/{worker-id}.ndjson`:

```bash
# Tail worker logs
tail -f logs/index-ocr-*.ndjson | jq .

# Filter for errors
tail -f logs/index-ocr-*.ndjson | jq 'select(.level == "error")'

# Filter for completed jobs
tail -f logs/index-ocr-*.ndjson | jq 'select(.stage == "worker" and .message == "Job completed successfully")'
```

### Metrics to Track

1. **Queue Depth**: Number of documents with `status_id = 3`
2. **Processing Rate**: Jobs completed per hour
3. **API Usage**: Current RPM and TPM from Redis
4. **Worker Health**: Last heartbeat timestamp for each worker
5. **Error Rate**: Failed jobs per hour

---

## 🚨 Troubleshooting

### Worker Not Finding Jobs

**Check 1: Verify documents exist**

```sql
SELECT COUNT(*) 
FROM extraction_queue 
WHERE status_id = 3 
  AND worker_id IS NULL;
```

**Check 2: Verify environment configuration**

```bash
# Make sure environment variables are set
echo $DEV_SUPABASE_URL
echo $DEV_SUPABASE_SERVICE_KEY
```

**Check 3: Check worker logs**

```bash
tail -f logs/index-ocr-*.ndjson | jq .
```

### Rate Limit Errors (429)

**Solution 1: Check Redis**

```bash
redis-cli
GET gemini:rpm:current
GET gemini:tpm:current
```

If values are stuck high, manually reset:

```bash
SET gemini:rpm:current 0
SET gemini:tpm:current 0
```

**Solution 2: Reduce workers**

If you have too many workers, scale down temporarily.

**Solution 3: Increase delays**

Edit `config/rate-limits.ts` to increase `apiDelayMs`.

### Worker Crashes

**Check 1: Memory usage**

```bash
# Monitor memory
docker stats

# If OOM, increase memory limit in docker-compose.yml
```

**Check 2: Disk space**

```bash
# Check temp directory
df -h /tmp

# Clean up old temp files
rm -f /tmp/ocr-*.pdf
```

**Check 3: Redis connection**

```bash
# Test Redis connection
redis-cli ping
```

---

## 🔐 Security Best Practices

1. **Use service role keys** (not anon keys) for workers
2. **Restrict Redis access** to worker network only
3. **Rotate API keys** regularly
4. **Use environment variables** (never hardcode keys)
5. **Enable Redis authentication** in production
6. **Use TLS for Redis** in production

---

## 📞 Next Steps

1. ✅ Install Redis
2. ✅ Configure environment variables
3. ✅ Start 1 worker and test
4. ✅ Monitor for 1 hour
5. ✅ Gradually scale up workers
6. ✅ Set up monitoring and alerts
7. ✅ Configure auto-scaling based on queue depth

---

## 💡 Tips

- **Start with 1 worker** and monitor API usage before scaling
- **Use Redis Cloud** for production (managed, reliable)
- **Monitor queue depth** to determine optimal worker count
- **Set up alerts** for rate limit warnings (>80% usage)
- **Use Docker** for consistent deployments
- **Enable auto-restart** for workers (Docker restart policy)
- **Log to centralized system** (e.g., CloudWatch, Datadog)


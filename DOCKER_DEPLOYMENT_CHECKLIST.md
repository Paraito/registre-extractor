# Docker Deployment Checklist

## ✅ All Fixes Are Docker-Compatible!

All the error fixes implemented are **fully compatible** with Docker deployment.

---

## 🔍 Compatibility Analysis

### 1. **Timeout Fixes (30s timeout)** ✅
- **Change**: Increased `waitForSelector` timeout from 10s to 30s
- **Docker Impact**: None - this is a runtime configuration
- **Status**: ✅ **COMPATIBLE**

### 2. **File Deletion Error Handling** ✅
- **Change**: Added graceful ENOENT error handling for `fs.unlink()`
- **Docker Impact**: None - improves reliability in containers
- **Status**: ✅ **COMPATIBLE** (actually improves Docker stability)

### 3. **Temp Directory Configuration** ✅
- **Current**: `/tmp/ocr-processing` (configurable via `OCR_TEMP_DIR`)
- **Docker**: `/tmp` is always writable by all users (including non-root)
- **Code**: Creates directory with `{ recursive: true }` if it doesn't exist
- **Status**: ✅ **COMPATIBLE**

### 4. **Playwright Browser Installation** ✅
- **Dockerfile Line 41**: `RUN npx playwright install --with-deps chromium`
- **Dockerfile Line 56**: `ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright`
- **Dockerfile Lines 60-67**: Copies browsers to app directory with correct permissions
- **Dockerfile Line 78**: Verifies browser accessibility for non-root user
- **Status**: ✅ **ALREADY CONFIGURED**

---

## 🚀 Deployment Steps

### **1. Build Docker Images**

```bash
# Build all services
docker-compose build

# Or build specific service
docker-compose build registre-worker-1
docker-compose build registre-ocr
```

### **2. Start Services**

```bash
# Start all services
docker-compose up -d

# Or start specific services
docker-compose up -d redis
docker-compose up -d registre-worker-1 registre-worker-2 registre-worker-3
docker-compose up -d registre-ocr
docker-compose up -d registre-monitor
docker-compose up -d registre-api
```

### **3. Verify Services**

```bash
# Check all containers are running
docker-compose ps

# Check logs
docker-compose logs -f registre-worker-1
docker-compose logs -f registre-ocr
docker-compose logs -f registre-monitor
docker-compose logs -f registre-api

# Check specific container
docker logs registre-worker-1 --tail 50 -f
```

### **4. Verify Playwright Installation**

```bash
# Check Playwright browsers in container
docker exec registre-worker-1 ls -la /app/.cache/ms-playwright/

# Should show:
# chromium_headless_shell-1181/
```

### **5. Verify Temp Directory**

```bash
# Check temp directory is writable
docker exec registre-ocr ls -la /tmp/

# Create test file
docker exec registre-ocr touch /tmp/test.txt

# Should succeed without permission errors
```

---

## 🔄 Retry Failed Jobs in Docker

### **Option 1: Run Script in Container**

```bash
# Run retry script in API container (has access to database)
docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --dry-run

# Actually retry jobs
docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
```

### **Option 2: Run Script Locally**

```bash
# If you have .env configured locally
npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
```

---

## 📊 Monitoring in Docker

### **Dashboard Access**

```bash
# Access dashboard at:
http://localhost:3000

# Or if deployed on server:
http://your-server-ip:3000
```

### **Check Worker Status**

```bash
# API endpoint
curl http://localhost:3000/api/workers | jq '.workers | group_by(.worker_type) | map({type: .[0].worker_type, count: length})'
```

### **Check Recent Tasks**

```bash
# API endpoint
curl http://localhost:3000/api/tasks | jq '.tasks[:10] | .[] | {type, identifier, status}'
```

---

## 🐛 Troubleshooting

### **Issue: Playwright Browser Not Found**

```bash
# Check browser installation
docker exec registre-worker-1 npx playwright install --dry-run chromium

# Reinstall if needed (rebuild image)
docker-compose build registre-worker-1
docker-compose up -d registre-worker-1
```

### **Issue: Permission Denied on /tmp**

```bash
# Check permissions
docker exec registre-ocr ls -la /tmp/

# Should show: drwxrwxrwt (world-writable with sticky bit)
```

### **Issue: Worker Not Processing Jobs**

```bash
# Check worker logs
docker logs registre-worker-1 --tail 100 -f

# Check worker status in database via API
curl http://localhost:3000/api/workers | jq
```

### **Issue: OCR Worker Errors**

```bash
# Check OCR worker logs
docker logs registre-ocr --tail 100 -f

# Check temp directory
docker exec registre-ocr ls -la /tmp/ocr-processing/

# Check Gemini API key
docker exec registre-ocr printenv | grep GEMINI_API_KEY
```

---

## 📝 Environment Variables Checklist

Make sure your `.env` file has all required variables:

```bash
# ✅ Supabase (Required)
SUPABASE_URL_PROD=https://xxx.supabase.co
SUPABASE_ANON_KEY_PROD=xxx
SUPABASE_SERVICE_KEY_PROD=xxx

# ✅ Gemini API (Required for OCR)
GEMINI_API_KEY=xxx

# ✅ Worker Accounts (Required)
WORKER_1_USER=xxx
WORKER_1_PASS=xxx
WORKER_1_SEC=xxx

# ✅ OCR Configuration (Optional)
OCR_TEMP_DIR=/tmp/ocr-processing
OCR_WORKER_COUNT=5
OCR_PROD=true

# ✅ Browser Configuration (Optional)
HEADLESS=true
```

---

## ✅ Pre-Deployment Checklist

- [ ] `.env` file configured with all required variables
- [ ] Supabase credentials verified
- [ ] Gemini API key verified
- [ ] Worker accounts verified
- [ ] Docker and Docker Compose installed
- [ ] Sufficient disk space (at least 5GB for images)
- [ ] Port 3000 available (or change in docker-compose.yml)
- [ ] Port 6379 available for Redis (or change in docker-compose.yml)

---

## 🎯 Post-Deployment Verification

### **1. Check All Services Running**

```bash
docker-compose ps

# Expected output:
# registre-worker-1   running
# registre-worker-2   running
# registre-worker-3   running
# registre-ocr        running
# registre-monitor    running
# registre-api        running
# registre-redis      running
```

### **2. Check Dashboard**

```bash
# Open in browser
open http://localhost:3000

# Should show:
# - 3 Unified workers (worker-1, worker-2, worker-3)
# - 5 OCR workers (ocr-worker-xxx)
# - Recent tasks from all types (Extraction, REQ, RDPRM)
```

### **3. Retry Failed Jobs**

```bash
# Run retry script
docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent

# Monitor progress on dashboard
open http://localhost:3000
```

### **4. Monitor Logs**

```bash
# Watch all logs
docker-compose logs -f

# Watch specific service
docker-compose logs -f registre-worker-1
```

---

## 🎉 Summary

✅ **All fixes are Docker-compatible**
✅ **Dockerfile already configured correctly**
✅ **docker-compose.yml already configured correctly**
✅ **Temp directories handled properly**
✅ **Playwright browsers installed and accessible**
✅ **File deletion errors handled gracefully**
✅ **Timeout fixes applied**
✅ **Retry script ready to use**

**No Docker configuration changes needed!** Just rebuild and deploy:

```bash
docker-compose build
docker-compose up -d
docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
```


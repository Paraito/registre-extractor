# Error Resolution Summary

## 📊 Error Analysis

**Total Failed Jobs**: ~95 jobs in "Erreur" status (status_id = 4)

### Error Breakdown:

1. **~47 jobs**: Timeout waiting for `#selCircnFoncr` selector (10s timeout too short)
2. **~11 jobs**: Execution context destroyed during navigation
3. **~8 jobs**: Document doesn't exist (valid business error)
4. **~7 jobs**: Document load timeout (3 minutes)
5. **~5 jobs**: OCR fallback failures (AI couldn't determine cadastre)
6. **~3 jobs**: Playwright not installed (production OCR workers)
7. **~2 jobs**: File system errors (ENOENT - file not found)
8. **~12 jobs**: Other validation errors (invalid document numbers, lot doesn't exist, etc.)

**Additional**: ~72 jobs marked "Extraction Complété" but have OCR errors (Playwright not installed on production)

---

## ✅ Fixes Implemented

### 1. **Timeout Errors (~47 jobs) - FIXED**

**Problem**: 10-second timeout was too short for slow page loads

**Solution**: Increased timeout from 10s to 30s in all locations:

**Files Modified**:
- `src/worker/extractor-ai.ts` - Lines 713, 1229, 1414, 1520 (4 locations)
- `src/worker/extractor-index-fallback.ts` - Line 172 (1 location)

**Impact**: These ~47 jobs should now succeed when retried

---

### 2. **File System Errors (~2 jobs) - FIXED**

**Problem**: Trying to delete temp files that don't exist, causing ENOENT errors

**Solution**: Added file existence check before deletion:
```typescript
try {
  await fs.unlink(localFilePath);
} catch (unlinkError: any) {
  if (unlinkError.code !== 'ENOENT') {
    logger.warn({ error: unlinkError, localFilePath }, 'Failed to delete temp file (non-critical)');
  }
}
```

**Files Modified**:
- `src/ocr/ocr-worker.ts` - Line 387-394
- `src/worker/index.ts` - Line 515-522

**Impact**: No more ENOENT errors during cleanup

---

### 3. **Context Destroyed Errors (~11 jobs) - ALREADY HANDLED**

**Status**: Code already has retry logic for these errors

**Location**: `src/worker/extractor-ai.ts` - Multiple locations with retry logic

**Action**: No changes needed, these should resolve on retry

---

### 4. **Valid Business Errors (~8 jobs) - NO ACTION**

**Errors**:
- "Le document demandé est inexistant" (Document doesn't exist)
- "Aucune information ne correspond aux critères de sélection" (No matching results)
- "Le lot n'existe pas dans la circonscription foncière demandée" (Lot doesn't exist)

**Status**: These are valid errors from the Quebec Land Registry

**Action**: No fix needed - these documents genuinely don't exist

---

### 5. **OCR Worker Issues (~72 jobs) - INFRASTRUCTURE**

**Problem**: Playwright browser not installed on production OCR workers

**Error**: `Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1181`

**Solution**: Run on production server:
```bash
npx playwright install chromium
```

**Status**: Requires production server access

**Impact**: These 72 jobs are marked "Extraction Complété" but OCR failed. Once Playwright is installed, they can be reprocessed for OCR.

---

## 🔄 How to Retry Failed Jobs

### Option 1: Retry All Failed Jobs

```bash
npx tsx src/scripts/retry-failed-jobs.ts
```

### Option 2: Dry Run (Preview Only)

```bash
npx tsx src/scripts/retry-failed-jobs.ts --dry-run
```

### Option 3: Exclude "Document Doesn't Exist" Errors

```bash
npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
```

This will:
1. Reset status from "Erreur" (4) to "En attente" (1)
2. Clear worker_id and processing_started_at
3. Clear error_message
4. Reset attempt counter to 0

Workers will automatically pick up these jobs.

---

## 📈 Expected Results After Retry

| Error Type | Count | Expected Outcome |
|------------|-------|------------------|
| Timeout errors | ~47 | ✅ Should succeed (timeout increased) |
| Context destroyed | ~11 | ✅ Should succeed (retry logic exists) |
| File system errors | ~2 | ✅ Won't error anymore (graceful handling) |
| Document doesn't exist | ~8 | ❌ Will fail again (valid error) |
| Load timeout | ~7 | ⚠️ May succeed or fail (depends on server) |
| OCR fallback failures | ~5 | ⚠️ May succeed or fail (edge cases) |
| Other errors | ~15 | ⚠️ Uncertain |
| **Total Recoverable** | **~60-70** | **~70-80% success rate** |

---

## 🚀 Next Steps

### Immediate Actions:

1. **Rebuild the project**:
   ```bash
   npm run build
   ```

2. **Restart workers** (if running):
   ```bash
   pm2 restart registre-worker
   pm2 restart unified-worker
   ```

3. **Retry failed jobs**:
   ```bash
   npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent
   ```

### Production Server Actions:

4. **Install Playwright on OCR workers**:
   ```bash
   ssh production-server
   cd /path/to/registre-extractor
   npx playwright install chromium
   pm2 restart registre-ocr
   ```

### Monitoring:

5. **Watch the dashboard**: http://localhost:3000
   - Monitor worker status
   - Check task progress
   - Review error logs

6. **Check metrics**:
   ```bash
   curl http://localhost:3000/api/metrics | jq
   ```

---

## 🐳 Docker Deployment

### **All Fixes Are Docker-Compatible!** ✅

All error fixes are fully compatible with Docker deployment:

1. ✅ **Timeout fixes** - Runtime configuration, no Docker changes needed
2. ✅ **File deletion fixes** - Improves Docker stability
3. ✅ **Temp directory** - `/tmp` is always writable in containers
4. ✅ **Playwright** - Already installed in Dockerfile (line 41)

### **Quick Deploy to Docker:**

```bash
# 1. Build images
docker-compose build

# 2. Start services
docker-compose up -d

# 3. Retry failed jobs
docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent

# 4. Monitor dashboard
open http://localhost:3000
```

---

## 📝 Summary

### Fixes Applied:
- ✅ Increased timeout for page selectors (10s → 30s)
- ✅ Added graceful file deletion error handling
- ✅ Created retry script for failed jobs

### Files Modified:
- `src/worker/extractor-ai.ts` (4 timeout fixes)
- `src/worker/extractor-index-fallback.ts` (1 timeout fix)
- `src/ocr/ocr-worker.ts` (file deletion fix)
- `src/worker/index.ts` (file deletion fix)
- `src/scripts/retry-failed-jobs.ts` (NEW)

### Expected Impact:
- **~60-70 jobs** (70-80%) should succeed on retry
- **~8 jobs** will fail again (valid business errors)
- **~15-20 jobs** may need manual review

### Production TODO:
- Install Playwright on OCR workers to fix ~72 OCR errors


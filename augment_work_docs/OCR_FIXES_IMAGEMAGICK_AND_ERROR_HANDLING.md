# OCR Fixes: ImageMagick, Playwright & Error Handling

## 🚀 Quick Start

**To deploy these fixes, run:**
```bash
./update-deployment.sh
```

Or see: [QUICK_UPDATE_GUIDE.md](../QUICK_UPDATE_GUIDE.md)

---

## Summary

Fixed three critical issues with Docker deployment:

1. **Missing ImageMagick and poppler-utils in Docker**: Added system dependencies required for PDF-to-image conversion
2. **Playwright browser installation broken**: Fixed Playwright cache permissions for non-root user
3. **Incorrect error status on max attempts**: OCR failures now properly set status_id to 4 (ERREUR) when max attempts are reached

---

## Issue 1: Playwright Browser Not Found

### Problem
When running extraction workers on the server, the following error occurred:
```
worker error in processing loop: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell
```

### Root Cause
The Dockerfile was installing Playwright browsers as **root user**, which placed the browser cache in `/root/.cache/ms-playwright`. However, the application runs as a **non-root user** (`extractor`), which cannot access the root user's cache directory.

### Solution
Updated `Dockerfile` to:
1. Install Playwright browsers with system dependencies as root
2. Copy the browser cache from `/root/.cache/ms-playwright` to `/app/.cache/ms-playwright`
3. Set proper ownership for the non-root user
4. Set `PLAYWRIGHT_BROWSERS_PATH` environment variable

<augment_code_snippet path="Dockerfile" mode="EXCERPT">
````dockerfile
# Install Playwright browsers with system dependencies (as root)
RUN npx playwright install --with-deps chromium

# Create non-root user and set up permissions
RUN groupadd -r extractor && useradd -r -g extractor extractor

# CRITICAL: Copy Playwright browsers from root cache to app directory
RUN mkdir -p /app/.cache && \
    cp -r /root/.cache/ms-playwright /app/.cache/ && \
    chown -R extractor:extractor /app

# Set Playwright to use the app cache directory
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

# Switch to non-root user
USER extractor
````
</augment_code_snippet>

**Key Points:**
- `--with-deps` flag installs both browser binaries AND required system dependencies
- Browser cache is copied to `/app/.cache/ms-playwright` which is accessible by the `extractor` user
- `PLAYWRIGHT_BROWSERS_PATH` environment variable tells Playwright where to find browsers

---

## Issue 2: Missing PDF Conversion Tools

### Problem
When running OCR on the server, the following error occurred:
```
OCR processing failed: Failed to convert PDF page 1 to image. Please ensure ImageMagick or poppler-utils is installed.
```

### Root Cause
The Dockerfile was missing the system-level dependencies required for PDF-to-image conversion:
- **ImageMagick** (`convert` command)
- **poppler-utils** (`pdftoppm` command)

These tools are NOT installed via `npm install` - they are system-level packages that must be installed separately.

### Solution
Updated `Dockerfile` to install both ImageMagick and poppler-utils:

<augment_code_snippet path="Dockerfile" mode="EXCERPT">
````dockerfile
# Install dependencies for Playwright and OCR (ImageMagick + poppler-utils)
RUN apt-get update && apt-get install -y \
    ...
    imagemagick \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*
````
</augment_code_snippet>

### How PDF Conversion Works
The OCR system uses a fallback mechanism in `src/ocr/pdf-converter.ts`:

1. **Primary**: Try ImageMagick (`convert` command)
2. **Fallback**: If ImageMagick fails, try poppler-utils (`pdftoppm` command)
3. **Error**: If both fail, throw the error message

---

## Issue 3: Incorrect Status on OCR Failure

### Problem
When OCR processing failed after reaching max attempts, documents were left in status 3 (COMPLETE) instead of being marked as status 4 (ERREUR). This made it impossible to identify failed OCR jobs.

### Root Cause
The error handling in `src/ocr/monitor.ts` always reverted status to `EXTRACTION_STATUS.COMPLETE` (3) regardless of whether max attempts had been reached:

```typescript
// OLD CODE - Always reverted to COMPLETE
status_id: EXTRACTION_STATUS.COMPLETE, // Revert to ready for retry
```

### Solution
Updated error handling to check if max attempts have been reached and set appropriate status:

<augment_code_snippet path="src/ocr/monitor.ts" mode="EXCERPT">
````typescript
// Check if max attempts reached
const currentAttempts = document.ocr_attempts || 0;
const maxAttempts = document.ocr_max_attempts || 3;
const hasReachedMaxAttempts = currentAttempts >= maxAttempts;

// If max attempts reached, set status to ERREUR (4), otherwise revert to COMPLETE (3) for retry
await client
  .from('extraction_queue')
  .update({
    status_id: hasReachedMaxAttempts ? EXTRACTION_STATUS.ERREUR : EXTRACTION_STATUS.COMPLETE,
    ocr_error: `OCR processing failed: ${errorMsg}`,
    ocr_last_error_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  })
  .eq('id', document.id);
````
</augment_code_snippet>

### Status Flow
- **Attempt 1-2 (< max)**: Status reverts to 3 (COMPLETE) → Will be retried
- **Attempt 3 (= max)**: Status set to 4 (ERREUR) → No more retries, marked as failed

---

## Files Changed

### 1. `Dockerfile`
- Added `imagemagick` and `poppler-utils` to apt-get install
- Changed Playwright installation to use `--with-deps` flag
- Added browser cache copy from `/root/.cache` to `/app/.cache`
- Set `PLAYWRIGHT_BROWSERS_PATH` environment variable
- Fixed permissions for non-root user access

### 2. `src/ocr/monitor.ts`
- Updated `processIndexDocument()` error handler (lines 465-502)
- Updated `processActeDocument()` error handler (lines 663-700)
- Both now check `ocr_attempts >= ocr_max_attempts` and set status accordingly

---

## Testing

### Test Playwright Installation
After rebuilding Docker image:
```bash
# Check if Playwright browser exists
docker exec <container> ls -la /app/.cache/ms-playwright/

# Verify environment variable is set
docker exec <container> env | grep PLAYWRIGHT

# Test browser launch (as extractor user)
docker exec <container> npx playwright --version
```

### Test ImageMagick & Poppler Installation
After rebuilding Docker image:
```bash
docker exec <container> which convert
docker exec <container> which pdftoppm
docker exec <container> convert --version
docker exec <container> pdftoppm -v
```

All commands should succeed and return version information.

### Test Error Status
1. Create a test job with invalid PDF or unreachable URL
2. Set `ocr_max_attempts` to 2
3. Watch OCR processing fail twice
4. Verify final status_id is 4 (ERREUR) in database

### Test Full Extraction Flow
1. Create a valid extraction job
2. Watch it complete extraction (status_id = 3)
3. Watch OCR pick it up (status_id = 6)
4. Verify OCR completes successfully (status_id = 5)

---

## Deployment

### ⚠️ IMPORTANT: These changes require rebuilding Docker images

The fixes modify the Dockerfile, so you **MUST** rebuild all Docker images before deploying.

### Local Development
```bash
# Rebuild images
npm run docker:build

# Restart services
npm run docker:down
npm run docker:up
```

### Production Deployment
```bash
# Stop existing services
docker-compose -f docker-compose.prod.yml down

# Rebuild images (this will take a few minutes)
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Verify services are running
docker-compose -f docker-compose.prod.yml ps

# Check logs for any errors
docker-compose -f docker-compose.prod.yml logs -f worker
docker-compose -f docker-compose.prod.yml logs -f ocr
```

### Post-Deployment Verification

1. **Check Playwright Installation:**
   ```bash
   docker exec <worker-container> ls -la /app/.cache/ms-playwright/
   ```

2. **Check ImageMagick/Poppler:**
   ```bash
   docker exec <worker-container> which convert
   docker exec <worker-container> which pdftoppm
   ```

3. **Monitor Worker Logs:**
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f worker | grep -i "error\|playwright\|imagemagick"
   ```

4. **Test Extraction:**
   - Create a test job
   - Watch it complete extraction
   - Verify OCR processes successfully

---

## Status ID Reference

| ID | Status Name          | Description                                    |
|----|---------------------|------------------------------------------------|
| 1  | EN_ATTENTE          | Waiting for extraction                         |
| 2  | EN_TRAITEMENT       | Extraction in progress                         |
| 3  | COMPLETE            | Extraction done, ready for OCR                 |
| 4  | ERREUR              | Failed (extraction or OCR max attempts)        |
| 5  | EXTRACTION_COMPLETE | OCR completed successfully                     |
| 6  | OCR_PROCESSING      | OCR in progress                                |

---

## Troubleshooting

### Issue: Playwright still not found after rebuild

**Symptoms:**
```
browserType.launch: Executable doesn't exist at /app/.cache/ms-playwright/...
```

**Solutions:**
1. Verify the environment variable is set:
   ```bash
   docker exec <container> env | grep PLAYWRIGHT_BROWSERS_PATH
   ```
   Should output: `PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright`

2. Check if browsers were copied:
   ```bash
   docker exec <container> ls -la /app/.cache/ms-playwright/
   ```
   Should show chromium directory

3. Verify permissions:
   ```bash
   docker exec <container> ls -la /app/.cache/
   ```
   Owner should be `extractor:extractor`

4. If still failing, rebuild with `--no-cache`:
   ```bash
   docker-compose build --no-cache
   ```

### Issue: ImageMagick/Poppler not found

**Symptoms:**
```
Failed to convert PDF page 1 to image. Please ensure ImageMagick or poppler-utils is installed.
```

**Solutions:**
1. Verify installation:
   ```bash
   docker exec <container> dpkg -l | grep imagemagick
   docker exec <container> dpkg -l | grep poppler-utils
   ```

2. Check if binaries exist:
   ```bash
   docker exec <container> which convert
   docker exec <container> which pdftoppm
   ```

3. If missing, rebuild with `--no-cache`:
   ```bash
   docker-compose build --no-cache
   ```

### Issue: OCR jobs stuck in status 3 (COMPLETE)

**Symptoms:**
- Jobs remain in status 3 after multiple OCR attempts
- `ocr_attempts` reaches `ocr_max_attempts` but status doesn't change to 4

**Solutions:**
1. Check if the code changes were deployed:
   ```bash
   docker exec <container> grep -A 5 "hasReachedMaxAttempts" /app/dist/ocr/monitor.js
   ```
   Should show the new error handling logic

2. Verify the TypeScript was rebuilt:
   ```bash
   docker exec <container> ls -la /app/dist/ocr/monitor.js
   ```
   Check the timestamp - should be recent

3. If old code is still running, rebuild and restart:
   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

---

## Related Files

- `Dockerfile` - Docker image configuration with all system dependencies
- `src/ocr/pdf-converter.ts` - PDF to image conversion logic
- `src/ocr/processor.ts` - OCR processing orchestration
- `src/ocr/monitor.ts` - OCR job monitoring and error handling
- `src/types/index.ts` - Status constants definition

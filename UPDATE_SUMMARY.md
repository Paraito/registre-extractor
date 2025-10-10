# Update Summary - Critical Docker Fixes

## 🎯 What Was Fixed

### 1. ❌ Playwright Browser Not Found (CRITICAL)
**Error on server:**
```
browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1181/chrome-linux/headless_shell
```

**Root Cause:** Playwright browsers installed as root, but app runs as non-root user

**Fix:** 
- Install Playwright with `--with-deps` flag
- Copy browser cache to `/app/.cache/ms-playwright`
- Set `PLAYWRIGHT_BROWSERS_PATH` environment variable
- Fix permissions for non-root user

---

### 2. ❌ ImageMagick/Poppler Not Installed (CRITICAL)
**Error on server:**
```
OCR processing failed: Failed to convert PDF page 1 to image. Please ensure ImageMagick or poppler-utils is installed.
```

**Root Cause:** Missing system packages for PDF-to-image conversion

**Fix:**
- Added `imagemagick` to Dockerfile
- Added `poppler-utils` to Dockerfile

---

### 3. ❌ OCR Failures Not Marked as Error
**Problem:** OCR jobs that failed after max attempts stayed in status 3 (COMPLETE) instead of 4 (ERREUR)

**Root Cause:** Error handler always reverted to COMPLETE status

**Fix:**
- Check if `ocr_attempts >= ocr_max_attempts`
- Set status to 4 (ERREUR) when max reached
- Set status to 3 (COMPLETE) for retry when under max

---

## 🚀 How to Deploy

### Option 1: Automated Script (Recommended)

```bash
./update-deployment.sh
```

This handles everything automatically.

### Option 2: Manual Commands

```bash
git pull
npm install
npm run build
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

**⚠️ IMPORTANT:** You MUST use `--no-cache` flag when rebuilding!

---

## ⏱️ Deployment Time

- **Total Time:** ~10-15 minutes
- **Downtime:** ~5-10 minutes (during rebuild)

---

## ✅ Verification Checklist

After deployment, verify:

```bash
# Get worker container
WORKER=$(docker ps -q -f name=worker | head -1)

# ✓ Playwright installed
docker exec $WORKER ls -la /app/.cache/ms-playwright/

# ✓ ImageMagick installed
docker exec $WORKER which convert

# ✓ Poppler installed
docker exec $WORKER which pdftoppm

# ✓ Environment variable set
docker exec $WORKER env | grep PLAYWRIGHT_BROWSERS_PATH
```

All should succeed without errors.

---

## 📊 Impact

### Before Fix
- ❌ Extraction workers crash on startup (Playwright not found)
- ❌ OCR processing fails (ImageMagick/Poppler missing)
- ❌ Failed OCR jobs not identifiable (wrong status)

### After Fix
- ✅ Extraction workers start successfully
- ✅ OCR processing works correctly
- ✅ Failed OCR jobs properly marked as ERREUR (status 4)

---

## 📁 Files Changed

1. **Dockerfile** - Added system dependencies and fixed Playwright
2. **src/ocr/monitor.ts** - Fixed error status handling
3. **update-deployment.sh** - New automated deployment script
4. **QUICK_UPDATE_GUIDE.md** - Quick reference guide
5. **augment_work_docs/OCR_FIXES_IMAGEMAGICK_AND_ERROR_HANDLING.md** - Full documentation

---

## 🆘 If Something Goes Wrong

### Playwright still not found
```bash
docker-compose build --no-cache
docker-compose up -d
docker exec <container> ls -la /app/.cache/ms-playwright/
```

### ImageMagick/Poppler still missing
```bash
docker-compose build --no-cache
docker-compose up -d
docker exec <container> which convert
docker exec <container> which pdftoppm
```

### Services won't start
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f
```

---

## 📚 Documentation

- **Quick Guide:** [QUICK_UPDATE_GUIDE.md](QUICK_UPDATE_GUIDE.md)
- **Full Details:** [augment_work_docs/OCR_FIXES_IMAGEMAGICK_AND_ERROR_HANDLING.md](augment_work_docs/OCR_FIXES_IMAGEMAGICK_AND_ERROR_HANDLING.md)
- **Deployment Script:** [update-deployment.sh](update-deployment.sh)

---

## ⚠️ Critical Notes

1. **Docker rebuild is REQUIRED** - npm install alone won't fix these issues
2. **Use --no-cache flag** - Ensures all changes are applied
3. **Expect 10-15 minutes** - Docker rebuild takes time
4. **Test after deployment** - Verify all fixes are working

---

## 🎉 Ready to Deploy?

Run this command:
```bash
./update-deployment.sh
```

Then verify everything works!


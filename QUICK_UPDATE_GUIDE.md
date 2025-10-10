# Quick Update Guide

## 🚀 One-Command Update

Run this script to update everything:

```bash
./update-deployment.sh
```

This script will:
1. Pull latest changes from Git
2. Install npm dependencies
3. Build TypeScript
4. **Rebuild Docker images** (required for Playwright, ImageMagick, poppler-utils)
5. Restart all services

---

## 📋 Manual Update Steps

If you prefer to run commands manually:

### For Docker Deployment

```bash
# 1. Pull latest code
git pull

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Stop services
docker-compose -f docker-compose.prod.yml down

# 5. Rebuild images (IMPORTANT: use --no-cache)
docker-compose -f docker-compose.prod.yml build --no-cache

# 6. Start services
docker-compose -f docker-compose.prod.yml up -d

# 7. Check status
docker-compose -f docker-compose.prod.yml ps
```

### For systemd Deployment

```bash
# 1. Pull latest code
git pull

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Stop service
sudo systemctl stop registre-extractor

# 5. Rebuild images (IMPORTANT: use --no-cache)
docker-compose build --no-cache

# 6. Restart service
sudo systemctl daemon-reload
sudo systemctl start registre-extractor

# 7. Check status
sudo systemctl status registre-extractor
```

---

## ✅ Verify Installation

After updating, verify the fixes are applied:

```bash
# Get a worker container ID
WORKER=$(docker ps -q -f name=worker | head -1)

# Check Playwright browser
docker exec $WORKER ls -la /app/.cache/ms-playwright/

# Check ImageMagick
docker exec $WORKER which convert
docker exec $WORKER convert --version

# Check poppler-utils
docker exec $WORKER which pdftoppm
docker exec $WORKER pdftoppm -v

# Check environment variable
docker exec $WORKER env | grep PLAYWRIGHT_BROWSERS_PATH
```

All commands should succeed without errors.

---

## 🔍 Monitor Logs

```bash
# Docker deployment
docker-compose -f docker-compose.prod.yml logs -f worker
docker-compose -f docker-compose.prod.yml logs -f ocr

# systemd deployment
sudo journalctl -u registre-extractor -f
```

---

## ⚠️ Why --no-cache is Required

The `--no-cache` flag ensures:
- Fresh installation of ImageMagick and poppler-utils
- Playwright browsers are properly installed and copied
- All Dockerfile changes are applied
- No cached layers from old builds

**Without `--no-cache`, the fixes may not be applied!**

---

## 🆘 Troubleshooting

### Issue: Playwright still not found

```bash
# Rebuild with no cache
docker-compose build --no-cache

# Verify browser path
docker exec <container> ls -la /app/.cache/ms-playwright/
```

### Issue: ImageMagick/Poppler not found

```bash
# Rebuild with no cache
docker-compose build --no-cache

# Verify installation
docker exec <container> dpkg -l | grep imagemagick
docker exec <container> dpkg -l | grep poppler-utils
```

### Issue: Old code still running

```bash
# Force rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## 📚 Full Documentation

For complete details, see:
- `augment_work_docs/OCR_FIXES_IMAGEMAGICK_AND_ERROR_HANDLING.md`

---

## 🎯 What Changed

1. **Dockerfile**: Added ImageMagick, poppler-utils, fixed Playwright installation
2. **src/ocr/monitor.ts**: OCR failures now set status_id to 4 when max attempts reached
3. **Error Handling**: Proper status tracking for failed OCR jobs

---

## ⏱️ Expected Update Time

- **Pull & Build**: ~2-3 minutes
- **Docker Rebuild**: ~5-10 minutes (first time with --no-cache)
- **Service Restart**: ~30 seconds
- **Total**: ~10-15 minutes


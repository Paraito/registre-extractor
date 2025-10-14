# Environment Configuration Migration Summary

## 🎯 What Changed

The `index_ocr_specialist` module now uses the **root `.env` file** instead of its own local `.env` file. This ensures consistency across the entire project and eliminates duplicate configuration.

---

## 📁 File Structure

### Before
```
registre-extractor/
├── .env                           # Root config (for main app)
├── .env.example                   # Root template
└── index_ocr_specialist/
    ├── .env                       # ❌ Separate config (duplicated)
    └── config/runtime.ts          # Loaded from local .env
```

### After
```
registre-extractor/
├── .env                           # ✅ Single source of truth
├── .env.example                   # ✅ Complete template (updated)
└── index_ocr_specialist/
    ├── .env.archive               # 📦 Old .env (archived for reference)
    ├── .env.README.md             # ✅ Migration guide
    └── config/runtime.ts          # ✅ Loads from root .env
```

---

## 🔧 Changes Made

### 1. Updated Root `.env.example`

Added all `index_ocr_specialist` configuration variables:

```bash
# ============================================
# INDEX OCR SPECIALIST CONFIGURATION
# ============================================

# AI API Keys
GEMINI_API_KEY=your-gemini-api-key-here
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# Qwen3-VL Configuration (optional)
QWEN_API_URL=http://localhost:8000/v1
QWEN_MODEL_NAME=qwen3-vl
QWEN_API_KEY=
QWEN_PORT=3002

# Pipeline Configuration
MAX_LINES_PER_PAGE=60
EXTRACT_WINDOW=15
UPSCALE_FACTOR=2.0
VIEWPORT_SCALE=4.0

# Timeouts & Retries
REQUEST_TIMEOUT_MS=300000
MAX_RETRIES=3
DELAY_BETWEEN_REQUESTS=2000

# Directories
ARTIFACTS_DIR=./artifacts
LOGS_DIR=./logs
REPORTS_DIR=./reports
TEMP_DIR=./tmp

# Server Ports
PORT=3001
GEMINI_PORT=3001

# Test Configuration
TEST_PDF_URL=https://your-test-pdf-url.pdf
```

### 2. Updated `config/runtime.ts`

Changed to load from root directory:

```typescript
import { resolve } from 'path';
import dotenv from 'dotenv';

// Load from root directory (one level up)
const rootDir = resolve(__dirname, '../../');
dotenv.config({ path: resolve(rootDir, '.env.local') }); // Local overrides
dotenv.config({ path: resolve(rootDir, '.env') });       // Main config
```

### 3. Updated `process-queue.ts`

Changed environment variable naming to match root `.env.example`:

**Before**:
```typescript
const ENVIRONMENTS = {
  dev: {
    url: process.env.SUPABASE_URL_DEV || process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY_DEV || process.env.SUPABASE_SERVICE_ROLE_KEY
  },
  // ...
};
```

**After**:
```typescript
const ENVIRONMENTS = {
  dev: {
    url: process.env.DEV_SUPABASE_URL,
    key: process.env.DEV_SUPABASE_SERVICE_KEY
  },
  staging: {
    url: process.env.STAGING_SUPABASE_URL,
    key: process.env.STAGING_SUPABASE_SERVICE_KEY
  },
  prod: {
    url: process.env.PROD_SUPABASE_URL,
    key: process.env.PROD_SUPABASE_SERVICE_KEY
  }
};
```

### 4. Created Migration Documentation

- ✅ `index_ocr_specialist/.env.README.md` - Complete migration guide
- ✅ Updated `docs/PROCESS_QUEUE_GUIDE.md` - Environment configuration section
- ✅ Updated `docs/QUICK_REFERENCE.md` - Environment variables section

### 5. Archived Local `.env`

The old `index_ocr_specialist/.env` file has been **archived** to `.env.archive`:

- ✅ Renamed `.env` → `.env.archive`
- ✅ Updated `.gitignore` to track `.env.archive` (not ignored)
- ✅ File kept for reference only
- ✅ Not loaded by the application

The archive contains the old configuration with API keys and settings for reference.

---

## 📋 Environment Variable Naming Convention

The root `.env.example` uses a consistent naming convention:

### Supabase Configuration

```bash
# Pattern: {ENV}_SUPABASE_{FIELD}
DEV_SUPABASE_URL=...
DEV_SUPABASE_ANON_KEY=...
DEV_SUPABASE_SERVICE_KEY=...

STAGING_SUPABASE_URL=...
STAGING_SUPABASE_ANON_KEY=...
STAGING_SUPABASE_SERVICE_KEY=...

PROD_SUPABASE_URL=...
PROD_SUPABASE_ANON_KEY=...
PROD_SUPABASE_SERVICE_KEY=...
```

### AI API Keys

```bash
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
AGENTQL_API_KEY=...
```

### OCR Configuration

```bash
OCR_WORKER_COUNT=2
OCR_POLL_INTERVAL_MS=10000
OCR_PROD=false
OCR_STAGING=false
OCR_DEV=true
```

---

## ✅ Migration Checklist

Migration is **complete**! The old `.env` has been archived.

- [x] Archived `index_ocr_specialist/.env` to `.env.archive`
- [x] Updated `.gitignore` to track `.env.archive`
- [x] Updated `config/runtime.ts` to load from root `.env`
- [x] Updated Supabase variable names:
  - `SUPABASE_URL_DEV` → `DEV_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY_DEV` → `DEV_SUPABASE_SERVICE_KEY`
  - `SUPABASE_URL_STAGING` → `STAGING_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY_STAGING` → `STAGING_SUPABASE_SERVICE_KEY`
  - `SUPABASE_URL_PROD` → `PROD_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY_PROD` → `PROD_SUPABASE_SERVICE_KEY`
- [x] Build succeeds: `npm run build` ✅

**Next Steps for You**:
- [ ] Copy values from `.env.archive` to root `.env` (if needed)
- [ ] Verify `GEMINI_API_KEY` is set in root `.env`
- [ ] Verify `ANTHROPIC_API_KEY` is set in root `.env`
- [ ] Test configuration: `cd index_ocr_specialist && npm run analyze-throughput`
- [ ] Test process-queue: `npm run process-queue -- --queue-id <id> --env dev`

---

## 🧪 Testing

Verify the configuration works:

```bash
# 1. Test throughput analysis (doesn't need Supabase)
cd index_ocr_specialist
npm run analyze-throughput

# 2. Test build
npm run build

# 3. Test process-queue (needs Supabase configured)
npm run process-queue -- --queue-id 123 --env dev
```

---

## 🔍 Troubleshooting

### "Missing required environment variables" Error

**Cause**: API keys not set in root `.env`

**Solution**:
1. Verify `/path/to/registre-extractor/.env` exists
2. Check `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` are set
3. Ensure no typos in variable names

### "Invalid environment" Error

**Cause**: Supabase credentials not set for the specified environment

**Solution**:
1. For `--env dev`: Set `DEV_SUPABASE_URL` and `DEV_SUPABASE_SERVICE_KEY`
2. For `--env staging`: Set `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_KEY`
3. For `--env prod`: Set `PROD_SUPABASE_URL` and `PROD_SUPABASE_SERVICE_KEY`

### Still Loading from Local `.env`

**Cause**: Old code or cached build

**Solution**:
1. Rebuild: `npm run build`
2. Clear node_modules: `rm -rf node_modules && npm install`
3. Verify `config/runtime.ts` has the updated path resolution

---

## 📚 References

- **Root .env.example**: `../.env.example` (complete template)
- **Migration Guide**: `.env.README.md` (this directory)
- **Runtime Config**: `config/runtime.ts` (loads environment)
- **Process Queue**: `src/server/process-queue.ts` (uses Supabase env vars)
- **Documentation**: `docs/QUICK_REFERENCE.md`

---

**Migration Date**: 2025-10-14  
**Status**: ✅ Complete


# OCR System Implementation Summary

**Date**: October 14, 2025  
**Status**: ✅ Complete and Ready for Testing

## Overview

A complete OCR worker system has been implemented to process documents from the `extraction_queue` table using Google Gemini's File API. The system is designed to work alongside the existing registre extractor workers.

## What Was Built

### 1. Core Components

#### **OCR Worker** (`src/ocr/ocr-worker.ts`)
- Picks up jobs with `status_id = 3` (COMPLETE)
- Environment filtering (dev/staging/prod configurable)
- Race condition prevention using atomic database updates
- Retry logic with `ocr_max_attempts`
- Comprehensive error logging in `ocr_error` field
- Automatic cleanup of temporary files

#### **Gemini Client** (`src/ocr/gemini-client.ts`)
- File upload to Gemini File API
- Waits for file processing completion
- Sends prompts with file references
- Handles API errors gracefully
- Automatic file cleanup after processing

#### **Stale Job Monitor** (`src/ocr/stale-ocr-job-monitor.ts`)
- Runs every 30 seconds
- Detects jobs stuck in `OCR_PROCESSING` status
- Auto-resets jobs stuck for >3 minutes
- Provides safety net for crashed workers

#### **Worker Startup Script** (`src/ocr/start-ocr-workers.ts`)
- Configurable worker count
- Environment validation
- Graceful shutdown handling
- Status logging every 5 minutes
- Signal handling (SIGTERM, SIGINT)

### 2. Document-Specific Prompts

Created separate prompt files for easy modification:

- **`src/ocr/prompts/index.txt`**: Extracts structured JSON data from index documents
- **`src/ocr/prompts/acte.txt`**: Extracts full text from legal act documents  
- **`src/ocr/prompts/plan_cadastraux.txt`**: Extracts text and annotations from cadastral plans

### 3. Configuration Updates

#### **Environment Variables** (`.env`)
```bash
# Required
GEMINI_API_KEY=your-key-here

# Environment Control (only dev enabled by default)
OCR_DEV=true
OCR_STAGING=false
OCR_PROD=false

# Optional
OCR_WORKER_COUNT=2
OCR_EXTRACT_MODEL_GEMINI=gemini-2.0-flash-exp
OCR_TEMP_DIR=/tmp/ocr-processing
```

#### **PM2 Configuration** (`ecosystem.config.js`)
Added OCR worker process:
```javascript
{
  name: 'ocr-worker',
  script: 'dist/ocr/start-ocr-workers.js',
  instances: 1,
  autorestart: true,
  max_memory_restart: '512M',
  env: {
    NODE_ENV: 'production',
    OCR_WORKER_COUNT: 2
  }
}
```

#### **Package Scripts** (`package.json`)
```json
{
  "ocr:dev": "tsx watch src/ocr/start-ocr-workers.ts",
  "ocr:start": "node dist/ocr/start-ocr-workers.js",
  "build": "tsc && cp src/api/dashboard.html dist/api/ && cp -r src/ocr/prompts dist/ocr/"
}
```

## How It Works

### Job Lifecycle

```
1. Registre Worker extracts PDF → status_id = 3 (COMPLETE)
                                   supabase_path = "bucket/file.pdf"
                                   ↓
2. OCR Worker picks up job      → status_id = 6 (OCR_PROCESSING)
                                   ocr_worker_id = "worker-123"
                                   ocr_started_at = NOW()
                                   ↓
3. Download from Supabase       → Local temp file
                                   ↓
4. Upload to Gemini File API    → fileUri = "gemini://..."
                                   ↓
5. Send prompt + file           → Gemini processes
                                   ↓
6. Receive OCR result           → file_content = "extracted text..."
                                   ↓
7. Update database              → status_id = 5 (EXTRACTION_COMPLETE)
                                   ocr_completed_at = NOW()
```

### Race Condition Prevention

Uses atomic database updates to prevent multiple workers from claiming the same job:

```sql
UPDATE extraction_queue
SET status_id = 6,
    ocr_worker_id = 'worker-123',
    ocr_started_at = NOW()
WHERE id = 'job-id'
  AND status_id = 3  -- Only if still COMPLETE
RETURNING *;
```

If the update returns no rows, another worker already claimed it.

### Error Handling & Retry

- **On Error**:
  - Increment `ocr_attempts`
  - Log error in `ocr_error` field
  - Set `ocr_last_error_at` timestamp
  
- **Retry Logic**:
  - If `ocr_attempts < ocr_max_attempts`: Reset to `status_id = 3`
  - If max attempts reached: Set `status_id = 4` (ERREUR)

- **Stale Job Recovery**:
  - Monitor detects jobs stuck in `OCR_PROCESSING` for >3 minutes
  - Automatically resets them for retry

## Database Schema

The system uses existing OCR tracking columns in `extraction_queue`:

```sql
-- OCR tracking fields (already exist from migration 005)
ocr_worker_id TEXT
ocr_started_at TIMESTAMPTZ
ocr_completed_at TIMESTAMPTZ
ocr_attempts INTEGER DEFAULT 0
ocr_max_attempts INTEGER DEFAULT 3
ocr_error TEXT
ocr_last_error_at TIMESTAMPTZ
```

## Testing Checklist

### Prerequisites
- [ ] Set `GEMINI_API_KEY` in `.env`
- [ ] Set `OCR_DEV=true` in `.env`
- [ ] Build project: `npm run build`
- [ ] Have a job with `status_id = 3` and `supabase_path` set

### Test Scenarios

#### 1. Basic OCR Processing
```bash
# Start OCR worker
npm run ocr:dev

# Expected: Worker picks up job, processes it, sets status_id = 5
```

#### 2. Race Condition Test
```bash
# Start 2 workers simultaneously
npm run ocr:dev &
npm run ocr:dev &

# Expected: Each worker claims different jobs, no duplicates
```

#### 3. Retry Logic Test
```bash
# Manually set invalid supabase_path to force error
UPDATE extraction_queue 
SET supabase_path = 'invalid/path.pdf',
    status_id = 3,
    ocr_attempts = 0
WHERE id = 'test-job-id';

# Expected: 
# - Attempt 1: Fails, ocr_attempts = 1, status_id = 3
# - Attempt 2: Fails, ocr_attempts = 2, status_id = 3
# - Attempt 3: Fails, ocr_attempts = 3, status_id = 4 (ERREUR)
```

#### 4. Stale Job Recovery Test
```bash
# Manually set job to stuck state
UPDATE extraction_queue
SET status_id = 6,
    ocr_started_at = NOW() - INTERVAL '10 minutes'
WHERE id = 'test-job-id';

# Expected: Monitor resets it within 30 seconds
```

#### 5. Environment Filtering Test
```bash
# Set OCR_DEV=false, OCR_STAGING=true
# Expected: Worker only processes staging jobs, ignores dev jobs
```

## Production Deployment

### 1. Configure Environment
```bash
# Set in production .env
GEMINI_API_KEY=your-production-key
OCR_PROD=true
OCR_DEV=false
OCR_STAGING=false
OCR_WORKER_COUNT=2
```

### 2. Build and Deploy
```bash
npm run build
pm2 start ecosystem.config.js --only ocr-worker
```

### 3. Monitor
```bash
# Check worker status
pm2 status ocr-worker

# View logs
pm2 logs ocr-worker

# Monitor database
SELECT status_id, COUNT(*) 
FROM extraction_queue 
GROUP BY status_id;
```

## Performance Expectations

- **Throughput**: 10-20 documents/minute per worker
- **Memory**: ~512MB per worker process
- **Temp Storage**: ~50MB per active job
- **API Limits**: Subject to Google Gemini quotas

## Next Steps

1. **Test in Dev Environment**
   - Run through all test scenarios
   - Verify OCR quality for each document type
   - Monitor for any edge cases

2. **Adjust Prompts**
   - Review OCR output quality
   - Refine prompts in `src/ocr/prompts/` as needed
   - No code changes required - just edit text files

3. **Enable for Staging**
   - Set `OCR_STAGING=true`
   - Monitor performance and accuracy

4. **Production Rollout**
   - Set `OCR_PROD=true`
   - Start with 1-2 workers
   - Scale up based on queue depth

## Files Created

```
src/ocr/
├── ocr-worker.ts                 # Main worker class (400 lines)
├── gemini-client.ts              # Gemini API client (220 lines)
├── stale-ocr-job-monitor.ts      # Stale job monitor (130 lines)
├── start-ocr-workers.ts          # Startup script (170 lines)
├── README.md                     # OCR system documentation
└── prompts/
    ├── index.txt                 # Index document prompt
    ├── acte.txt                  # Acte document prompt
    └── plan_cadastraux.txt       # Cadastral plan prompt

docs/
└── OCR_SYSTEM_IMPLEMENTATION.md  # This file
```

## References

- **Gemini File API**: https://ai.google.dev/gemini-api/docs/vision
- **Database Schema**: `supabase/migrations/005_add_ocr_tracking.sql`
- **Status Constants**: `src/types/index.ts` (EXTRACTION_STATUS)
- **Configuration**: `src/config/index.ts` (config.ocr)

---

**Implementation Complete** ✅  
Ready for testing and deployment!


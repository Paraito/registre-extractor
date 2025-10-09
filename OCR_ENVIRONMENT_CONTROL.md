# OCR Environment Control

## Overview

The OCR monitor now supports **environment-specific control** to enable or disable OCR processing for individual environments (production, staging, development). This allows you to:

- ✅ Disable OCR for production until the database schema is updated
- ✅ Test OCR in staging/dev environments first
- ✅ Control costs by limiting which environments process OCR
- ✅ Gradually roll out OCR features across environments

## Configuration

### Environment Variables

Add these settings to your `.env` file:

```bash
# OCR Environment Control (set to false to disable OCR for specific environments)
OCR_PROD=false      # Disable OCR for production
OCR_STAGING=true    # Enable OCR for staging
OCR_DEV=true        # Enable OCR for development
```

### Default Behavior

If not specified, **all environments default to `true`** (OCR enabled).

## How It Works

### Startup

When the OCR monitor starts, it logs which environments have OCR enabled:

```json
{
  "level": "INFO",
  "enabledEnvironments": ["staging", "dev"],
  "disabledEnvironments": ["prod"],
  "msg": "OCR Monitor started"
}
```

### Polling Behavior

The OCR monitor polls **all configured environments** but only processes documents from **enabled environments**:

```
┌─────────────────────────────────────────────────────────┐
│  OCR Monitor Polls Every 10 Seconds                     │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check PROD for docs (status_id = 3, file_content NULL) │
│  ├─ OCR_PROD = false → SKIP                             │
│  └─ Log: "OCR disabled for environment, skipping"       │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check STAGING for docs (status_id = 3, ...)            │
│  ├─ OCR_STAGING = true → PROCESS                        │
│  └─ Found? → Download PDF → Extract → Boost → Save     │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Check DEV for docs (status_id = 3, ...)                │
│  ├─ OCR_DEV = true → PROCESS                            │
│  └─ Found? → Download PDF → Extract → Boost → Save     │
└─────────────────────────────────────────────────────────┘
```

### Debug Logging

When an environment is skipped, you'll see:

```json
{
  "level": "DEBUG",
  "environment": "prod",
  "msg": "OCR disabled for environment, skipping"
}
```

## Use Cases

### 1. Production Schema Not Ready

**Problem:** Production database is missing the `boosted_file_content` column.

**Solution:**
```bash
OCR_PROD=false      # Disable until migration is applied
OCR_STAGING=true
OCR_DEV=true
```

### 2. Testing New OCR Features

**Problem:** Want to test OCR changes in dev before rolling to staging/prod.

**Solution:**
```bash
OCR_PROD=false
OCR_STAGING=false
OCR_DEV=true        # Only dev processes OCR
```

### 3. Cost Control

**Problem:** Want to limit OCR API costs during development.

**Solution:**
```bash
OCR_PROD=true       # Only production processes OCR
OCR_STAGING=false
OCR_DEV=false
```

### 4. Gradual Rollout

**Problem:** Want to roll out OCR gradually across environments.

**Phase 1:**
```bash
OCR_PROD=false
OCR_STAGING=false
OCR_DEV=true        # Test in dev first
```

**Phase 2:**
```bash
OCR_PROD=false
OCR_STAGING=true    # Roll to staging
OCR_DEV=true
```

**Phase 3:**
```bash
OCR_PROD=true       # Full rollout
OCR_STAGING=true
OCR_DEV=true
```

## Current Status

### Your Current Configuration

```bash
OCR_PROD=false      # ❌ Disabled (schema not ready)
OCR_STAGING=true    # ✅ Enabled
OCR_DEV=true        # ✅ Enabled
```

### Why Production is Disabled

Production database is **missing the `boosted_file_content` column** from migration `004_add_boosted_file_content.sql`. 

**Error when enabled:**
```json
{
  "error": {
    "code": "PGRST204",
    "message": "Could not find the 'boosted_file_content' column of 'extraction_queue' in the schema cache"
  },
  "msg": "OCR processing failed for document"
}
```

**To enable production OCR:**

1. Apply migration 004 to production:
   ```sql
   ALTER TABLE extraction_queue 
   ADD COLUMN IF NOT EXISTS boosted_file_content TEXT;

   CREATE INDEX IF NOT EXISTS idx_extraction_queue_boosted_content_search 
   ON extraction_queue USING gin(to_tsvector('french', boosted_file_content))
   WHERE boosted_file_content IS NOT NULL;
   ```

2. Update `.env`:
   ```bash
   OCR_PROD=true
   ```

3. Restart OCR monitor:
   ```bash
   npm run ocr:dev
   ```

## Verification

### Check Current Settings

```bash
# View current environment variables
grep "^OCR_" .env
```

### Check OCR Monitor Logs

```bash
# Start OCR monitor and check startup logs
npm run ocr:dev

# Look for this log entry:
# {"enabledEnvironments":["staging","dev"],"disabledEnvironments":["prod"],"msg":"OCR Monitor started"}
```

### Check Pending Documents

```bash
# Check how many documents need OCR in each environment
npx tsx -e "
import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

async function checkPending() {
  const envs = supabaseManager.getAvailableEnvironments();
  
  for (const env of envs) {
    const client = supabaseManager.getServiceClient(env);
    const { data } = await client
      .from('extraction_queue')
      .select('id')
      .eq('status_id', EXTRACTION_STATUS.COMPLETE)
      .eq('document_source', 'index')
      .is('file_content', null);
    
    console.log(\`\${env}: \${data?.length || 0} docs pending OCR\`);
  }
}

checkPending();
"
```

## Automatic Processing

### Key Features

✅ **Automatic Discovery** - OCR monitor automatically finds documents with:
- `status_id = 3` (Complété)
- `document_source = 'index'`
- `file_content IS NULL`

✅ **Continuous Polling** - Polls every 10 seconds (configurable via `OCR_POLL_INTERVAL_MS`)

✅ **Multi-Environment** - Processes documents from all enabled environments

✅ **Environment Filtering** - Skips disabled environments automatically

✅ **No Manual Triggers** - Documents are processed automatically when they meet criteria

### Processing Flow

1. **Extraction Worker** completes extraction → Sets `status_id = 3`
2. **OCR Monitor** polls and finds document (if environment enabled)
3. **Downloads** PDF from Supabase Storage
4. **Converts** PDF to image (ImageMagick)
5. **Extracts** text using Gemini Vision AI
6. **Boosts** text with 60+ correction rules
7. **Saves** both `file_content` (raw) and `boosted_file_content` (enhanced)
8. **Repeats** for next document

### Example Log Flow

```json
// 1. Found document
{"documentId":"71194ba7...","documentNumber":"1425100","environment":"staging","msg":"Found document needing OCR processing"}

// 2. Downloaded PDF
{"tempPath":"/tmp/ocr-processing/download-1760051664253.pdf","fileSize":161601,"msg":"PDF downloaded successfully"}

// 3. Extracted text
{"textLength":8175,"isComplete":true,"msg":"Text extraction completed"}

// 4. Boosted text
{"boostedTextLength":3422,"isComplete":true,"msg":"Boost corrections applied"}

// 5. Saved to database
{"documentId":"71194ba7...","documentNumber":"1425100","environment":"staging","msg":"OCR processing completed successfully"}

// 6. Automatically picks up next document
{"documentId":"e0f037d3...","documentNumber":"2626043","environment":"staging","msg":"Found document needing OCR processing"}
```

## Troubleshooting

### OCR Not Processing Any Documents

**Check:**
1. Is OCR monitor running? `ps aux | grep ocr`
2. Are any environments enabled? `grep "^OCR_" .env`
3. Are there documents pending? Run verification script above

### OCR Skipping Specific Environment

**Check:**
1. Environment variable: `echo $OCR_PROD` (or STAGING/DEV)
2. Startup logs: Look for `"disabledEnvironments"` array
3. Debug logs: Look for `"OCR disabled for environment, skipping"`

### OCR Failing with Schema Error

**Error:**
```
"Could not find the 'boosted_file_content' column"
```

**Solution:**
1. Disable OCR for that environment: `OCR_PROD=false`
2. Apply migration 004 to the database
3. Re-enable OCR: `OCR_PROD=true`

## Migration Path

### Current State (2025-10-09)

- ✅ **DEV**: Schema ready, OCR enabled
- ✅ **STAGING**: Schema ready, OCR enabled  
- ❌ **PROD**: Schema missing `boosted_file_content`, OCR disabled

### Recommended Steps

1. **Test in Staging/Dev** (Current)
   - Monitor OCR quality and performance
   - Verify boosted content improvements
   - Check for any edge cases

2. **Apply Migration to Production**
   ```bash
   npm run migrate:boosted prod
   # Follow the SQL instructions provided
   ```

3. **Enable Production OCR**
   ```bash
   # Update .env
   OCR_PROD=true
   
   # Restart OCR monitor
   npm run ocr:dev
   ```

4. **Monitor Production**
   - Watch logs for errors
   - Verify documents are processed correctly
   - Check database for `boosted_file_content` values

## Summary

✅ **Environment-specific OCR control** is now implemented  
✅ **Production is disabled** until schema is updated  
✅ **Staging and Dev are enabled** and processing automatically  
✅ **OCR monitor automatically picks up documents** with `status_id = 3`  
✅ **No manual intervention required** - fully automatic processing  

The OCR monitor will continuously poll all enabled environments and process documents as they become available!


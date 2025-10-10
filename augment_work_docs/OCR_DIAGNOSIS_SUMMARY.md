# OCR Worker Diagnosis Summary

## Issue Report
**Row ID:** `65a7ee1f-674d-4efa-a4a1-714b89333921`  
**Environment:** Production  
**Date:** 2025-10-09

## Current Status

### ✅ What's Working
- Row exists in production database
- Document source is `index` (correct)
- Status ID is `3` (COMPLETE - correct)
- Supabase path exists and is valid
- File can be downloaded from storage successfully

### ❌ The Problem
**The OCR worker is NOT picking up this row because:**

The row **already has `file_content`** (1869 characters). The OCR monitor only processes rows where:
```sql
status_id = 3 
AND document_source = 'index' 
AND file_content IS NULL  -- ❌ This row fails this check
```

### 🔍 Root Cause Analysis

1. **OCR was already processed** - The `file_content` field contains 1869 characters of text
2. **Missing database migration** - The production database is missing the `boosted_file_content` column from migration `004_add_boosted_file_content.sql`
3. **Schema mismatch** - The code expects `boosted_file_content` but the production database doesn't have it

### 📊 Database Schema Status

**Production Database Columns:**
```
✅ file_content (exists - has data)
❌ boosted_file_content (MISSING - migration not applied)
```

**Expected by OCR Monitor:**
```typescript
// From src/ocr/monitor.ts line 248-249
file_content: rawText,           // ✅ Exists in DB
boosted_file_content: boostedText, // ❌ Missing in DB
```

## Solutions

### Option 1: Apply Missing Migration (Recommended)
Apply migration `004_add_boosted_file_content.sql` to production:

```bash
# Using Supabase CLI
supabase db push --db-url "postgresql://..."

# Or manually run the SQL
```

**SQL to run:**
```sql
-- Add boosted_file_content column
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS boosted_file_content TEXT;

-- Add index for searching boosted content
CREATE INDEX IF NOT EXISTS idx_extraction_queue_boosted_content_search 
ON extraction_queue USING gin(to_tsvector('french', boosted_file_content))
WHERE boosted_file_content IS NOT NULL;

-- Update column comments
COMMENT ON COLUMN extraction_queue.file_content IS 'Raw OCR extracted text content from the PDF document (for index documents only) - unprocessed output from Gemini Vision AI';
COMMENT ON COLUMN extraction_queue.boosted_file_content IS 'Enhanced OCR text with 60+ domain-specific correction rules applied (for index documents only) - final processed version';
```

### Option 2: Reprocess This Specific Row
If you want to reprocess this row with the new boosting logic:

```sql
-- Clear file_content to trigger reprocessing
UPDATE extraction_queue 
SET file_content = NULL,
    status_id = 3
WHERE id = '65a7ee1f-674d-4efa-a4a1-714b89333921';
```

**⚠️ Warning:** This will delete the existing OCR content and reprocess from scratch.

### Option 3: Backfill Boosted Content
After applying migration 004, backfill existing rows:

```typescript
// Create a script to reprocess existing file_content through boost rules
// This preserves the raw OCR but adds the boosted version
```

## Verification Steps

### 1. Check if OCR Monitor is Running
```bash
# Development
npm run ocr:dev

# Production
npm run ocr
```

### 2. Monitor Logs
The OCR monitor polls every 10 seconds. Check logs for:
```
Found document needing OCR processing
Starting OCR processing for document
OCR processing completed successfully
```

### 3. Verify Row Processing
```bash
npm run diagnose:ocr 65a7ee1f-674d-4efa-a4a1-714b89333921
```

### 4. Check Database After Processing
```sql
SELECT 
  id,
  document_number,
  status_id,
  LENGTH(file_content) as raw_length,
  LENGTH(boosted_file_content) as boosted_length,
  updated_at
FROM extraction_queue
WHERE id = '65a7ee1f-674d-4efa-a4a1-714b89333921';
```

## OCR Worker Query Logic

The OCR monitor uses this query to find documents:

```typescript
// From src/ocr/monitor.ts lines 114-121
const { data: documents, error } = await client
  .from('extraction_queue')
  .select('*')
  .eq('status_id', EXTRACTION_STATUS.COMPLETE)      // status_id = 3
  .eq('document_source', 'index')                    // Only index docs
  .is('file_content', null)                          // NOT YET PROCESSED
  .order('created_at', { ascending: true })
  .limit(1);
```

**This row fails the `file_content IS NULL` check.**

## Download Test Results

✅ **File download from Supabase Storage works correctly:**
- Bucket: `index`
- Storage path parsed successfully
- File downloaded successfully
- No authentication or permission issues

## Recommendations

### Immediate Actions
1. ✅ **Apply migration 004** to production database
2. ✅ **Verify OCR monitor is running** in production
3. ✅ **Check logs** for any errors

### For This Specific Row
Since the row already has OCR content:
- **If content is acceptable:** Leave as-is (OCR already done)
- **If you need boosted version:** Clear `file_content` and let it reprocess
- **If you want both:** Apply migration 004, then manually run boost on existing content

### Long-term
1. Ensure all environments have the same schema (run all migrations)
2. Add schema validation to deployment process
3. Monitor for schema drift between environments

## Files Created
- `diagnose-ocr-row.ts` - Diagnostic script for troubleshooting OCR issues
- Added `npm run diagnose:ocr` command to package.json

## Related Documentation
- `OCR_INTEGRATION.md` - OCR system architecture
- `POST_PROCESSING_IMPLEMENTATION.md` - Post-processing workflow
- `supabase/migrations/003_add_ocr_support.sql` - OCR schema
- `supabase/migrations/004_add_boosted_file_content.sql` - Boost column migration


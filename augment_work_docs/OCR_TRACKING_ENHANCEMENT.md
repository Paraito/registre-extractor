# OCR Job Tracking Enhancement

**Date:** 2025-10-10  
**Database:** NotaFlow - Dev (tmidwbceewlgqyfmuboq)  
**Status:** ✅ Completed

---

## Overview

Enhanced the `extraction_queue` table with comprehensive OCR job tracking capabilities, mirroring the existing extraction tracking pattern. This enables monitoring of OCR worker activity, retry logic, error tracking, and performance analysis.

---

## Changes Implemented

### 1. Database Schema Changes

#### New Status Added to `extraction_status` Table

| ID | Name | Purpose |
|----|------|---------|
| 6 | OCR en traitement | Tracks documents actively being processed by OCR workers |

**Status Flow:**
- Status 3 (Complété) → Extraction complete, ready for OCR
- Status 6 (OCR en traitement) → OCR actively processing
- Status 5 (Extraction Complété) → OCR complete

#### New Columns Added to `extraction_queue` Table

| Column Name | Data Type | Default | Description |
|------------|-----------|---------|-------------|
| `ocr_worker_id` | TEXT | NULL | Identifier of the OCR worker processing this document |
| `ocr_started_at` | TIMESTAMPTZ | NULL | Timestamp when OCR processing began |
| `ocr_completed_at` | TIMESTAMPTZ | NULL | Timestamp when OCR processing completed successfully |
| `ocr_attempts` | INTEGER | 0 | Number of OCR processing attempts made |
| `ocr_max_attempts` | INTEGER | 3 | Maximum number of OCR attempts allowed |
| `ocr_error` | TEXT | NULL | Most recent OCR-specific error message |
| `ocr_last_error_at` | TIMESTAMPTZ | NULL | Timestamp of the most recent OCR error |

#### New Indexes Created

1. **`idx_extraction_queue_ocr_ready`**
   - Columns: `status_id, document_source, created_at, ocr_attempts`
   - Condition: `status_id = 3 AND document_source = 'index' AND file_content IS NULL`
   - Purpose: Efficiently find documents ready for OCR processing

2. **`idx_extraction_queue_ocr_stuck`**
   - Columns: `status_id, ocr_started_at`
   - Condition: `status_id = 6 AND ocr_started_at IS NOT NULL`
   - Purpose: Monitor and detect stuck OCR jobs

---

### 2. Code Changes

#### TypeScript Types (`src/types/index.ts`)

**Updated `ExtractionQueueJob` interface:**
```typescript
export interface ExtractionQueueJob {
  // ... existing fields ...
  
  // OCR tracking fields
  ocr_worker_id?: string;
  ocr_started_at?: string;
  ocr_completed_at?: string;
  ocr_attempts?: number;
  ocr_max_attempts?: number;
  ocr_error?: string;
  ocr_last_error_at?: string;
}
```

**Updated `EXTRACTION_STATUS` constants:**
```typescript
export const EXTRACTION_STATUS = {
  EN_ATTENTE: 1,           // En attente
  EN_TRAITEMENT: 2,        // En traitement
  COMPLETE: 3,             // Complété (extraction done, ready for OCR)
  ERREUR: 4,               // Erreur
  EXTRACTION_COMPLETE: 5,  // Extraction Complété (OCR done)
  OCR_PROCESSING: 6        // OCR en traitement (OCR in progress)
} as const;
```

#### OCR Monitor (`src/ocr/monitor.ts`)

**1. Enhanced Query Logic:**
- Now checks `ocr_attempts < ocr_max_attempts` to prevent infinite retries
- Only processes documents that haven't exceeded max OCR attempts

**2. Job Start Tracking:**
- Sets `status_id = 6` (OCR_PROCESSING) when starting
- Records `ocr_worker_id` (configurable via `OCR_WORKER_ID` env var, defaults to `ocr-monitor-1`)
- Records `ocr_started_at` timestamp
- Increments `ocr_attempts` counter

**3. Success Tracking:**
- Records `ocr_completed_at` timestamp
- Clears `ocr_error` field
- Sets `status_id = 5` (EXTRACTION_COMPLETE)

**4. Error Handling:**
- Reverts `status_id` to 3 (COMPLETE) to allow retry
- Records error in `ocr_error` field (separate from `error_message`)
- Records `ocr_last_error_at` timestamp
- Maintains backward compatibility by also updating `error_message`

---

## Benefits

✅ **Worker Monitoring:** Track which OCR worker is processing which document  
✅ **Performance Analysis:** Measure OCR processing duration via timestamps  
✅ **Retry Logic:** Implement OCR-specific retry attempts (separate from extraction retries)  
✅ **Error Separation:** Distinguish OCR errors from extraction errors  
✅ **Stuck Job Detection:** Identify and monitor stuck OCR jobs  
✅ **Consistency:** Mirrors existing extraction tracking pattern  
✅ **Backward Compatibility:** Maintains existing `error_message` field

---

## Configuration

### Environment Variables

**`OCR_WORKER_ID`** (optional)
- Default: `ocr-monitor-1`
- Purpose: Unique identifier for the OCR worker instance
- Example: `OCR_WORKER_ID=ocr-worker-prod-01`

---

## Migration File

**Location:** `supabase/migrations/005_add_ocr_tracking.sql`

This migration file documents all database changes and can be applied to other environments (Staging, Production) when ready.

---

## Monitoring Queries

### Find Documents Ready for OCR
```sql
SELECT id, document_number, ocr_attempts, ocr_max_attempts, created_at
FROM extraction_queue
WHERE status_id = 3 
  AND document_source = 'index'
  AND file_content IS NULL
  AND (ocr_attempts IS NULL OR ocr_attempts < ocr_max_attempts)
ORDER BY created_at ASC;
```

### Find Active OCR Jobs
```sql
SELECT id, document_number, ocr_worker_id, ocr_started_at, 
       EXTRACT(EPOCH FROM (NOW() - ocr_started_at)) as duration_seconds
FROM extraction_queue
WHERE status_id = 6
ORDER BY ocr_started_at ASC;
```

### Find Stuck OCR Jobs (running > 10 minutes)
```sql
SELECT id, document_number, ocr_worker_id, ocr_started_at,
       EXTRACT(EPOCH FROM (NOW() - ocr_started_at)) as duration_seconds
FROM extraction_queue
WHERE status_id = 6
  AND ocr_started_at < NOW() - INTERVAL '10 minutes'
ORDER BY ocr_started_at ASC;
```

### Find Failed OCR Jobs
```sql
SELECT id, document_number, ocr_attempts, ocr_max_attempts, 
       ocr_error, ocr_last_error_at
FROM extraction_queue
WHERE ocr_attempts >= ocr_max_attempts
  AND file_content IS NULL
ORDER BY ocr_last_error_at DESC;
```

### OCR Performance Statistics
```sql
SELECT 
  COUNT(*) as total_ocr_jobs,
  AVG(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as avg_duration_seconds,
  MIN(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as min_duration_seconds,
  MAX(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as max_duration_seconds,
  AVG(ocr_attempts) as avg_attempts
FROM extraction_queue
WHERE ocr_completed_at IS NOT NULL
  AND ocr_started_at IS NOT NULL;
```

---

## Next Steps

1. **Test the Changes:**
   - Create a test document with `status_id=3` and `document_source='index'`
   - Verify OCR Monitor picks it up and updates tracking fields correctly
   - Test retry logic by simulating OCR failures

2. **Monitor Performance:**
   - Use the monitoring queries above to track OCR job performance
   - Identify any stuck jobs or performance bottlenecks

3. **Apply to Other Environments:**
   - When ready, apply migration `005_add_ocr_tracking.sql` to Staging
   - After validation, apply to Production

4. **Optional Enhancements:**
   - Add dashboard visualization for OCR job tracking
   - Implement automatic stuck job recovery
   - Add alerts for high OCR failure rates

---

## Files Modified

- ✅ `supabase/migrations/005_add_ocr_tracking.sql` (created)
- ✅ `src/types/index.ts` (updated)
- ✅ `src/ocr/monitor.ts` (updated)
- ✅ Database: NotaFlow - Dev (tmidwbceewlgqyfmuboq)

---

## Verification

All changes have been verified:
- ✅ 7 new columns added to `extraction_queue`
- ✅ 1 new status added to `extraction_status`
- ✅ 2 new indexes created
- ✅ Column comments added
- ✅ TypeScript types updated
- ✅ OCR Monitor logic updated
- ✅ No TypeScript compilation errors


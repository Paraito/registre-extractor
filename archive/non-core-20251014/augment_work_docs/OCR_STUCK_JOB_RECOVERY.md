# OCR Stuck Job Recovery System

## Overview

This document describes the automatic recovery system for OCR jobs that get stuck mid-processing. The system ensures that jobs dropped due to crashes, network issues, or other failures are automatically picked up and retried.

## Problem Statement

OCR jobs can get stuck in `status_id = 6` (OCR_PROCESSING) state if:
- The OCR worker crashes during processing
- Network connection is lost while downloading PDFs
- Gemini API times out or fails unexpectedly
- Server is restarted while OCR is in progress

Without automatic recovery, these jobs would remain stuck indefinitely and never complete.

## Solution Components

### 1. Job Completion Tracking ✅

**Location:** `src/ocr/monitor.ts` (lines 293-296)

When an OCR job completes successfully:
```typescript
{
  file_content: rawText,
  boosted_file_content: boostedText,
  status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE, // Status 5
  ocr_completed_at: new Date().toISOString(), // ✅ Completion timestamp
  ocr_error: null,
  updated_at: new Date().toISOString()
}
```

**Fields Updated:**
- `ocr_completed_at` → Set to current timestamp
- `status_id` → Changed from 6 (OCR_PROCESSING) to 5 (EXTRACTION_COMPLETE)
- `ocr_error` → Cleared
- `file_content` → Populated with OCR results
- `boosted_file_content` → Populated with enhanced OCR results

### 2. Automatic Stuck Job Recovery ✅

**Location:** `src/ocr/stale-ocr-monitor.ts`

A background monitor that:
- Runs every **60 seconds** (configurable)
- Checks for jobs stuck in `status_id = 6` for more than **10 minutes** (configurable)
- Automatically resets them to `status_id = 3` (COMPLETE) for retry

**How It Works:**

```typescript
// Find stuck jobs
SELECT * FROM extraction_queue
WHERE status_id = 6 (OCR_PROCESSING)
  AND ocr_started_at < NOW() - INTERVAL '10 minutes'

// Reset them for retry
UPDATE extraction_queue
SET status_id = 3,              -- Back to COMPLETE (ready for OCR)
    ocr_worker_id = NULL,       -- Clear worker assignment
    ocr_error = 'Reset by stale OCR monitor...',
    ocr_last_error_at = NOW(),
    updated_at = NOW()
WHERE status_id = 6
  AND ocr_started_at < NOW() - INTERVAL '10 minutes'
```

**Integration:**

The stale OCR monitor is automatically started/stopped with the main OCR monitor:

```typescript
// src/ocr/monitor.ts
async start(): Promise<void> {
  // ... existing code ...
  
  // Start the stale OCR job monitor
  staleOCRMonitor.start();
  
  // Start the polling loop
  this.poll();
}

async stop(): Promise<void> {
  // ... existing code ...
  
  // Stop the stale OCR job monitor
  staleOCRMonitor.stop();
  
  await this.processor.cleanup();
}
```

### 3. Manual Recovery Script

**Location:** `reset-stuck-ocr-jobs.ts`

For immediate manual intervention:

```bash
# Reset all stuck OCR jobs (stuck > 10 minutes)
npm run reset-stuck-ocr-jobs

# Check status of a specific job
npm run reset-stuck-ocr-jobs -- --job-id <job-id>
```

**Output Example:**
```
🔍 Checking for stuck OCR jobs in all environments...

📊 Checking production environment...
⚠️  Found 2 stuck OCR job(s) in production:
   - Job ID: abc-123
     OCR Worker: ocr-monitor-1
     OCR Started: 2024-01-15T10:30:00Z
     OCR Attempts: 1
     Document: index - 12345678

✅ Reset 2 stuck OCR job(s) in production
   Status changed: OCR_PROCESSING (6) → COMPLETE (3)
   Jobs are now ready for automatic retry by OCR Monitor

============================================================
📊 Summary
============================================================
Total stuck OCR jobs reset: 2

✅ Done!
```

## Configuration

### Stale Job Monitor Settings

**Default Values:**
- Check Interval: `60000ms` (60 seconds)
- Stale Threshold: `600000ms` (10 minutes)

**Custom Configuration:**
```typescript
import { StaleOCRMonitor } from './src/ocr/stale-ocr-monitor';

const customMonitor = new StaleOCRMonitor(
  30000,  // Check every 30 seconds
  300000  // 5 minute threshold
);

customMonitor.start();
```

## Monitoring & Observability

### Logs

The stale OCR monitor provides structured logging:

```
=== Stale OCR Monitor Started ===
  Check Interval: 60s
  Stale Threshold: 10 minutes

⚠️  WARNING: Found 2 stale OCR job(s) in production
  Jobs: [
    { id: 'abc-123', document: '12345678', worker: 'ocr-monitor-1', ... }
  ]

✅ SUCCESS: Reset 2 stale OCR job(s) in production
  Status: Changed from OCR_PROCESSING (6) → COMPLETE (3)
  Ready for: Automatic retry by OCR Monitor

=== Stale OCR Monitor Cycle Complete ===
  Total Reset: 2
  Next Check: 60s
```

### Database Queries

**Find currently stuck OCR jobs:**
```sql
SELECT 
  id, 
  document_number, 
  ocr_worker_id, 
  ocr_started_at,
  EXTRACT(EPOCH FROM (NOW() - ocr_started_at)) / 60 as stuck_minutes,
  ocr_attempts
FROM extraction_queue
WHERE status_id = 6
  AND ocr_started_at < NOW() - INTERVAL '10 minutes'
ORDER BY ocr_started_at ASC;
```

**Find jobs that were auto-recovered:**
```sql
SELECT 
  id, 
  document_number, 
  ocr_error,
  ocr_last_error_at,
  ocr_attempts
FROM extraction_queue
WHERE ocr_error LIKE '%Reset by stale OCR monitor%'
ORDER BY ocr_last_error_at DESC
LIMIT 20;
```

**OCR job statistics:**
```sql
SELECT
  COUNT(*) FILTER (WHERE status_id = 6) as currently_processing,
  COUNT(*) FILTER (WHERE status_id = 5) as completed,
  COUNT(*) FILTER (WHERE ocr_error IS NOT NULL) as failed,
  AVG(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as avg_duration_seconds
FROM extraction_queue
WHERE document_source = 'index'
  AND ocr_started_at IS NOT NULL;
```

## Retry Logic

Jobs are retried automatically with the following logic:

1. **Initial Processing:**
   - Job starts: `status_id = 3` → `status_id = 6`
   - `ocr_attempts` incremented
   - `ocr_started_at` set

2. **Success:**
   - `status_id = 6` → `status_id = 5`
   - `ocr_completed_at` set
   - Job complete ✅

3. **Failure (Stuck):**
   - Stale monitor detects job stuck > 10 minutes
   - `status_id = 6` → `status_id = 3`
   - `ocr_error` set with reason
   - Job eligible for retry

4. **Max Attempts:**
   - Jobs with `ocr_attempts >= ocr_max_attempts` (default: 3) are skipped
   - These require manual intervention

## Testing

### Test Stuck Job Recovery

1. **Create a test job:**
```sql
-- Simulate a stuck OCR job
UPDATE extraction_queue
SET status_id = 6,
    ocr_worker_id = 'test-worker',
    ocr_started_at = NOW() - INTERVAL '15 minutes',
    ocr_attempts = 1
WHERE id = '<test-job-id>';
```

2. **Wait for automatic recovery:**
   - Monitor should detect and reset within 60 seconds
   - Check logs for recovery message

3. **Or manually trigger:**
```bash
npm run reset-stuck-ocr-jobs
```

### Verify Recovery

```sql
-- Check job was reset
SELECT 
  id, 
  status_id,  -- Should be 3 (COMPLETE)
  ocr_error,  -- Should contain "Reset by stale OCR monitor"
  ocr_last_error_at
FROM extraction_queue
WHERE id = '<test-job-id>';
```

## Best Practices

1. **Monitor Logs:** Regularly check for stuck job warnings
2. **Adjust Thresholds:** If jobs legitimately take > 10 minutes, increase threshold
3. **Track Retry Counts:** Jobs with high `ocr_attempts` may indicate systemic issues
4. **Manual Intervention:** For jobs exceeding max attempts, investigate root cause

## Related Files

- `src/ocr/monitor.ts` - Main OCR monitor with completion tracking
- `src/ocr/stale-ocr-monitor.ts` - Automatic stuck job recovery
- `reset-stuck-ocr-jobs.ts` - Manual recovery script
- `src/types/index.ts` - Status constants and types
- `supabase/migrations/005_add_ocr_tracking.sql` - Database schema

## Status Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Extraction Complete                                     │
│ status_id = 3 (COMPLETE)                               │
│ file_content = NULL                                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ OCR Monitor picks up job
                 ▼
┌─────────────────────────────────────────────────────────┐
│ OCR Processing Started                                  │
│ status_id = 6 (OCR_PROCESSING)                         │
│ ocr_started_at = NOW()                                 │
│ ocr_attempts += 1                                       │
└────────┬────────────────────────────────────────────────┘
         │
         ├─────────────────┬──────────────────────────────┐
         │                 │                              │
         │ Success         │ Stuck > 10 min               │ Failure
         ▼                 ▼                              ▼
┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ Complete       │  │ Auto-Reset       │  │ Error                │
│ status_id = 5  │  │ status_id = 3    │  │ status_id = 3        │
│ ocr_completed  │  │ ocr_error set    │  │ ocr_error set        │
│ ✅ DONE        │  │ 🔄 RETRY         │  │ 🔄 RETRY (if < max)  │
└────────────────┘  └──────────────────┘  └──────────────────────┘
```


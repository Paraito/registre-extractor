# OCR Multi-Worker Setup

## Overview

The OCR system now supports running multiple workers in parallel to process documents faster. Workers use database-level locking to prevent race conditions and ensure each document is processed by only one worker at a time.

## Key Features

### 1. **Multiple Workers**
- Default: 2 workers
- Configurable via `OCR_WORKER_COUNT` environment variable
- Each worker has a unique ID for tracking

### 2. **Race Condition Prevention**
- **Atomic Document Claiming**: Workers use database-level atomic updates to claim documents
- **Status-Based Locking**: Only documents with `status_id=3` (COMPLETE) can be claimed
- **Worker ID Tracking**: Each claimed document is tagged with the worker ID that's processing it

### 3. **Error Handling Separation**
- **OCR Errors**: Stored in `ocr_error` field (OCR-specific failures)
- **Extraction Errors**: Stored in `error_message` field (registre extractor failures)
- OCR errors no longer pollute the `error_message` field

## Configuration

### Environment Variables

```bash
# Number of workers to run (default: 2)
OCR_WORKER_COUNT=2

# Optional: Custom worker ID (auto-generated if not provided)
OCR_WORKER_ID=ocr-worker-custom-1

# Other OCR settings remain the same
GEMINI_API_KEY=your-api-key
OCR_POLL_INTERVAL_MS=10000
OCR_TEMP_DIR=/tmp/ocr-processing
```

### Worker ID Generation

If `OCR_WORKER_ID` is not set, workers are automatically assigned IDs:
- Format: `ocr-worker-{index}` (e.g., `ocr-worker-1`, `ocr-worker-2`)
- Each worker gets a unique temp directory: `/tmp/ocr-processing-1`, `/tmp/ocr-processing-2`, etc.

## How It Works

### Document Claiming Flow

1. **Worker polls** for documents with `status_id=3` (COMPLETE)
2. **Worker attempts to claim** a document using atomic update:
   ```sql
   UPDATE extraction_queue
   SET status_id = 4,  -- OCR_PROCESSING
       ocr_worker_id = 'ocr-worker-1',
       ocr_started_at = NOW(),
       ocr_attempts = ocr_attempts + 1
   WHERE id = 'document-id'
     AND status_id = 3  -- Only if still COMPLETE
   ```
3. **If successful**: Worker processes the document
4. **If failed**: Document was already claimed by another worker, try next document

### Race Condition Prevention

The key to preventing race conditions is the **atomic update with status check**:

```typescript
// This update only succeeds if status is still COMPLETE
const { data: updatedDocs } = await client
  .from('extraction_queue')
  .update({
    status_id: EXTRACTION_STATUS.OCR_PROCESSING,
    ocr_worker_id: this.workerId,
    ocr_started_at: new Date().toISOString(),
    ocr_attempts: (document.ocr_attempts || 0) + 1
  })
  .eq('id', document.id)
  .eq('status_id', EXTRACTION_STATUS.COMPLETE) // ← Critical: only if still COMPLETE
  .select();

// If updatedDocs is empty, another worker already claimed it
```

### Processing Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Multiple Workers                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Worker 1              Worker 2              Worker N       │
│     │                     │                     │           │
│     ├─ Poll DB           ├─ Poll DB           ├─ Poll DB   │
│     │                     │                     │           │
│     ├─ Try Claim Doc A   ├─ Try Claim Doc A   ├─ Try Claim │
│     │  ✓ Success!        │  ✗ Already claimed │            │
│     │                     │                     │           │
│     ├─ Process Doc A     ├─ Try Claim Doc B   ├─ Try Claim │
│     │                     │  ✓ Success!        │            │
│     │                     │                     │           │
│     ├─ Update Status     ├─ Process Doc B     ├─ Process   │
│     │                     │                     │           │
│     └─ Poll Again        └─ Update Status     └─ Poll      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Relevant Fields

```sql
-- extraction_queue table
id                  UUID PRIMARY KEY
status_id           INTEGER          -- 3=COMPLETE, 4=OCR_PROCESSING, 5=EXTRACTION_COMPLETE
ocr_worker_id       TEXT             -- Worker ID that claimed the document
ocr_started_at      TIMESTAMP        -- When OCR processing started
ocr_completed_at    TIMESTAMP        -- When OCR processing completed
ocr_attempts        INTEGER          -- Number of OCR attempts
ocr_max_attempts    INTEGER          -- Max attempts before giving up (default: 3)
ocr_error           TEXT             -- OCR-specific errors
ocr_last_error_at   TIMESTAMP        -- Last OCR error timestamp
error_message       TEXT             -- Registre extractor errors (NOT OCR errors)
```

## Running Multiple Workers

### Development

```bash
# Start with default 2 workers
npm run ocr:monitor

# Start with custom worker count
OCR_WORKER_COUNT=4 npm run ocr:monitor

# Start with custom worker ID
OCR_WORKER_ID=my-custom-worker npm run ocr:monitor
```

### Production (Docker)

```yaml
# docker-compose.yml
services:
  ocr-monitor:
    image: your-image
    environment:
      - OCR_WORKER_COUNT=2
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - OCR_POLL_INTERVAL_MS=10000
    deploy:
      replicas: 1  # Run 1 container with 2 workers inside
```

### Production (Systemd)

```bash
# /etc/systemd/system/ocr-monitor.service
[Service]
Environment="OCR_WORKER_COUNT=2"
Environment="GEMINI_API_KEY=your-key"
ExecStart=/usr/bin/node /path/to/dist/ocr/monitor.js
```

## Monitoring

### Worker Activity

Check which workers are active:

```sql
SELECT 
  ocr_worker_id,
  COUNT(*) as active_jobs,
  MIN(ocr_started_at) as oldest_job,
  MAX(ocr_started_at) as newest_job
FROM extraction_queue
WHERE status_id = 4  -- OCR_PROCESSING
GROUP BY ocr_worker_id;
```

### Worker Performance

```sql
SELECT 
  ocr_worker_id,
  COUNT(*) as completed_jobs,
  AVG(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as avg_duration_seconds
FROM extraction_queue
WHERE status_id = 5  -- EXTRACTION_COMPLETE
  AND ocr_completed_at IS NOT NULL
GROUP BY ocr_worker_id
ORDER BY completed_jobs DESC;
```

## Troubleshooting

### Workers Not Processing

1. **Check worker logs** for errors
2. **Verify database connection** for each worker
3. **Check OCR_WORKER_COUNT** is set correctly

### Documents Stuck in OCR_PROCESSING

Use the stale OCR monitor (runs automatically):
- Detects jobs stuck in OCR_PROCESSING for > 10 minutes
- Automatically reverts them to COMPLETE for retry

Or manually reset:

```sql
UPDATE extraction_queue
SET status_id = 3,  -- COMPLETE
    ocr_worker_id = NULL
WHERE status_id = 4  -- OCR_PROCESSING
  AND ocr_started_at < NOW() - INTERVAL '10 minutes';
```

### Race Condition Debugging

If you suspect race conditions:

1. **Check logs** for "Document already claimed by another worker"
2. **Verify atomic updates** are working (should see failed claim attempts)
3. **Monitor database** for duplicate processing (shouldn't happen)

## Benefits

1. **2x Faster Processing**: With 2 workers, process documents twice as fast
2. **No Race Conditions**: Database-level locking ensures safety
3. **Better Resource Utilization**: Multiple workers can use multiple CPU cores
4. **Fault Tolerance**: If one worker crashes, others continue processing
5. **Clean Error Separation**: OCR errors don't interfere with extraction errors

## Migration Notes

### From Single Worker

No migration needed! The system is backward compatible:
- Default `OCR_WORKER_COUNT=2` (can be set to 1 for single worker)
- Existing documents will be processed normally
- Worker ID is automatically assigned if not provided

### Error Message Cleanup

OCR errors are now stored only in `ocr_error`, not `error_message`:
- **Before**: Both `ocr_error` and `error_message` contained OCR errors
- **After**: Only `ocr_error` contains OCR errors, `error_message` is for extraction errors

This prevents confusion when debugging extraction vs OCR issues.


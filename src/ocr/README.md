# OCR Worker System

This OCR worker system processes documents from the `extraction_queue` table using Google Gemini's File API for optical character recognition.

## Overview

The OCR system picks up jobs with `status_id = 3` (COMPLETE - extraction done, ready for OCR) and processes them using Gemini's vision models to extract text content.

### Workflow

1. **Job Pickup**: Workers monitor `extraction_queue` for jobs with:
   - `status_id = 3` (COMPLETE)
   - `supabase_path` is not null (file has been uploaded)
   - `ocr_attempts < ocr_max_attempts` (hasn't exceeded retry limit)

2. **Processing**:
   - Download PDF from Supabase Storage
   - Upload to Gemini File API
   - Send document-specific prompt
   - Wait for OCR response
   - Store result in `file_content` field

3. **Completion**:
   - Success: Set `status_id = 5` (EXTRACTION_COMPLETE)
   - Failure: Increment `ocr_attempts`, log error in `ocr_error`
   - Max attempts reached: Set `status_id = 4` (ERREUR)

## Architecture

```
src/ocr/
├── ocr-worker.ts              # Main worker class
├── gemini-client.ts           # Gemini File API client
├── stale-ocr-job-monitor.ts   # Auto-recovery for stuck jobs
├── start-ocr-workers.ts       # Worker startup script
└── prompts/
    ├── index.txt              # Prompt for index documents
    ├── acte.txt               # Prompt for acte documents
    └── plan_cadastraux.txt    # Prompt for cadastral plans
```

## Environment Configuration

### Required Variables

```bash
# Gemini API Key (required)
GEMINI_API_KEY=your-gemini-api-key-here

# Environment Control (at least one must be true)
OCR_DEV=true          # Enable OCR for dev environment
OCR_STAGING=false     # Enable OCR for staging environment
OCR_PROD=false        # Enable OCR for production environment
```

### Optional Variables

```bash
# Worker Configuration
OCR_WORKER_COUNT=2                    # Number of OCR workers (default: 2)
OCR_WORKER_ID=my-server               # Worker ID prefix (optional)

# Model Configuration
OCR_EXTRACT_MODEL_GEMINI=gemini-2.0-flash-exp  # Gemini model (default)
OCR_EXTRACT_TEMPERATURE=0.0           # Temperature for extraction (default: 0.0)

# Processing Configuration
OCR_TEMP_DIR=/tmp/ocr-processing      # Temp directory for downloads (default)
OCR_POLL_INTERVAL_MS=10000            # Polling interval (default: 10s)
```

## Document-Specific Prompts

The system uses different prompts based on `document_source`:

### Index Documents (`index.txt`)
- Extracts structured data (inscriptions, parties, dates)
- Returns JSON format with page metadata and inscriptions
- Preserves exact text including French accents

### Acte Documents (`acte.txt`)
- Extracts full legal document text
- Returns plain text format
- Maintains original formatting and structure

### Cadastral Plans (`plan_cadastraux.txt`)
- Extracts text and annotations from plans
- Returns organized plain text
- Includes lot numbers, measurements, annotations

## Race Condition Prevention

The system prevents race conditions using atomic database updates:

```typescript
// Claim job atomically
UPDATE extraction_queue
SET status_id = 6,           -- OCR_PROCESSING
    ocr_worker_id = 'worker-123',
    ocr_started_at = NOW()
WHERE id = 'job-id'
  AND status_id = 3          -- Only if still COMPLETE
```

If another worker already claimed the job, the update returns no rows and the worker moves to the next job.

## Retry Logic

- Each job has `ocr_max_attempts` (default: 3)
- On failure:
  - Increment `ocr_attempts`
  - Log error in `ocr_error` field
  - Set `ocr_last_error_at` timestamp
  - If `ocr_attempts < ocr_max_attempts`: Reset to `status_id = 3` for retry
  - If max attempts reached: Set `status_id = 4` (ERREUR)

## Stale Job Recovery

The `StaleOCRJobMonitor` runs every 30 seconds to detect and reset stuck jobs:

- Finds jobs with `status_id = 6` (OCR_PROCESSING)
- Stuck for more than 3 minutes
- Resets them to `status_id = 3` (COMPLETE) for retry
- Logs error message for debugging

## Running the Workers

### Development

```bash
# Start OCR workers in watch mode
npm run ocr:dev
```

### Production

```bash
# Build the project
npm run build

# Start OCR workers
npm run ocr:start

# Or use PM2 (recommended)
pm2 start ecosystem.config.js --only ocr-worker
```

## Monitoring

### Logs

Workers log detailed information:

```
=============================================================
📄 OCR JOB STARTED
=============================================================
   Job ID: abc123...
   Document: index - 1234-567
   Environment: dev
   Worker: ocr-worker-1-xyz
   Attempt: 1/3

🤖 Starting Gemini OCR extraction...
✅ OCR JOB COMPLETED SUCCESSFULLY
   Content Length: 15234 characters
```

### Status Checks

Check worker status in logs (every 5 minutes):

```
=============================================================
📊 OCR WORKER STATUS
=============================================================
   Active workers: 2
   - ocr-worker-1-xyz: Running
   - ocr-worker-2-abc: Running
```

### Database Queries

```sql
-- Check OCR job status
SELECT 
  id,
  document_source,
  document_number,
  status_id,
  ocr_attempts,
  ocr_max_attempts,
  ocr_error
FROM extraction_queue
WHERE status_id IN (3, 6);  -- COMPLETE or OCR_PROCESSING

-- Check failed OCR jobs
SELECT *
FROM extraction_queue
WHERE ocr_error IS NOT NULL
ORDER BY ocr_last_error_at DESC;
```

## Troubleshooting

### Workers not picking up jobs

1. Check environment is enabled:
   ```bash
   echo $OCR_DEV  # Should be 'true'
   ```

2. Check Gemini API key:
   ```bash
   echo $GEMINI_API_KEY  # Should be set
   ```

3. Check job status in database:
   ```sql
   SELECT status_id, supabase_path, ocr_attempts 
   FROM extraction_queue 
   WHERE id = 'your-job-id';
   ```

### OCR extraction failing

1. Check Gemini API quota/limits
2. Review `ocr_error` field in database
3. Check worker logs for detailed error messages
4. Verify PDF file exists in Supabase Storage

### Jobs stuck in OCR_PROCESSING

The stale job monitor should auto-recover these, but you can manually reset:

```sql
UPDATE extraction_queue
SET status_id = 3,
    ocr_worker_id = NULL,
    ocr_started_at = NULL
WHERE status_id = 6
  AND ocr_started_at < NOW() - INTERVAL '5 minutes';
```

## Performance

- **Throughput**: ~10-20 documents per minute per worker (depends on document size)
- **Gemini API**: Rate limits apply (check Google Cloud quotas)
- **Memory**: ~512MB per worker process
- **Temp Storage**: ~50MB per active job (cleaned up after processing)

## Security

- API keys stored in environment variables (never in code)
- Service role keys used for Supabase access
- Temp files cleaned up after processing
- No sensitive data logged

## Future Enhancements

- [ ] Support for Claude API as fallback
- [ ] Parallel page processing for large documents
- [ ] OCR quality scoring
- [ ] Automatic retry with different models on failure
- [ ] Batch processing optimization


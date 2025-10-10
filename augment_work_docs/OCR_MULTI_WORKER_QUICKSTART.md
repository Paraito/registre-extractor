# OCR Multi-Worker Quick Start

## TL;DR

✅ **OCR system now supports 2 workers by default**  
✅ **No race conditions - database-level atomic locking**  
✅ **OCR errors separated from extraction errors**  
✅ **Fully backward compatible**

## Quick Start

### 1. Run with Default Settings (2 Workers)

```bash
npm run ocr:monitor
```

That's it! The system will start 2 workers automatically.

### 2. Customize Worker Count

```bash
# Run with 4 workers
OCR_WORKER_COUNT=4 npm run ocr:monitor

# Run with single worker (backward compatibility)
OCR_WORKER_COUNT=1 npm run ocr:monitor
```

### 3. Environment Variables

Add to your `.env` file:

```bash
# Required
GEMINI_API_KEY=your-api-key

# Optional - defaults shown
OCR_WORKER_COUNT=2              # Number of workers
OCR_POLL_INTERVAL_MS=10000      # Poll every 10 seconds
OCR_TEMP_DIR=/tmp/ocr-processing
```

## What Changed?

### ✅ Multi-Worker Support

**Before:**
- Single worker processed documents sequentially
- Slower processing

**After:**
- Multiple workers process documents in parallel
- 2x faster with 2 workers (default)
- Scalable to N workers

### ✅ Race Condition Prevention

**Before:**
- Not applicable (single worker)

**After:**
- Database-level atomic locking
- Workers claim documents atomically
- No duplicate processing possible

**How it works:**
```typescript
// Only succeeds if document is still in COMPLETE status
UPDATE extraction_queue
SET status_id = 4, ocr_worker_id = 'worker-1'
WHERE id = 'doc-id' AND status_id = 3
```

If another worker already claimed it, this returns 0 rows and the worker tries the next document.

### ✅ Error Message Separation

**Before:**
- OCR errors written to both `ocr_error` AND `error_message`
- Confusing when debugging

**After:**
- OCR errors → `ocr_error` field only
- Extraction errors → `error_message` field only
- Clear separation of concerns

## Monitoring

### Check Active Workers

```sql
SELECT 
  ocr_worker_id,
  COUNT(*) as active_jobs,
  MIN(ocr_started_at) as oldest_job
FROM extraction_queue
WHERE status_id = 4  -- OCR_PROCESSING
GROUP BY ocr_worker_id;
```

### Check Worker Performance

```sql
SELECT 
  ocr_worker_id,
  COUNT(*) as completed_jobs,
  AVG(EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at))) as avg_seconds
FROM extraction_queue
WHERE status_id = 5  -- EXTRACTION_COMPLETE
  AND ocr_completed_at IS NOT NULL
GROUP BY ocr_worker_id
ORDER BY completed_jobs DESC;
```

### Check for Errors

```sql
-- OCR errors only
SELECT document_number, ocr_error, ocr_last_error_at
FROM extraction_queue
WHERE ocr_error IS NOT NULL
ORDER BY ocr_last_error_at DESC
LIMIT 10;

-- Extraction errors only
SELECT document_number, error_message, updated_at
FROM extraction_queue
WHERE error_message IS NOT NULL
  AND ocr_error IS NULL  -- Exclude OCR errors
ORDER BY updated_at DESC
LIMIT 10;
```

## Logs

### Worker Startup

```
=== OCR Monitor Configuration ===
  Workers: 2
  Poll Interval: 10000ms
  Temp Dir: /tmp/ocr-processing
==================================

Worker ocr-worker-1 initialized
Worker ocr-worker-2 initialized

=== OCR Monitor Started ===
  Enabled Environments: prod, staging, dev
===========================
```

### Document Processing

```
=== OCR Processing Started ===
  Document: 12345-67
  Environment: prod
  Worker: ocr-worker-1
  ID: abc-123-def
================================

Document claimed by worker
  documentId: abc-123-def
  workerId: ocr-worker-1

📄 Converting PDF (5 pages)...
✅ PDF converted (5 pages, 2.3 MB)

🔍 Extracting text from pages...
  ✓ Page 1/5 extracted (1,234 chars)
  ✓ Page 2/5 extracted (1,456 chars)
  ✓ Page 3/5 extracted (1,123 chars)
  ✓ Page 4/5 extracted (1,345 chars)
  ✓ Page 5/5 extracted (1,234 chars)
✅ Extraction complete (6,392 chars)

🚀 Applying boost corrections...
✅ Boost complete (6,401 chars, 3.2s)

=== OCR Processing Complete ===
  Document: 12345-67
  Pages: 5
  Raw Text: 6,392 chars
  Boosted Text: 6,401 chars
  Duration: 8.5s
================================
```

### Race Condition Handling

```
Document already claimed by another worker
  documentId: xyz-789-abc
  environment: prod

Trying next document...

Document claimed by worker
  documentId: def-456-ghi
  workerId: ocr-worker-2
```

## Troubleshooting

### Workers Not Starting

**Check logs for:**
```
Failed to start OCR worker
  error: "GEMINI_API_KEY is required"
```

**Solution:**
```bash
export GEMINI_API_KEY=your-api-key
npm run ocr:monitor
```

### Documents Stuck in OCR_PROCESSING

**Automatic recovery:**
- Stale OCR monitor runs every 5 minutes
- Resets jobs stuck > 10 minutes
- Workers can retry them

**Manual reset:**
```sql
UPDATE extraction_queue
SET status_id = 3, ocr_worker_id = NULL
WHERE status_id = 4
  AND ocr_started_at < NOW() - INTERVAL '10 minutes';
```

### All Workers Idle

**Check if documents are available:**
```sql
SELECT COUNT(*) as pending_ocr
FROM extraction_queue
WHERE status_id = 3  -- COMPLETE
  AND document_source IN ('index', 'acte')
  AND (ocr_attempts < ocr_max_attempts OR ocr_attempts IS NULL);
```

If count is 0, no documents need OCR.

## Performance Tips

### Optimal Worker Count

**Rule of thumb:**
- 1 worker per CPU core
- Max 4 workers per server (Gemini API rate limits)

**Examples:**
- 2-core server: `OCR_WORKER_COUNT=2`
- 4-core server: `OCR_WORKER_COUNT=4`
- 8-core server: `OCR_WORKER_COUNT=4` (API limited)

### Scaling Horizontally

For very high throughput, run multiple containers:

```yaml
# docker-compose.yml
services:
  ocr-monitor-1:
    environment:
      - OCR_WORKER_COUNT=2
      - OCR_WORKER_ID=container-1-worker
  
  ocr-monitor-2:
    environment:
      - OCR_WORKER_COUNT=2
      - OCR_WORKER_ID=container-2-worker
```

This gives you 4 total workers across 2 containers.

## Testing

### Verify Multi-Worker Operation

1. **Start workers:**
   ```bash
   OCR_WORKER_COUNT=2 npm run ocr:monitor
   ```

2. **Add test documents:**
   ```bash
   npm run create-test-job-index
   npm run create-test-job-index
   npm run create-test-job-index
   ```

3. **Watch logs:**
   - Should see both workers claiming documents
   - No duplicate processing
   - Documents processed in parallel

4. **Check database:**
   ```sql
   SELECT ocr_worker_id, COUNT(*)
   FROM extraction_queue
   WHERE status_id = 5
   GROUP BY ocr_worker_id;
   ```
   
   Should see documents distributed across workers.

## Migration from Single Worker

**No migration needed!**

The system is fully backward compatible:
- Default worker count is 2 (can be set to 1)
- Existing documents process normally
- No database changes required
- No code changes in other parts of the system

Just update your environment variables and restart:

```bash
# .env
OCR_WORKER_COUNT=2  # Add this line

# Restart
npm run ocr:monitor
```

## Summary

| Feature | Before | After |
|---------|--------|-------|
| Workers | 1 | 2 (configurable) |
| Speed | 1x | 2x (with 2 workers) |
| Race Conditions | N/A | Prevented (atomic locking) |
| Error Fields | Mixed | Separated (ocr_error vs error_message) |
| Monitoring | Basic | Per-worker tracking |
| Scalability | Limited | Horizontal + vertical |

## Next Steps

1. ✅ Start with default 2 workers
2. ✅ Monitor performance and logs
3. ✅ Adjust worker count based on throughput needs
4. ✅ Consider horizontal scaling if needed

## Documentation

- **Full Setup Guide**: `OCR_MULTI_WORKER_SETUP.md`
- **Change Summary**: `OCR_MULTI_WORKER_CHANGES.md`
- **Flow Diagrams**: `OCR_MULTI_WORKER_FLOW.md`
- **This Guide**: `OCR_MULTI_WORKER_QUICKSTART.md`


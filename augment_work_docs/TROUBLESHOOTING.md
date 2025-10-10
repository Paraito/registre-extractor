# Troubleshooting Guide

## Jobs Stuck in "En traitement" (Status ID = 2)

### Problem Description

Jobs get stuck in `status_id = 2` (EN_TRAITEMENT) and never complete or fail. The same worker keeps picking them up but doesn't process them properly.

### Root Causes

1. **Unhandled Exceptions in Processing Loop**: If an error occurs in `processJob()` that isn't properly caught, the job remains in status 2 because only the `isProcessing` flag is reset, not the database status.

2. **Worker Crashes**: If a worker process crashes or is killed, jobs it was processing remain stuck until the stale job detection runs (5 minutes).

3. **Extractor Initialization Failures**: If the browser/extractor fails to initialize, jobs are claimed but can't be processed.

4. **Timeout Issues**: Jobs can hang indefinitely waiting for documents to load or network operations to complete.

5. **Redis Connection Issues**: While Redis is configured for Bull queues, workers query the database directly, making Redis a potential point of failure without providing value.

### Immediate Fix

Run the reset script to immediately fix stuck jobs:

```bash
npm run reset-stuck-jobs
```

This will:
- Find all jobs stuck in "En traitement" for more than 5 minutes
- Reset them to "En attente" status
- Clear the worker assignment
- Allow them to be picked up again

### Long-term Solutions Implemented

#### 1. Enhanced Error Handling in Processing Loop

The `processContinuously()` method now:
- Tracks the current job being processed
- Catches all errors and resets the job status if an error occurs
- Prevents jobs from getting stuck even if unexpected errors happen

#### 2. Job Processing Timeout

Added a 5-minute timeout to `processJob()`:
- If a job takes longer than 5 minutes, it will be automatically failed
- Prevents jobs from hanging indefinitely
- Timeout is configurable via `EXTRACTION_TIMEOUT` environment variable

#### 3. Stale Job Monitor

A background monitor runs every minute to:
- Check for jobs stuck in processing for more than 5 minutes
- Automatically reset them to "En attente"
- Log warnings about stuck jobs
- Provide a safety net if workers crash

#### 4. Better Logging

Enhanced logging to track:
- When jobs are claimed
- Processing progress
- Errors and their context
- Job resets and why they occurred

### Diagnostic Tools

#### System Diagnostic

Run a comprehensive system check:

```bash
npm run diagnose
```

This will show:
- Worker status (alive/dead, heartbeat, jobs completed/failed)
- Job queue status (counts by status)
- Stale jobs (if any)
- Redis connection status
- Specific job details

#### Redis Health Check

Check if Redis is working properly:

```bash
npm run check-redis
```

This will:
- Test Redis connectivity
- Show server info and memory usage
- List Bull queue keys
- Show active/waiting jobs in queues

### Prevention Best Practices

1. **Monitor Worker Health**: Check worker heartbeats regularly
   ```bash
   npm run diagnose
   ```

2. **Set Up Alerts**: Monitor for:
   - Jobs stuck in "En traitement" for > 5 minutes
   - Workers with no heartbeat for > 2 minutes
   - High error rates

3. **Regular Cleanup**: Run the stale job monitor (now automatic)

4. **Resource Limits**: Ensure workers have enough:
   - Memory (browser instances are memory-intensive)
   - CPU (for document processing)
   - Network bandwidth (for uploads)

5. **Graceful Shutdown**: Always stop workers gracefully:
   ```bash
   # Send SIGTERM, not SIGKILL
   kill -TERM <worker-pid>
   ```

### Common Issues and Solutions

#### Issue: Jobs stuck with same worker ID

**Cause**: Worker crashed or was killed while processing

**Solution**:
```bash
npm run reset-stuck-jobs
```

#### Issue: Worker keeps picking up jobs but not processing

**Cause**: Extractor initialization failure or browser crash

**Solution**:
1. Check worker logs for errors
2. Restart the worker
3. Check browser/Playwright installation:
   ```bash
   npx playwright install chromium
   ```

#### Issue: Redis connection errors

**Cause**: Redis server not running or misconfigured

**Solution**:
1. Check Redis status:
   ```bash
   npm run check-redis
   ```
2. Start Redis if needed:
   ```bash
   # macOS
   brew services start redis
   
   # Linux
   sudo systemctl start redis
   
   # Docker
   docker run -d -p 6379:6379 redis
   ```

#### Issue: Jobs timeout after 5 minutes

**Cause**: Document extraction taking too long

**Solution**:
1. Check if the registry website is slow
2. Increase timeout in `.env`:
   ```
   EXTRACTION_TIMEOUT=600000  # 10 minutes
   ```
3. Check network connectivity

### Environment Variables

Key configuration options:

```env
# Worker Configuration
WORKER_CONCURRENCY=20          # Max concurrent jobs per worker
EXTRACTION_TIMEOUT=300000      # Job timeout (5 minutes)
SESSION_TIMEOUT=240000         # Browser session timeout (4 minutes)

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                # Optional

# Logging
LOG_LEVEL=info                 # error, warn, info, debug
```

### Monitoring Queries

Useful SQL queries for monitoring:

```sql
-- Find stuck jobs
SELECT id, worker_id, processing_started_at, document_source, document_number
FROM extraction_queue
WHERE status_id = 2
  AND processing_started_at < NOW() - INTERVAL '5 minutes';

-- Worker activity
SELECT worker_id, status, last_heartbeat, jobs_completed, jobs_failed
FROM worker_status
WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'
ORDER BY last_heartbeat DESC;

-- Job statistics
SELECT 
  status_id,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (COALESCE(updated_at, NOW()) - created_at))) as avg_duration_seconds
FROM extraction_queue
GROUP BY status_id;
```

### Getting Help

If issues persist:

1. Run full diagnostic:
   ```bash
   npm run diagnose
   ```

2. Check logs for errors:
   ```bash
   # Worker logs
   tail -f logs/worker-*.log
   
   # Or if using Docker
   docker-compose logs -f worker
   ```

3. Collect information:
   - Worker IDs and status
   - Stuck job IDs
   - Error messages from logs
   - Redis status
   - System resources (CPU, memory, disk)

4. Create an issue with:
   - Diagnostic output
   - Relevant log excerpts
   - Steps to reproduce
   - Environment details


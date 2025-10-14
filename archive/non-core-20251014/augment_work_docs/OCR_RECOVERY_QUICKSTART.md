# OCR Job Recovery - Quick Start Guide

## 🎯 What Was Implemented

Your OCR extractor now has **automatic recovery** for jobs that get stuck mid-processing!

### ✅ Requirements Completed

1. **`ocr_completed_at` is updated** when OCR jobs complete successfully ✅
2. **Stuck jobs are automatically reset** from `status_id = 6` → `status_id = 3` for retry ✅

## 🚀 How to Use

### Automatic Recovery (No Action Needed!)

The stale OCR monitor runs automatically when you start the OCR monitor:

```bash
# Development
npm run ocr:dev

# Production
npm run ocr
```

**What happens automatically:**
- Every 60 seconds, checks for jobs stuck in OCR processing
- Jobs stuck > 10 minutes are automatically reset
- Reset jobs are picked up again by the OCR monitor
- Respects max retry limits (default: 3 attempts)

### Manual Recovery (When Needed)

If you need to immediately reset stuck OCR jobs:

```bash
# Reset all stuck OCR jobs (stuck > 10 minutes)
npm run reset-stuck-ocr-jobs

# Check status of a specific job
npm run reset-stuck-ocr-jobs -- --job-id abc-123-def-456
```

**Example Output:**
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

## 🧪 Testing

Verify the recovery system works:

```bash
npm run test:ocr-recovery
```

This will:
1. Find or create a test job
2. Simulate it getting stuck in OCR processing
3. Run the stale OCR monitor
4. Verify the job was reset correctly
5. Clean up

## 📊 Monitoring

### Check for Currently Stuck Jobs

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

### Check Auto-Recovered Jobs

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

### OCR Job Statistics

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

## 🔧 Configuration

### Default Settings

- **Check Interval:** 60 seconds
- **Stale Threshold:** 10 minutes
- **Max Attempts:** 3 (from database `ocr_max_attempts`)

### Custom Configuration

If you need different settings, edit `src/ocr/stale-ocr-monitor.ts`:

```typescript
export const staleOCRMonitor = new StaleOCRMonitor(
  30000,  // Check every 30 seconds (instead of 60)
  300000  // 5 minute threshold (instead of 10)
);
```

## 📝 Logs

The stale OCR monitor provides structured logging:

```json
{
  "level": "info",
  "msg": "Stale OCR job monitor started",
  "checkIntervalMs": 60000,
  "staleThresholdMs": 600000,
  "checkIntervalSeconds": 60,
  "staleThresholdMinutes": 10
}

{
  "level": "warn",
  "msg": "Found 2 stale OCR job(s)",
  "environment": "production",
  "count": 2,
  "jobs": [
    {
      "id": "abc-123",
      "document": "12345678",
      "worker": "ocr-monitor-1",
      "started": "2024-01-15T10:30:00Z",
      "attempts": 1
    }
  ]
}

{
  "level": "info",
  "msg": "Reset 2 stale OCR job(s)",
  "environment": "production",
  "count": 2,
  "statusChange": "OCR_PROCESSING (6) → COMPLETE (3)",
  "readyFor": "Automatic retry by OCR Monitor"
}
```

## 🎯 Status Flow

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

## 📚 Documentation

- **`augment_work_docs/OCR_STUCK_JOB_RECOVERY.md`** - Detailed technical documentation
- **`IMPLEMENTATION_SUMMARY.md`** - Implementation overview
- **`src/ocr/README.md`** - OCR module overview

## 🎉 Benefits

1. **Reliability:** Jobs never get permanently stuck
2. **Resilience:** Automatic recovery from crashes and failures
3. **Zero Maintenance:** No manual intervention needed
4. **Visibility:** Clear logging of stuck jobs and recoveries
5. **Testable:** Automated tests ensure it works correctly

## ⚠️ Important Notes

1. **Jobs respect max attempts:** Jobs that exceed `ocr_max_attempts` (default: 3) won't be retried automatically
2. **Threshold is configurable:** If your OCR jobs legitimately take > 10 minutes, increase the threshold
3. **Monitor logs:** Check logs regularly for patterns of stuck jobs (may indicate systemic issues)
4. **Manual intervention:** For jobs exceeding max attempts, investigate root cause before manually resetting

## 🆘 Troubleshooting

### Jobs Keep Getting Stuck

If you see many jobs getting stuck:

1. **Check OCR worker logs** for errors
2. **Verify Gemini API** is responding
3. **Check network connectivity** to Supabase storage
4. **Increase stale threshold** if jobs legitimately take longer

### Jobs Not Being Picked Up

If reset jobs aren't being picked up:

1. **Verify OCR monitor is running:** `npm run ocr:dev`
2. **Check OCR is enabled** for the environment in config
3. **Verify job meets criteria:** `status_id = 3`, `document_source = 'index'`, `file_content IS NULL`
4. **Check retry limits:** `ocr_attempts < ocr_max_attempts`

### Need Immediate Reset

```bash
# Reset all stuck jobs immediately
npm run reset-stuck-ocr-jobs

# Or check specific job
npm run reset-stuck-ocr-jobs -- --job-id <job-id>
```

## 📞 Support

For issues or questions:
1. Check logs in the OCR monitor output
2. Run the test: `npm run test:ocr-recovery`
3. Review documentation in `augment_work_docs/OCR_STUCK_JOB_RECOVERY.md`
4. Check database with monitoring queries above

---

**That's it!** Your OCR extractor now has automatic recovery for stuck jobs. No configuration needed - just start the OCR monitor and it works! 🎉


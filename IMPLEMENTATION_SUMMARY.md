# OCR Stuck Job Recovery - Implementation Summary

## ✅ Requirements Completed

### 1. ✅ Ensure `ocr_completed_at` is updated when job completes

**Status:** Already implemented in `src/ocr/monitor.ts` (line 293)

When an OCR job completes successfully, the following fields are updated:
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

### 2. ✅ Automatic pickup for stuck OCR jobs

**Status:** Newly implemented

Created automatic recovery system that resets jobs stuck in `status_id = 6` (OCR_PROCESSING) back to `status_id = 3` (COMPLETE) for retry.

## 📁 Files Created

### 1. `src/ocr/stale-ocr-monitor.ts` (NEW)
- Background monitor that checks for stuck OCR jobs every 60 seconds
- Resets jobs stuck in OCR processing for more than 10 minutes
- Automatically started/stopped with the main OCR monitor
- Provides structured logging with OCRLogger

**Key Features:**
- Configurable check interval (default: 60s)
- Configurable stale threshold (default: 10 minutes)
- Runs across all configured Supabase environments
- Singleton instance exported for easy use

### 2. `reset-stuck-ocr-jobs.ts` (NEW)
- Manual script to immediately reset stuck OCR jobs
- Can reset all stuck jobs or check specific job by ID
- Provides detailed output with job information

**Usage:**
```bash
# Reset all stuck OCR jobs
npm run reset-stuck-ocr-jobs

# Check specific job
npm run reset-stuck-ocr-jobs -- --job-id <job-id>
```

### 3. `test-ocr-recovery.ts` (NEW)
- Automated test to verify the recovery system works
- Simulates a stuck OCR job and verifies it gets reset
- Cleans up after itself

**Usage:**
```bash
npm run test:ocr-recovery
```

### 4. `augment_work_docs/OCR_STUCK_JOB_RECOVERY.md` (NEW)
- Comprehensive documentation of the recovery system
- Includes monitoring queries, configuration, and best practices
- Status flow diagram showing the complete lifecycle

## 📝 Files Modified

### 1. `src/ocr/monitor.ts`
**Changes:**
- Added import for `staleOCRMonitor`
- Start stale OCR monitor when OCR monitor starts
- Stop stale OCR monitor when OCR monitor stops

**Lines Modified:**
- Line 6: Added import
- Line 64: Start stale monitor
- Line 82: Stop stale monitor

### 2. `src/ocr/index.ts`
**Changes:**
- Export `StaleOCRMonitor` class and `staleOCRMonitor` singleton

**Lines Modified:**
- Line 12: Added export

### 3. `package.json`
**Changes:**
- Added `reset-stuck-ocr-jobs` script
- Added `test:ocr-recovery` script

**Lines Modified:**
- Line 28: Added reset script
- Line 31: Added test script

## 🔄 How It Works

### Normal Flow (Success)
```
status_id = 3 (COMPLETE)
    ↓ OCR Monitor picks up
status_id = 6 (OCR_PROCESSING)
    ↓ OCR completes successfully
status_id = 5 (EXTRACTION_COMPLETE)
    ✅ ocr_completed_at = NOW()
```

### Recovery Flow (Stuck Job)
```
status_id = 6 (OCR_PROCESSING)
    ↓ Stuck for > 10 minutes
Stale OCR Monitor detects
    ↓ Automatic reset
status_id = 3 (COMPLETE)
    ↓ OCR Monitor picks up again
status_id = 6 (OCR_PROCESSING)
    ↓ Retry...
```

## 🎯 Key Features

1. **Automatic Recovery:** No manual intervention needed for stuck jobs
2. **Configurable Thresholds:** Adjust timing based on your needs
3. **Multi-Environment:** Works across all configured Supabase environments
4. **Retry Limits:** Respects `ocr_max_attempts` to prevent infinite loops
5. **Detailed Logging:** Structured logs with OCRLogger for easy monitoring
6. **Manual Override:** Script available for immediate intervention
7. **Testable:** Automated test to verify functionality

## 📊 Monitoring

### Check for Currently Stuck Jobs
```sql
SELECT 
  id, 
  document_number, 
  ocr_worker_id, 
  ocr_started_at,
  EXTRACT(EPOCH FROM (NOW() - ocr_started_at)) / 60 as stuck_minutes
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

## 🧪 Testing

Run the automated test:
```bash
npm run test:ocr-recovery
```

Expected output:
```
🧪 Testing OCR Stuck Job Recovery System
============================================================
📊 Using environment: production

Step 1: Finding a test job...
✅ Found test job: abc-123

Step 2: Simulating stuck OCR job...
✅ Job simulated as stuck

Step 3: Running stale OCR monitor...
✅ Stale OCR monitor completed

Step 4: Verifying job was reset...
✅ SUCCESS: Job was correctly reset!

Step 5: Cleaning up...
✅ Restored job to original state

============================================================
✅ TEST PASSED
============================================================
```

## 🚀 Deployment

The stale OCR monitor is automatically integrated with the OCR monitor:

```bash
# Development
npm run ocr:dev

# Production
npm run ocr
```

No additional configuration or deployment steps required!

## 📈 Benefits

1. **Reliability:** Jobs never get permanently stuck
2. **Resilience:** Automatic recovery from crashes and failures
3. **Visibility:** Clear logging of stuck jobs and recoveries
4. **Maintainability:** Easy to monitor and debug
5. **Testability:** Automated tests ensure it works correctly

## 🔧 Configuration Options

### Default Settings
- **Check Interval:** 60 seconds
- **Stale Threshold:** 10 minutes
- **Max Attempts:** 3 (from database `ocr_max_attempts`)

### Custom Configuration
```typescript
import { StaleOCRMonitor } from './src/ocr/stale-ocr-monitor';

const customMonitor = new StaleOCRMonitor(
  30000,  // Check every 30 seconds
  300000  // 5 minute threshold
);

customMonitor.start();
```

## 📚 Related Documentation

- `augment_work_docs/OCR_STUCK_JOB_RECOVERY.md` - Detailed documentation
- `augment_work_docs/OCR_TRACKING_ENHANCEMENT.md` - OCR tracking fields
- `src/ocr/README.md` - OCR module overview

## ✅ Checklist

- [x] `ocr_completed_at` updated on job completion
- [x] Automatic stuck job detection
- [x] Automatic reset to `status_id = 3`
- [x] Integrated with OCR monitor lifecycle
- [x] Manual recovery script
- [x] Automated test
- [x] Comprehensive documentation
- [x] Structured logging
- [x] Multi-environment support
- [x] Respects retry limits

## 🎉 Summary

Both requirements have been fully implemented:

1. ✅ **`ocr_completed_at` is updated** when jobs complete (already existed)
2. ✅ **Stuck jobs are automatically picked up** and reset to `status_id = 3` for retry

The system is production-ready and will automatically recover from OCR job failures!


# Pre-Deployment Analysis & Critical Fixes

## 🔍 Current State Analysis

### System Status (Local Docker)
- ✅ All containers running successfully
- ✅ Workers registering and starting properly
- ⚠️ **CRITICAL ISSUE**: Workers being marked as "dead" every 30 seconds by health monitor
- ⚠️ 1 error job persisting in dev environment

### Root Cause Identified

**The "Dead Workers" Problem:**

The health monitor is incorrectly marking workers as dead because of a **database environment mismatch**:

1. **Workers register in DEFAULT Supabase environment** (line 188-202 in `src/worker/index.ts`):
   ```typescript
   private async registerWorker(): Promise<void> {
     const { error } = await supabase  // ← Uses DEFAULT client
       .from('worker_status')
       .upsert({...})
   }
   ```

2. **Health monitor checks ALL environments** (line 151-159 in `src/monitor/health-monitor.ts`):
   ```typescript
   for (const env of environments) {  // ← Checks prod, staging, dev
     const client = supabaseManager.getServiceClient(env);
     const { data: deadWorkers } = await client
       .from('worker_status')
       .select('worker_id, last_heartbeat, current_job_id')
       .lt('last_heartbeat', deadThreshold);
   }
   ```

3. **Result**: Workers register in one environment (e.g., prod) but monitor checks all environments. When it checks staging/dev, it finds "old" worker records with stale heartbeats and marks them as dead.

---

## 🐛 Critical Issues to Fix Before Deployment

### Issue #1: Worker Registration Environment Mismatch ⚠️ **CRITICAL**

**Problem**: Workers register in default environment but health monitor checks all environments

**Impact**: 
- Workers constantly marked as "dead" 
- Unnecessary database churn
- Confusing logs
- Potential job release issues

**Fix Required**: Ensure workers register in ALL environments they monitor, OR health monitor only checks the default environment for worker status

**Recommendation**: Workers should register in the default/primary environment only, and health monitor should check only that environment for worker_status table.

---

### Issue #2: Heartbeat Interval Mismatch ⚠️ **MEDIUM**

**Problem**: Different heartbeat intervals across worker types

- **Extraction Workers** (`src/worker/index.ts` line 219): Every **10 seconds**
- **Unified Workers** (`src/worker/unified-worker.ts` line 198): Every **30 seconds**  
- **OCR Workers** (`src/ocr/ocr-worker.ts` line 160): Every **30 seconds** (debug only)
- **Health Monitor Dead Threshold** (`src/monitor/health-monitor.ts` line 25): **2 minutes**

**Impact**: 
- Inconsistent worker health detection
- OCR workers might be marked dead faster than extraction workers
- Confusion in monitoring

**Fix Required**: Standardize heartbeat intervals across all worker types

**Recommendation**: 
- All workers: 30-second heartbeat
- Health monitor: 3-minute dead threshold (6 missed heartbeats)

---

### Issue #3: Worker ID Format Inconsistency ⚠️ **LOW**

**Problem**: Different worker ID formats

- Container workers: `worker-1-1`, `worker-1-2`, `worker-1-3` (from WORKER_ID env var)
- Standalone workers: `worker-1-<uuid>` (random UUID)
- Unified workers: `unified-worker-<uuid>`
- OCR workers: `OCR-1`, `OCR-2`, etc.

**Impact**: 
- Harder to track workers in logs
- Potential ID collisions in multi-server deployments

**Fix Required**: Standardize worker ID format

**Recommendation**: Use format: `{type}-{container}-{instance}` (e.g., `extraction-worker-1-1`, `ocr-worker-1-1`)

---

### Issue #4: Missing Error Handling in Heartbeat ⚠️ **MEDIUM**

**Problem**: Heartbeat failures are logged but don't trigger any recovery

**Current Code** (`src/worker/index.ts` line 216-218):
```typescript
} catch (error) {
  logger.error({ error, workerId: this.workerId }, 'Heartbeat failed');
}
```

**Impact**: 
- Workers can silently fail to update heartbeat
- Database connection issues not detected
- Workers marked as dead even though they're running

**Fix Required**: Add heartbeat failure counter and auto-restart logic

---

### Issue #5: Playwright Browser Path in Docker ⚠️ **LOW**

**Status**: Already fixed in Dockerfile (lines 56-67)

The Dockerfile correctly:
1. Installs Playwright as root
2. Sets `PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright`
3. Copies browsers to app directory
4. Sets proper permissions
5. Verifies installation before starting

✅ **No action needed**

---

## ✅ Previously Fixed Issues (Verified)

### 1. Timeout Errors - FIXED ✅
- Increased from 10s to 30s in all locations
- Verified in `src/worker/extractor-ai.ts` (28 occurrences)
- Verified in `src/worker/extractor-index-fallback.ts`

### 2. File Deletion Errors - FIXED ✅
- Added ENOENT error handling
- Verified in `src/ocr/ocr-worker.ts` (line 387-394)
- Verified in `src/worker/index.ts` (line 515-522)

### 3. Playwright Installation - FIXED ✅
- Dockerfile installs with `--with-deps`
- Proper permission handling
- Verification step included

---

## 🔧 Required Fixes Before Push

### Fix #1: Worker Registration Environment (CRITICAL)

**File**: `src/monitor/health-monitor.ts`

**Change**: Only check default environment for worker_status

```typescript
// Line 145-212
private async cleanupDeadWorkers(): Promise<void> {
  try {
    // ONLY check default environment for worker status
    // Workers register in default env, so we should only check there
    const deadThreshold = new Date(Date.now() - this.deadWorkerThresholdMs).toISOString();
    let totalCleaned = 0;

    // Use default supabase client instead of iterating all environments
    const { data: deadWorkers, error: queryError } = await supabase
      .from('worker_status')
      .select('worker_id, last_heartbeat, current_job_id')
      .lt('last_heartbeat', deadThreshold);

    if (queryError) {
      logger.error({ error: queryError }, 'Error querying dead workers');
      return;
    }

    if (!deadWorkers || deadWorkers.length === 0) {
      return;
    }

    // Release any jobs held by dead workers (check ALL environments for jobs)
    const environments = supabaseManager.getAvailableEnvironments();
    for (const worker of deadWorkers) {
      if (worker.current_job_id) {
        // Find which environment has this job
        for (const env of environments) {
          const client = supabaseManager.getServiceClient(env);
          if (!client) continue;

          await client
            .from('extraction_queue')
            .update({
              status_id: EXTRACTION_STATUS.EN_ATTENTE,
              worker_id: null,
              processing_started_at: null,
              error_message: `Released by health monitor - worker ${worker.worker_id} is dead`
            })
            .eq('id', worker.current_job_id)
            .eq('worker_id', worker.worker_id);
        }
      }
    }

    // Mark workers as offline in default environment
    const { error: updateError } = await supabase
      .from('worker_status')
      .update({ status: 'offline' })
      .lt('last_heartbeat', deadThreshold);

    if (updateError) {
      logger.error({ error: updateError }, 'Error updating dead workers');
      return;
    }

    totalCleaned = deadWorkers.length;
    
    if (totalCleaned > 0) {
      logger.warn({ 
        count: totalCleaned,
        workers: deadWorkers.map(w => w.worker_id.substring(0, 8))
      }, '💀 Cleaned up dead workers');
      
      logger.info({ totalCleaned }, '✅ Dead workers cleanup completed');
    }
  } catch (error) {
    logger.error({ error }, 'Error in cleanupDeadWorkers');
  }
}
```

### Fix #2: Standardize Heartbeat Intervals

**File**: `src/worker/index.ts` (line 219)
```typescript
}, 30000); // Every 30 seconds (changed from 10000)
```

**File**: `src/monitor/health-monitor.ts` (line 25)
```typescript
deadWorkerThresholdMs: number = 3 * 60 * 1000 // 3 minutes for dead workers (changed from 2)
```

---

## 📋 Deployment Checklist

### Before Push:
- [ ] Apply Fix #1 (Worker registration environment)
- [ ] Apply Fix #2 (Heartbeat intervals)
- [ ] Run `npm run build` to verify TypeScript compilation
- [ ] Run `npm run typecheck` to verify no type errors
- [ ] Test locally with `docker-compose up --build`
- [ ] Verify workers stay "alive" for >5 minutes
- [ ] Verify no "dead workers" warnings in logs

### After Push (Server):
- [ ] Pull latest code
- [ ] Run `npm install` (if dependencies changed)
- [ ] Run `npm run build`
- [ ] Restart services: `docker-compose down && docker-compose up -d --build`
- [ ] Monitor logs: `docker-compose logs -f`
- [ ] Check dashboard: http://localhost:3000
- [ ] Verify workers are active and healthy
- [ ] Check for any error jobs and retry if needed

---

## 🎯 Expected Results After Fixes

### Before Fixes:
- ❌ Workers marked as "dead" every 30 seconds
- ❌ Constant "💀 Cleaned up dead workers" messages
- ❌ Database churn from repeated worker status updates
- ⚠️ Confusing logs

### After Fixes:
- ✅ Workers stay "alive" indefinitely
- ✅ No "dead workers" warnings (unless worker actually crashes)
- ✅ Clean, minimal logs
- ✅ Stable worker status in database
- ✅ Proper job processing

---

## 📊 Summary

### Critical Issues: 1
- Worker registration environment mismatch

### Medium Issues: 2
- Heartbeat interval inconsistency
- Missing heartbeat failure recovery

### Low Issues: 1
- Worker ID format inconsistency

### Already Fixed: 3
- Timeout errors (10s → 30s)
- File deletion errors (ENOENT handling)
- Playwright installation (Docker)

**Total Fixes Required Before Push: 2 (Fix #1 and Fix #2)**

**Estimated Time to Fix: 15 minutes**

**Risk Level After Fixes: LOW** ✅


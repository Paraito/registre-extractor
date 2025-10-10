# OCR Monitor Error Fix Summary

## 🐛 Problem

The OCR monitor was logging errors when starting up:

```json
{
  "level": "ERROR",
  "error": {
    "code": "42703",
    "message": "column extraction_queue.ocr_worker_id does not exist"
  },
  "environment": "prod",
  "msg": "Error querying for stale OCR jobs"
}
```

This error appeared for both **prod** and **staging** environments.

## 🔍 Root Cause

Two issues were identified:

### 1. Missing Database Columns
The OCR tracking columns (added in migration 005) were not applied to prod and staging:
- ✅ **DEV**: Has all OCR tracking columns
- ❌ **PROD**: Missing OCR tracking columns
- ❌ **STAGING**: Missing OCR tracking columns

### 2. Stale OCR Monitor Checking All Environments
The stale OCR monitor was checking **all configured environments**, even those where:
- OCR was disabled (`OCR_PROD=false`, `OCR_STAGING=false`)
- The required database columns didn't exist

## ✅ Solution

### Part 1: Graceful Error Handling
Updated `src/ocr/stale-ocr-monitor.ts` to handle missing columns gracefully:

```typescript
if (queryError) {
  // Check if error is due to missing column (migration not applied)
  if (queryError.code === '42703') {
    // Column doesn't exist - migration 005 not applied yet
    logger.debug({
      environment: env,
      missingColumn: queryError.message.match(/column (.*?) does not exist/)?.[1] || 'unknown'
    }, 'OCR tracking columns not available in this environment - skipping stale job check');
    continue;
  }
  
  // For other errors, log as error
  logger.error({ error: queryError, environment: env }, 'Error querying for stale OCR jobs');
  continue;
}
```

### Part 2: Respect OCR Environment Configuration
Updated the stale OCR monitor to only check environments where OCR is enabled:

```typescript
for (const env of environments) {
  // Check if OCR is enabled for this environment
  const isOCREnabled = config.ocr.enabledEnvironments[env];
  if (!isOCREnabled) {
    logger.debug({ environment: env }, 'OCR disabled for environment, skipping stale job check');
    continue;
  }
  // ... rest of the logic
}
```

Also updated the start method to log which environments are being monitored:

```typescript
// Get list of environments with OCR enabled
const enabledEnvs = Object.entries(config.ocr.enabledEnvironments)
  .filter(([_, enabled]) => enabled)
  .map(([env]) => env);

logger.info({
  checkIntervalMs: this.checkIntervalMs,
  staleThresholdMs: this.staleThresholdMs,
  checkIntervalSeconds: this.checkIntervalMs / 1000,
  staleThresholdMinutes: this.staleThresholdMs / 1000 / 60,
  enabledEnvironments: enabledEnvs.join(', ') || 'none'
}, 'Stale OCR job monitor started');
```

## 📊 Current State

### Environment Configuration (.env)
```bash
OCR_PROD=false      # Disabled - columns not yet applied
OCR_STAGING=false   # Disabled - columns not yet applied
OCR_DEV=true        # Enabled - columns exist
```

### Database Schema Status
| Environment | OCR Columns | Status ID 6 | OCR Enabled |
|-------------|-------------|-------------|-------------|
| **DEV**     | ✅ Present  | ✅ Present  | ✅ Yes      |
| **PROD**    | ❌ Missing  | ❌ Missing  | ❌ No       |
| **STAGING** | ❌ Missing  | ❌ Missing  | ❌ No       |

### Monitor Behavior
- ✅ Only monitors environments where `OCR_<ENV>=true`
- ✅ Gracefully skips environments without required columns
- ✅ No more error logs for missing columns
- ✅ Clear logging of which environments are being monitored

## 🚀 Next Steps (Optional)

If you want to enable OCR for **prod** and **staging**, you need to:

### 1. Apply Migration 005

Run the migration script to get instructions:
```bash
npx tsx apply-ocr-tracking-migration.ts
```

This will show you the SQL to run in each environment's Supabase SQL Editor.

### 2. Verify Migration
```bash
npx tsx check-ocr-columns.ts
```

### 3. Enable OCR
Update `.env`:
```bash
OCR_PROD=true
OCR_STAGING=true
```

### 4. Restart Services
```bash
npm run ocr:dev  # or npm run ocr for production
```

## 📝 Files Modified

1. **src/ocr/stale-ocr-monitor.ts**
   - Added import for `config`
   - Added OCR enabled check before processing each environment
   - Added graceful handling for missing column errors (42703)
   - Updated start method to log enabled environments

## 🧪 Testing

Verified the fix by:
1. Running `npx tsx check-ocr-columns.ts` - confirmed column status
2. Starting OCR monitor with `npm run ocr:dev`
3. Observing clean startup with no errors
4. Confirming log shows `"enabledEnvironments":"dev"`

## ✨ Result

**Before:**
```json
{"level":"ERROR","error":{"code":"42703","message":"column extraction_queue.ocr_worker_id does not exist"},"environment":"prod","msg":"Error querying for stale OCR jobs"}
{"level":"ERROR","error":{"code":"42703","message":"column extraction_queue.ocr_worker_id does not exist"},"environment":"staging","msg":"Error querying for stale OCR jobs"}
```

**After:**
```json
{"level":"INFO","checkIntervalMs":60000,"staleThresholdMs":600000,"checkIntervalSeconds":60,"staleThresholdMinutes":10,"enabledEnvironments":"dev","msg":"Stale OCR job monitor started"}
```

No errors, clean operation! 🎉


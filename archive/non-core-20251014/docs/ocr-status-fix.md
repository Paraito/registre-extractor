# OCR Status Processing Fix

## Problem

Job `45a3730c-acf1-4e41-9855-817753dbe706` had `status_id = 3` but was not being picked up by the OCR monitor for processing.

## Root Cause

The OCR monitor had an **incorrect filter** in the database query:

```typescript
// WRONG - Old code
.eq('status_id', EXTRACTION_STATUS.COMPLETE)
.eq('document_source', 'index')
.is('file_content', null)  // ❌ This was the problem!
```

This filter meant that **only jobs without `file_content` would be processed**. However, the `status_id` should be the **source of truth**:

- `status_id = 3` means "Complété - extraction done, ready for OCR"
- If a job has `status_id = 3`, it **should be processed**, regardless of whether `file_content` is present or not

### Why This Happened

The job in question had:
- ✅ `status_id = 3` (ready for OCR)
- ✅ `file_content` populated (16,157 chars)
- ✅ `boosted_file_content` populated (14,269 chars)
- ❌ `ocr_completed_at = NULL` (should have been set)

This suggests that a previous OCR attempt had partially completed (stored the content) but failed to update the final status to `status_id = 5`.

## Solution

### 1. Fixed the OCR Monitor Query

**File:** `src/ocr/monitor.ts` (line 141)

```typescript
// CORRECT - New code
.eq('status_id', EXTRACTION_STATUS.COMPLETE)
.eq('document_source', 'index')
// Removed the .is('file_content', null) filter
```

Now the OCR monitor will process **ALL jobs with `status_id = 3`**, which is the correct behavior.

### 2. Updated Documentation

**File:** `src/ocr/README.md`

Updated the monitoring criteria to reflect the correct behavior:

```markdown
- `status_id = 3` (Complété - extraction completed, ready for OCR)
- `document_source = 'index'` (index documents only)
- `ocr_attempts < ocr_max_attempts` (hasn't exceeded retry limit)
```

### 3. Fixed the Stuck Job

The specific job was manually updated:
- Set `status_id = 5` (EXTRACTION_COMPLETE)
- Set `ocr_completed_at` to current timestamp

### 4. Created Utility Script

**File:** `scripts/fix-inconsistent-ocr-status.ts`

A utility script to find and fix any jobs that have OCR content but incorrect status:

```bash
npx tsx scripts/fix-inconsistent-ocr-status.ts
```

This script:
- Finds jobs with `status_id = 3` but `file_content` present
- Updates them to `status_id = 5` with proper `ocr_completed_at` timestamp
- Reports summary of fixes

## Status ID Reference

For clarity, here are the status IDs:

```typescript
export const EXTRACTION_STATUS = {
  EN_ATTENTE: 1,           // En attente (waiting for extraction)
  EN_TRAITEMENT: 2,        // En traitement (extraction in progress)
  COMPLETE: 3,             // Complété (extraction done, ready for OCR)
  ERREUR: 4,               // Erreur (error)
  EXTRACTION_COMPLETE: 5,  // Extraction Complété (OCR done)
  OCR_PROCESSING: 6        // OCR en traitement (OCR in progress)
}
```

## Workflow

The correct workflow is:

1. **Extraction Worker** extracts PDF → sets `status_id = 3`
2. **OCR Monitor** detects `status_id = 3` → processes OCR
3. **OCR Monitor** sets `status_id = 6` (OCR in progress)
4. **OCR Monitor** completes → sets `status_id = 5` (done)

## Prevention

To prevent this issue in the future:

1. ✅ The OCR monitor now correctly processes all `status_id = 3` jobs
2. ✅ The utility script can be run periodically to catch any inconsistencies
3. ✅ The status ID is now the single source of truth for job state

## Testing

After the fix, verify with:

```bash
# Check for jobs ready for OCR
npx tsx -e "
import { supabaseManager } from './src/utils/supabase';
import { EXTRACTION_STATUS } from './src/types';

const client = supabaseManager.getServiceClient('dev');
const { data } = await client
  .from('extraction_queue')
  .select('*')
  .eq('status_id', EXTRACTION_STATUS.COMPLETE)
  .eq('document_source', 'index');

console.log('Jobs ready for OCR:', data?.length || 0);
"
```

## Impact

- ✅ Jobs with `status_id = 3` will now be processed correctly
- ✅ No jobs will be stuck in limbo
- ✅ OCR processing will be more reliable
- ✅ Status ID is the single source of truth


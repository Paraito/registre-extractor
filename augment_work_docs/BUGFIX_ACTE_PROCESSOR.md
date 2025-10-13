# Bug Fix: Acte Processor Undefined Error

**Date:** 2025-10-11  
**Issue:** `Cannot read properties of undefined (reading 'tempDir')`  
**Status:** ✅ **FIXED**

---

## Problem Description

### Error Message
```
Error: Cannot read properties of undefined (reading 'tempDir')
```

### Root Cause

When the `UnifiedOCRProcessor` was enabled (i.e., when `CLAUDE_API_KEY` is set), the monitor was:
1. ✅ Initializing `unifiedProcessor` for INDEX documents
2. ❌ **NOT** initializing `acteProcessor` for ACTE documents

However, the `processActeDocument()` method still tried to access `this.acteProcessor`, which was undefined.

### Why This Happened

The original logic assumed:
- **Unified mode:** Only process INDEX documents (wrong assumption)
- **Legacy mode:** Process both INDEX and ACTE documents

But in reality:
- **INDEX documents:** Can use either Vision API (legacy) or Unified Processor (with fallback)
- **ACTE documents:** ALWAYS use File API (requires ActeOCRProcessor)

The UnifiedOCRProcessor doesn't support File API processing, so acte documents still need the ActeOCRProcessor even when using unified mode.

---

## Solution

### Changes Made

**File:** `src/ocr/monitor.ts`

#### 1. Always Initialize ActeOCRProcessor (Lines 72-114)

**Before:**
```typescript
if (this.useUnifiedProcessor) {
  // Initialize unified processor
  this.unifiedProcessor = new UnifiedOCRProcessor({...});
  
  // ❌ acteProcessor NOT initialized
} else {
  // Initialize legacy processors
  this.indexProcessor = new OCRProcessor({...});
  this.acteProcessor = new ActeOCRProcessor({...});
}
```

**After:**
```typescript
if (this.useUnifiedProcessor) {
  // Initialize unified processor for INDEX documents
  this.unifiedProcessor = new UnifiedOCRProcessor({...});
  
  // ✅ ALWAYS initialize acteProcessor for ACTE documents
  this.acteProcessor = new ActeOCRProcessor({...});
} else {
  // Initialize legacy processors
  this.indexProcessor = new OCRProcessor({...});
  this.acteProcessor = new ActeOCRProcessor({...});
}
```

#### 2. Update Initialize Method (Lines 124-134)

**Before:**
```typescript
async initialize(): Promise<void> {
  if (this.useUnifiedProcessor) {
    await this.unifiedProcessor.initialize();
    // ❌ acteProcessor NOT initialized
  } else {
    await this.indexProcessor.initialize();
    await this.acteProcessor.initialize();
  }
}
```

**After:**
```typescript
async initialize(): Promise<void> {
  if (this.useUnifiedProcessor) {
    await this.unifiedProcessor.initialize();
    await this.acteProcessor.initialize(); // ✅ Always initialize
  } else {
    await this.indexProcessor.initialize();
    await this.acteProcessor.initialize();
  }
}
```

#### 3. Update Stop Method (Lines 161-184)

**Before:**
```typescript
async stop(): Promise<void> {
  // ...
  await this.indexProcessor.cleanup();
  await this.acteProcessor.cleanup();
}
```

**After:**
```typescript
async stop(): Promise<void> {
  // ...
  if (this.useUnifiedProcessor) {
    await this.unifiedProcessor.cleanup();
  } else {
    await this.indexProcessor.cleanup();
  }
  await this.acteProcessor.cleanup(); // ✅ Always cleanup
}
```

#### 4. Fix TempDir Access (Lines 657-661)

**Before:**
```typescript
const tempPath = path.join(
  this.acteProcessor['tempDir'],  // ❌ Accessing private property
  `acte-download-${Date.now()}.pdf`
);
```

**After:**
```typescript
const tempPath = path.join(
  `${this.tempDir}-acte`,  // ✅ Use monitor's tempDir
  `acte-download-${Date.now()}.pdf`
);
```

---

## Architecture Clarification

### Document Processing Flow

```
┌─────────────────────────────────────────────────────────┐
│ OCR Monitor                                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ INDEX Documents (document_source = 'index')     │   │
│  ├─────────────────────────────────────────────────┤   │
│  │                                                 │   │
│  │  If useUnifiedProcessor:                        │   │
│  │    ✅ UnifiedOCRProcessor                       │   │
│  │       ├─ Try Gemini (Vision API)               │   │
│  │       └─ Fallback to Claude                    │   │
│  │                                                 │   │
│  │  Else:                                          │   │
│  │    ✅ OCRProcessor (Gemini Vision API only)    │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ACTE Documents (document_source = 'acte')       │   │
│  ├─────────────────────────────────────────────────┤   │
│  │                                                 │   │
│  │  ALWAYS:                                        │   │
│  │    ✅ ActeOCRProcessor (Gemini File API)       │   │
│  │       └─ Direct PDF upload (no image conv)     │   │
│  │                                                 │   │
│  │  Note: File API doesn't support Claude yet     │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Points

1. **INDEX documents** can use either:
   - UnifiedOCRProcessor (with Gemini ↔ Claude fallback)
   - Legacy OCRProcessor (Gemini only)

2. **ACTE documents** ALWAYS use:
   - ActeOCRProcessor (Gemini File API only)
   - No Claude fallback available (File API limitation)

3. **Both processors can coexist:**
   - UnifiedOCRProcessor for index documents
   - ActeOCRProcessor for acte documents

---

## Testing

### Verify the Fix

1. **Check initialization:**
   ```bash
   # Start the OCR monitor
   npm run ocr:dev
   
   # Look for this log message:
   # "Unified OCR Processor and Acte Processor initialized"
   ```

2. **Test acte document processing:**
   - Queue an acte document for OCR
   - Verify it processes without errors
   - Check logs for successful completion

3. **Test index document processing:**
   - Queue an index document for OCR
   - Verify it uses UnifiedOCRProcessor
   - Check for fallback behavior if needed

### Expected Behavior

**Before Fix:**
```
❌ OCR Processing Failed
   Error: Cannot read properties of undefined (reading 'tempDir')
```

**After Fix:**
```
✅ OCR Processing Started
✅ Acte PDF downloaded
✅ Text extraction completed
✅ Boost corrections applied
✅ OCR complete
```

---

## Impact Assessment

### What Changed
- ✅ ActeOCRProcessor now always initialized
- ✅ Acte documents can be processed in unified mode
- ✅ No breaking changes to existing functionality

### What Didn't Change
- ✅ Index document processing (still uses UnifiedOCRProcessor)
- ✅ Claude fallback for index documents (still works)
- ✅ Sanitization for index documents (still applied)
- ✅ Database storage format (unchanged)

### Backward Compatibility
- ✅ Works with Claude API key (unified mode)
- ✅ Works without Claude API key (legacy mode)
- ✅ Processes both index and acte documents
- ✅ No configuration changes required

---

## Related Files

### Modified
- `src/ocr/monitor.ts` - Fixed initialization and cleanup logic

### Not Modified (Still Working)
- `src/ocr/unified-ocr-processor.ts` - Unchanged
- `src/ocr/acte-processor.ts` - Unchanged
- `src/ocr/sanitizer.ts` - Unchanged
- `src/types/ocr.ts` - Unchanged

---

## Conclusion

The bug was caused by incomplete initialization logic when using the UnifiedOCRProcessor. The fix ensures that:

1. ✅ ActeOCRProcessor is ALWAYS initialized (needed for acte documents)
2. ✅ UnifiedOCRProcessor is used for index documents (when Claude key available)
3. ✅ Both processors can coexist and work independently
4. ✅ No breaking changes to existing functionality

The system now correctly handles both document types regardless of which OCR mode is active.


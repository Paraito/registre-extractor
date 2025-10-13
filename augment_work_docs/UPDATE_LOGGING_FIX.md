# Update: Logging Fix for Sanitized Content

**Date:** 2025-10-11  
**Issue:** Logging labels didn't reflect sanitized content  
**Status:** ✅ **FIXED**

---

## Problem

After implementing sanitization, the logging was still showing:
- "Raw Text: X chars" - but we're now storing clean JSON, not raw text
- "Boosted Text: X chars" - correct, but inconsistent naming

This was misleading because:
- For INDEX documents: `file_content` now contains clean JSON (not raw text)
- For ACTE documents: `file_content` still contains raw text

---

## Solution

### Changes Made

#### 1. Updated Monitor Logging (`src/ocr/monitor.ts` line 540)

**Before:**
```typescript
OCRLogger.documentComplete(
  document.document_number,
  environment,
  ocrResult.totalPages,
  rawText.length,        // ❌ Misleading - we store cleanJSON, not rawText
  boostedText.length,
  totalDuration
);
```

**After:**
```typescript
OCRLogger.documentComplete(
  document.document_number,
  environment,
  ocrResult.totalPages,
  cleanJSON.length,      // ✅ Correct - shows what's actually stored
  boostedText.length,
  totalDuration
);
```

#### 2. Updated Logger Labels (`src/ocr/ocr-logger.ts` lines 112-136)

**Before:**
```typescript
static documentComplete(
  docNumber: string,
  environment: string,
  totalPages: number,
  rawChars: number,           // ❌ Misleading parameter name
  boostedChars: number,
  totalDuration: number
): void {
  // ...
  console.log(`   Raw Text: ${rawChars.toLocaleString()} chars`);
  console.log(`   Boosted Text: ${boostedChars.toLocaleString()} chars`);
}
```

**After:**
```typescript
static documentComplete(
  docNumber: string,
  environment: string,
  totalPages: number,
  fileContentChars: number,   // ✅ Accurate parameter name
  boostedChars: number,
  totalDuration: number
): void {
  // ...
  console.log(`   File Content: ${fileContentChars.toLocaleString()} chars`);
  console.log(`   Boosted Content: ${boostedChars.toLocaleString()} chars`);
}
```

---

## Impact

### Before Fix

**Index Document Logging:**
```
📊 Processing Summary
   Document Number: 29 645 082
   Environment: dev
   Total Pages: 6
   Raw Text: 45,234 chars        ❌ Misleading - not raw text
   Boosted Text: 52,891 chars
   Total Duration: 45.2s
   Status: ✅ Saved to database
```

### After Fix

**Index Document Logging:**
```
📊 Processing Summary
   Document Number: 29 645 082
   Environment: dev
   Total Pages: 6
   File Content: 8,456 chars      ✅ Accurate - clean JSON
   Boosted Content: 52,891 chars  ✅ Consistent naming
   Total Duration: 45.2s
   Status: ✅ Saved to database
```

**Acte Document Logging:**
```
📊 Processing Summary
   Document Number: 29 649 509
   Environment: dev
   Total Pages: 1
   File Content: 12,345 chars     ✅ Accurate - raw text for actes
   Boosted Content: 15,678 chars  ✅ Consistent naming
   Total Duration: 23.4s
   Status: ✅ Saved to database
```

---

## Benefits

### 1. Accurate Reporting
- Shows actual size of what's stored in `file_content`
- For index docs: Clean JSON size (much smaller than verbose text)
- For acte docs: Raw text size

### 2. Consistent Naming
- "File Content" matches database column `file_content`
- "Boosted Content" matches database column `boosted_file_content`
- No confusion about what's being stored

### 3. Storage Insights
- Can now see the storage savings from sanitization
- Example: Verbose text 52KB → Clean JSON 8KB (84% reduction)

---

## Files Modified

```
src/ocr/monitor.ts      - Updated documentComplete call (line 540)
src/ocr/ocr-logger.ts   - Updated parameter names and labels (lines 112-136)
```

---

## Verification

### Check Logs After Processing

**Index Document:**
- ✅ "File Content" shows clean JSON size (~5-15KB typically)
- ✅ "Boosted Content" shows verbose text size (~30-100KB typically)
- ✅ File Content is significantly smaller than Boosted Content

**Acte Document:**
- ✅ "File Content" shows raw text size
- ✅ "Boosted Content" shows boosted text size
- ✅ Both sizes are similar (no sanitization for actes)

---

## Conclusion

The logging now accurately reflects what's being stored in the database:
- ✅ Clear distinction between file_content and boosted_file_content
- ✅ Accurate character counts for both columns
- ✅ Consistent naming across the codebase
- ✅ Easy to see storage savings from sanitization

This makes it easier to:
- Monitor sanitization effectiveness
- Debug storage issues
- Track database size growth
- Understand the impact of sanitization


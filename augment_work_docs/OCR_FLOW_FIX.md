# OCR Processing Flow Fix

## Problem Identified

The parallelization implementation had a critical flaw in the processing flow:

### ❌ INCORRECT FLOW (Before Fix)
1. Extract raw text from each page (in parallel) ✅
2. **Apply boost to EACH PAGE individually** ❌ WRONG!
3. Concatenate the already-boosted texts

**Issue**: Boost was being applied to each page separately, which breaks the context and correction logic that needs to see the full document.

### ✅ CORRECT FLOW (After Fix)
1. Extract raw text from all pages (in parallel) ✅
2. **CONCATENATE all raw text from all pages** ✅
3. **Apply boost to the FULL concatenated raw text** (single boost call) ✅

## Changes Made

### 1. `src/ocr/processor.ts`

#### New Method: `extractPageText()`
- Extracts raw text from a single page
- **Does NOT apply boost** (boost is applied later to full concatenated text)
- Returns: `{ pageNumber, rawText, extractionComplete }`

#### Updated Method: `processPage()` (Legacy)
- Marked as legacy for sequential processing
- Still applies boost per-page (not recommended)
- Kept for backward compatibility with single-page mode

#### Fixed Method: `processPDFParallel()`
**New Implementation:**
```typescript
async processPDFParallel(pdfPath: string): Promise<MultiPageOCRResult> {
  // Step 1: Convert all PDF pages to images
  const conversionResult = await this.pdfConverter.convertAllPagesToImages(pdfPath, ...);
  
  // Step 2: Extract raw text from all pages in parallel (NO BOOST YET)
  const extractionPromises = conversionResult.pages.map((page, index) =>
    this.extractPageText(index + 1, page.base64Data, page.mimeType)
  );
  const extractionResults = await Promise.all(extractionPromises);
  
  // Step 3: CONCATENATE all raw text from all pages
  const combinedRawText = extractionResults
    .map(p => `\n\n--- Page ${p.pageNumber} ---\n\n${p.rawText}`)
    .join('\n');
  
  // Step 4: Apply boost to the FULL concatenated raw text (SINGLE BOOST CALL)
  const boostResult = await this.geminiClient.boostText(
    combinedRawText,
    BOOST_PROMPT,
    { model: this.boostModel, temperature: this.boostTemperature, maxAttempts: 3 }
  );
  
  return {
    pages: pageResults,
    totalPages: conversionResult.totalPages,
    combinedRawText,           // Full concatenated raw text
    combinedBoostedText: boostResult.boostedText,  // Boost applied to full text
    allPagesComplete: allExtractionComplete && boostResult.isComplete
  };
}
```

### 2. `src/ocr/monitor.ts`

#### Updated: OCR Processing Call
Changed from sequential to parallel processing:

```typescript
// OLD (Sequential - processes one page at a time)
const ocrResult = await this.processor.processPDF(tempPath);
const rawText = ocrResult.rawText;
const boostedText = ocrResult.boostedText;

// NEW (Parallel with correct flow)
const ocrResult = await this.processor.processPDFParallel(tempPath);
const rawText = ocrResult.combinedRawText;      // Concatenated from all pages
const boostedText = ocrResult.combinedBoostedText;  // Boost applied to full text
```

#### Updated: Logging
Added more detailed logging:
```typescript
logger.info({
  documentId: document.id,
  documentNumber: document.document_number,
  totalPages: ocrResult.totalPages,              // NEW
  rawTextLength: rawText.length,
  boostedTextLength: boostedText.length,
  allPagesComplete: ocrResult.allPagesComplete,  // NEW
  environment
}, 'OCR processing completed successfully (parallel with correct flow)');
```

## Database Fields

The system correctly stores:

- **`file_content`**: Raw OCR output from Gemini Vision AI
  - Now contains: **Concatenated raw text from ALL pages**
  - Format: `\n\n--- Page 1 ---\n\n[text]\n\n--- Page 2 ---\n\n[text]...`

- **`boosted_file_content`**: Enhanced text with 60+ correction rules applied
  - Now contains: **Boost applied to the FULL concatenated raw text**
  - Single boost call processes the entire document with full context

## Benefits of This Fix

1. **Better Context**: Boost sees the full document, not individual pages
2. **Better Corrections**: Cross-page references and context are preserved
3. **Faster Processing**: Only ONE boost call instead of N boost calls (one per page)
4. **Cost Savings**: Fewer API calls to Gemini
5. **Correct Flow**: Matches the intended design:
   - Step 1: Extract (parallel)
   - Step 2: Concatenate
   - Step 3: Boost (on full text)

## Backward Compatibility

- Single-page methods (`processPDF`, `processPDFFromURL`, `processPDFFromBase64`) remain unchanged
- They still use the old flow (extract → boost per page) for single-page documents
- Multi-page processing now uses the correct flow via `processPDFParallel`

## Testing

To verify the fix works correctly:

1. Check logs for "Applying boost to FULL concatenated raw text"
2. Verify `file_content` contains page markers: `--- Page 1 ---`, `--- Page 2 ---`, etc.
3. Verify `boosted_file_content` is a single boosted output (not concatenated boosts)
4. Check that boost is called ONCE per document, not once per page

## Migration Notes

- No database migration needed
- Existing records are unaffected
- New OCR processing will use the correct flow automatically
- OCR Monitor will automatically use parallel processing for all new documents


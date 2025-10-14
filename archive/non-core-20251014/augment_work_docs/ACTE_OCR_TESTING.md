# Acte OCR Testing Guide

**Date:** 2025-10-10  
**Status:** Ready for Testing

---

## Overview

This document outlines the testing strategy for the Acte OCR pipeline implementation. The pipeline processes acte documents from the `extraction_queue` using the Gemini File API.

---

## Test Scripts

### 1. **test-acte-ocr.ts** - Standalone OCR Test
Tests the core OCR functionality without database integration.

**Purpose:**
- Validate OCR extraction quality
- Test boost corrections
- Measure processing performance
- Verify completion markers

**Usage:**
```bash
# Test with a specific document ID
npx ts-node test-acte-ocr.ts <document-id>

# Test with first available acte document
npx ts-node test-acte-ocr.ts
```

**What it tests:**
- ✅ PDF download from Supabase storage
- ✅ File upload to Gemini File API
- ✅ Text extraction with continuation handling
- ✅ Boost corrections with continuation handling
- ✅ Completion marker detection
- ✅ File cleanup (local and Gemini)
- ✅ Performance metrics

**Expected output:**
```
===================================================================
🧪 Acte OCR Test Script
===================================================================

⚙️ Configuration
   Environment: dev
   Temp Directory: /tmp/test-acte-ocr
   Extract Model: gemini-2.0-flash-exp
   Boost Model: gemini-2.5-pro

🔍 Finding Test Document
✅ Found document: 12345678 (ID: abc-123)
   Status ID: 3
   OCR Attempts: 0
   Supabase Path: actes/12345678.pdf

📥 Downloading PDF
✅ Downloaded PDF: 1024 KB
   Local path: /tmp/test-acte-ocr/12345678.pdf

🚀 Processing Acte Document
ℹ️  Extract Model: gemini-2.0-flash-exp
ℹ️  Boost Model: gemini-2.5-pro
✅ Processing complete!

===================================================================
📊 Test Results
===================================================================

⏱️ Performance Metrics
   Total Duration: 45.3s
   Raw Text Length: 45,000 chars
   Boosted Text Length: 47,500 chars
   Extraction Complete: ✅ Yes
   Boost Complete: ✅ Yes

📄 Raw Text Preview (first 500 chars)
[Preview of extracted text...]

✨ Boosted Text Preview (first 500 chars)
[Preview of boosted text...]

🔍 Validation Checks
   Extraction Marker Present: ✅ Yes
   Boost Marker Present: ✅ Yes
   Text Length Increase: 5.6%

===================================================================
✅ Test Completed Successfully
===================================================================
```

---

### 2. **test-acte-ocr-integration.ts** - Full Integration Test
Tests the complete workflow including database updates.

**Purpose:**
- Validate end-to-end workflow
- Test database status transitions
- Verify data persistence
- Test error handling and rollback

**Usage:**
```bash
# Full integration test (updates database)
npx ts-node test-acte-ocr-integration.ts <document-id>

# Dry-run mode (no database updates)
# Edit TEST_CONFIG.updateDatabase = false in the script
npx ts-node test-acte-ocr-integration.ts
```

**What it tests:**
- ✅ Document locking (status update to OCR_PROCESSING)
- ✅ OCR worker ID assignment
- ✅ OCR attempt counter increment
- ✅ Complete OCR processing
- ✅ Database storage of results
- ✅ Status transition to EXTRACTION_COMPLETE
- ✅ Error handling and rollback
- ✅ File cleanup verification

**Expected output:**
```
===================================================================
🧪 Acte OCR Integration Test
===================================================================

⚙️ Configuration
   Environment: dev
   Worker ID: test-worker-a1b2c3d4
   Update Database: Yes
   Cleanup After Test: Yes

🔍 Finding and Locking Test Document
✅ Found document: 12345678
   Document ID: abc-123
   Current Status: 3
   OCR Attempts: 0
ℹ️  Updating status to OCR_PROCESSING...
✅ Status updated to OCR_PROCESSING

📥 Downloading PDF from Storage
ℹ️  Bucket: actes
ℹ️  Path: 12345678.pdf
✅ Downloaded: 1024 KB
   Local path: /tmp/test-acte-ocr-integration/12345678.pdf

🚀 Processing with OCR
ℹ️  Extract Model: gemini-2.0-flash-exp
ℹ️  Boost Model: gemini-2.5-pro
✅ OCR processing complete
   Raw Text: 45,000 chars
   Boosted Text: 47,500 chars
   Extraction Complete: ✅
   Boost Complete: ✅

💾 Saving Results to Database
✅ Results saved to database
   Status: EXTRACTION_COMPLETE (5)
   Raw Text Length: 45,000 chars
   Boosted Text Length: 47,500 chars

🔍 Verifying Gemini File Cleanup
ℹ️  File cleanup verification not implemented (SDK limitation)
ℹ️  Files are deleted immediately after processing

===================================================================
✅ Integration Test Completed Successfully
===================================================================

📊 Summary
   Document Number: 12345678
   Total Duration: 47.8s
   Processing Complete: ✅ Yes
   Database Updated: ✅ Yes
```

---

## Testing Checklist

### Pre-Testing Setup

- [ ] **Environment Variables Set**
  ```bash
  GEMINI_API_KEY=your-api-key
  DEV_SUPABASE_URL=your-dev-url
  DEV_SUPABASE_ANON_KEY=your-anon-key
  DEV_SUPABASE_SERVICE_KEY=your-service-key
  OCR_DEV=true
  ```

- [ ] **Test Data Available**
  - At least one acte document in `extraction_queue`
  - `document_source = 'acte'`
  - `status_id = 3` (COMPLETE)
  - Valid `supabase_path` pointing to PDF in `actes` bucket
  - `ocr_attempts < ocr_max_attempts`

- [ ] **Dependencies Installed**
  ```bash
  npm install
  npm run build
  ```

### Unit Testing

- [ ] Test GeminiFileClient upload functionality
- [ ] Test file status monitoring
- [ ] Test text extraction with small document
- [ ] Test text extraction with large document (token limits)
- [ ] Test boost corrections
- [ ] Test continuation handling (truncated responses)
- [ ] Test file cleanup

### Integration Testing

- [ ] Test standalone OCR script (`test-acte-ocr.ts`)
- [ ] Test integration script in dry-run mode
- [ ] Test integration script with database updates
- [ ] Test with small acte documents (< 10 pages)
- [ ] Test with medium acte documents (10-30 pages)
- [ ] Test with large acte documents (> 30 pages)
- [ ] Test with handwritten content
- [ ] Test error handling (invalid document ID)
- [ ] Test error handling (missing PDF file)
- [ ] Test error handling (network failures)

### Monitor Testing

- [ ] Run OCR monitor with both index and acte documents
- [ ] Verify correct routing based on `document_source`
- [ ] Verify concurrent processing works
- [ ] Verify stale job monitoring works
- [ ] Verify logging output is correct

### Performance Testing

- [ ] Measure processing time for various document sizes
- [ ] Monitor token usage and costs
- [ ] Test token limit handling with very large documents
- [ ] Verify no memory leaks during batch processing
- [ ] Check for orphaned files in Gemini
- [ ] Check for orphaned files in temp directory

---

## Success Criteria

### Functional Requirements

1. ✅ **Extraction Accuracy**
   - Raw text captures all visible content
   - Handwritten text is attempted with `[?]` markers
   - Structure is preserved (sections, paragraphs)
   - All critical elements captured (parties, amounts, dates, etc.)

2. ✅ **Boost Quality**
   - OCR errors corrected
   - Entity names standardized
   - Amounts and dates formatted consistently
   - Markdown formatting improves readability

3. ✅ **Completion Markers**
   - `✅ EXTRACTION_COMPLETE:` present in raw text
   - `✅ BOOST_COMPLETE:` present in boosted text
   - Markers indicate full processing (not truncated)

4. ✅ **Database Updates**
   - Status transitions: COMPLETE → OCR_PROCESSING → EXTRACTION_COMPLETE
   - `file_content` populated with raw text
   - `boosted_file_content` populated with boosted text
   - OCR tracking fields updated correctly
   - Errors stored in `ocr_error` field

5. ✅ **File Cleanup**
   - Local temp files deleted
   - Gemini uploaded files deleted
   - No orphaned files remain

### Performance Requirements

1. ✅ **Processing Times** (within expected ranges)
   - Small documents (1-5 pages): 15-25s
   - Medium documents (5-20 pages): 30-70s
   - Large documents (20-50 pages): 70-140s

2. ✅ **Token Usage** (reasonable)
   - ~1,500-3,000 tokens per page
   - No excessive retries
   - Continuation works when needed

3. ✅ **Resource Management**
   - No memory leaks
   - Temp files cleaned up
   - No zombie processes

### Reliability Requirements

1. ✅ **Error Handling**
   - Graceful failure on network errors
   - Proper rollback on processing errors
   - Retry logic works correctly
   - Error messages are clear and actionable

2. ✅ **Concurrent Processing**
   - Monitor can process both index and acte documents
   - No race conditions
   - Proper document locking

---

## Known Issues and Limitations

### Current Limitations

1. **Token Limits**
   - Very large documents (> 100 pages) may exceed token limits
   - Continuation prompts handle most cases (up to 3 retries)
   - Future: Implement page-by-page chunking if needed

2. **Handwritten Text**
   - Quality depends on handwriting legibility
   - Uncertain text marked with `[?]`
   - Completely illegible text marked as `[ILLISIBLE]`

3. **File Cleanup Verification**
   - Gemini SDK doesn't provide file listing
   - Cannot programmatically verify all files deleted
   - Manual verification required via Gemini API console

### Future Enhancements

1. **Page-by-Page Chunking**
   - For documents exceeding token limits
   - Placeholder exists in `processActePDFWithChunking`

2. **Parallel Processing**
   - Process multiple documents concurrently
   - Requires worker pool implementation

3. **Quality Metrics**
   - Confidence scores for extracted text
   - Automated quality assessment

---

## Troubleshooting

### Common Issues

**Issue:** "GEMINI_API_KEY is required"  
**Solution:** Set the environment variable: `export GEMINI_API_KEY=your-key`

**Issue:** "No acte documents found with status_id=3"  
**Solution:** Ensure test data exists in the database with correct status

**Issue:** "Failed to download PDF from bucket"  
**Solution:** 
- Verify `supabase_path` is correct
- Check file exists in `actes` bucket
- Verify Supabase credentials

**Issue:** "File processing timeout"  
**Solution:**
- Large PDFs may take longer to process
- Check Gemini API status
- Increase timeout if needed

**Issue:** Extraction incomplete (truncated)  
**Solution:**
- Expected for very large documents
- System retries up to 3 times
- Consider implementing chunking

**Issue:** "boosted_file_content column not found"  
**Solution:**
- Run migration `004_add_boosted_content.sql`
- System falls back to `file_content` only

---

## Test Results Template

Use this template to document test results:

```markdown
## Test Run: [Date]

### Environment
- Environment: dev/staging/prod
- Gemini API Key: [first 8 chars]
- Extract Model: gemini-2.0-flash-exp
- Boost Model: gemini-2.5-pro

### Test Documents
| Document Number | Pages | Size (KB) | Status |
|----------------|-------|-----------|--------|
| 12345678       | 15    | 1024      | ✅ Pass |
| 87654321       | 45    | 3072      | ✅ Pass |
| 11223344       | 120   | 8192      | ⚠️ Partial |

### Performance Metrics
| Document | Upload | Extract | Boost | Total | Complete |
|----------|--------|---------|-------|-------|----------|
| 12345678 | 2.1s   | 15.3s   | 12.8s | 30.2s | ✅ Yes   |
| 87654321 | 5.4s   | 42.1s   | 38.7s | 86.2s | ✅ Yes   |
| 11223344 | 12.3s  | 95.2s   | 87.5s | 195s  | ⚠️ No    |

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommendations
1. [Recommendation]
2. [Recommendation]
```

---

## Next Steps

1. **Run Standalone Tests**
   - Test with small, medium, and large documents
   - Verify extraction quality
   - Measure performance

2. **Run Integration Tests**
   - Test database updates
   - Verify error handling
   - Test rollback functionality

3. **Run Monitor Tests**
   - Test with both index and acte documents
   - Verify concurrent processing
   - Monitor for issues

4. **Document Results**
   - Record test outcomes
   - Document any issues found
   - Suggest improvements

5. **Production Readiness**
   - Review all test results
   - Address any critical issues
   - Create deployment checklist
   - Update operational documentation

---

## References

- **Implementation Guide:** `ACTE_OCR_IMPLEMENTATION.md`
- **Quick Start Guide:** `ACTE_OCR_QUICKSTART.md`
- **Main Processor:** `src/ocr/acte-processor.ts`
- **File API Client:** `src/ocr/gemini-file-client.ts`
- **Prompts:** `src/ocr/prompts-acte.ts`
- **Monitor:** `src/ocr/monitor.ts`


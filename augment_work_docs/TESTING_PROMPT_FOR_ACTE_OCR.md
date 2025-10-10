# Testing Prompt for Acte OCR Pipeline

**Use this prompt to start a new thread for testing the acte OCR implementation.**

---

## Prompt for New Thread

```
I need to test and validate the newly implemented Acte OCR pipeline that was just completed. This pipeline processes acte documents from the extraction_queue using the Gemini File API.

CONTEXT:
- A complete OCR processing pipeline for acte documents has been implemented
- It uses the Gemini File API (different from the existing index OCR which uses Vision API)
- The implementation mirrors the existing index OCR patterns for queue management
- All code is complete and compiles without errors
- Ready for testing and validation

IMPLEMENTATION DETAILS:

1. **New Components Created:**
   - `src/ocr/gemini-file-client.ts` - Gemini File API client
   - `src/ocr/acte-processor.ts` - Acte OCR processor
   - `src/ocr/prompts-acte.ts` - Acte-specific prompts
   - Updated `src/ocr/monitor.ts` - Now supports both index and acte documents
   - Updated `src/config/index.ts` - Added acte OCR configuration

2. **Key Features:**
   - Direct PDF upload to Gemini File API (no image conversion)
   - Token limit handling with continuation prompts (up to 3 retries)
   - Automatic file cleanup after processing
   - Same queue management as index OCR (status_id, ocr_attempts, etc.)
   - Structured logging with minimal output

3. **Documentation:**
   - `ACTE_OCR_IMPLEMENTATION.md` - Complete implementation guide
   - `ACTE_OCR_QUICKSTART.md` - Quick start and testing guide

TESTING REQUIREMENTS:

1. **Create Test Script:**
   - Create a standalone test script to process a sample acte PDF
   - Test the complete flow: upload → extract → boost → cleanup
   - Verify output quality and completeness
   - Test error handling and retry logic

2. **Integration Testing:**
   - Test with the OCR monitor (processes both index and acte)
   - Verify database updates (status_id, file_content, boosted_file_content)
   - Test with documents of different sizes (small, medium, large)
   - Test with handwritten content if available

3. **Edge Cases:**
   - Test token limit handling (very large documents)
   - Test retry logic (simulate failures)
   - Test file cleanup (verify no orphaned files in Gemini)
   - Test concurrent processing of index and acte documents

4. **Performance Validation:**
   - Measure processing times for different document sizes
   - Monitor token usage and costs
   - Verify completion markers work correctly
   - Check for memory leaks or resource issues

IMPORTANT FILES TO REVIEW:
- `ACTE_OCR_IMPLEMENTATION.md` - Architecture and workflow details
- `ACTE_OCR_QUICKSTART.md` - Setup and testing procedures
- `src/ocr/acte-processor.ts` - Main processor logic
- `src/ocr/gemini-file-client.ts` - File API client
- `src/ocr/prompts-acte.ts` - Extraction and boost prompts
- `src/ocr/monitor.ts` - Updated monitor with routing logic

DATABASE SCHEMA:
The implementation uses existing OCR tracking fields from migration 005_add_ocr_tracking.sql:
- ocr_worker_id, ocr_started_at, ocr_completed_at
- ocr_attempts, ocr_max_attempts
- ocr_error, ocr_last_error_at
- file_content (raw text), boosted_file_content (corrected text)

CONFIGURATION:
Environment variables (all optional with defaults):
- ACTE_OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
- ACTE_OCR_BOOST_MODEL=gemini-2.5-pro
- ACTE_OCR_EXTRACT_TEMPERATURE=0.1
- ACTE_OCR_BOOST_TEMPERATURE=0.2

WORKFLOW:
1. Monitor polls for documents with status_id=3 and document_source='acte'
2. Downloads PDF from 'actes' bucket
3. Uploads to Gemini File API
4. Waits for file processing (PROCESSING → ACTIVE)
5. Extracts text with ACTE_EXTRACT_PROMPT
6. Applies boost with ACTE_BOOST_PROMPT
7. Stores in database (file_content + boosted_file_content)
8. Updates status_id to 5 (EXTRACTION_COMPLETE)
9. Cleans up temp files and Gemini uploads

TASKS TO COMPLETE:

1. Create a test script (test-acte-ocr.ts) to:
   - Process a sample acte PDF file
   - Verify extraction quality
   - Check boost corrections
   - Validate completion markers
   - Test error handling

2. Test with the OCR monitor:
   - Ensure it processes acte documents from the queue
   - Verify database updates are correct
   - Check logging output matches expected format
   - Confirm file cleanup works

3. Performance testing:
   - Test with documents of varying sizes
   - Measure processing times
   - Monitor token usage
   - Verify no memory leaks

4. Edge case testing:
   - Test with very large documents (token limit handling)
   - Test with handwritten content
   - Test retry logic (simulate failures)
   - Test concurrent index + acte processing

5. Documentation:
   - Update test results in a new document
   - Document any issues found
   - Suggest improvements or optimizations
   - Create deployment checklist

EXPECTED OUTCOMES:
- Test script successfully processes acte documents
- OCR monitor correctly routes and processes both index and acte documents
- Database updates are accurate and complete
- Logging is clear and minimal
- No resource leaks or orphaned files
- Performance meets expectations (see ACTE_OCR_QUICKSTART.md for benchmarks)

IMPORTANT NOTES:
- The existing index OCR uses Vision API with PDF-to-image conversion
- The new acte OCR uses File API with direct PDF upload (more efficient)
- Both use the same queue management pattern
- The monitor automatically routes based on document_source
- All configuration has sensible defaults
- No database migrations needed (uses existing schema)

Please start by:
1. Reviewing the implementation documentation
2. Creating a test script for standalone testing
3. Testing with sample acte documents
4. Validating the complete workflow
5. Documenting results and any issues found

Let me know if you need any clarification or additional context!
```

---

## Additional Context for Testing

### Sample Test Document Requirements

You'll need at least one acte PDF document for testing. Ideal test documents should:
- Be stored in the `actes` Supabase bucket
- Have a corresponding row in `extraction_queue` with:
  - `document_source = 'acte'`
  - `status_id = 3` (COMPLETE)
  - Valid `supabase_path` pointing to the PDF
  - `ocr_attempts < ocr_max_attempts` (or NULL)

### Test Data Setup Query

```sql
-- Find acte documents ready for OCR testing
SELECT 
  id,
  document_number,
  document_source,
  status_id,
  supabase_path,
  ocr_attempts,
  ocr_max_attempts,
  created_at
FROM extraction_queue
WHERE document_source = 'acte'
  AND status_id = 3
  AND (ocr_attempts IS NULL OR ocr_attempts < COALESCE(ocr_max_attempts, 3))
ORDER BY created_at ASC
LIMIT 5;
```

### Environment Setup

Ensure these are configured before testing:
```bash
# Required
GEMINI_API_KEY=your-api-key-here

# Supabase (at least one environment)
DEV_SUPABASE_URL=...
DEV_SUPABASE_ANON_KEY=...
DEV_SUPABASE_SERVICE_KEY=...

# Optional (has defaults)
ACTE_OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
ACTE_OCR_BOOST_MODEL=gemini-2.5-pro
OCR_DEV=true
```

### Success Criteria

The testing is successful if:
1. ✅ Test script processes acte PDFs without errors
2. ✅ Extracted text is accurate and complete
3. ✅ Boost corrections improve readability
4. ✅ Database updates are correct (status_id, file_content, boosted_file_content)
5. ✅ Completion markers are present in output
6. ✅ Files are cleaned up (no orphans in Gemini or temp directories)
7. ✅ Logging is clear and minimal
8. ✅ Processing times are reasonable (see benchmarks in ACTE_OCR_QUICKSTART.md)
9. ✅ Token limit handling works for large documents
10. ✅ Error handling and retry logic work correctly

### Files to Monitor During Testing

- **Logs**: Check console output for structured logging
- **Database**: Monitor `extraction_queue` table for status updates
- **Temp Directory**: Verify cleanup of `/tmp/ocr-acte-processing`
- **Gemini Files**: Verify files are deleted after processing (use Gemini API to list files)

### Common Issues to Watch For

1. **File Upload Failures**: Check network connectivity and API key
2. **Processing Timeouts**: Large files may need longer timeout
3. **Truncated Responses**: Should retry with continuation prompts
4. **Database Update Errors**: Check if boosted_file_content column exists
5. **Memory Leaks**: Monitor memory usage during batch processing
6. **Orphaned Files**: Verify cleanup in both temp dir and Gemini

### Metrics to Collect

- Processing time per document (upload, extract, boost, total)
- Token usage per document (input + output)
- Success rate (completed vs failed)
- Retry rate (how often continuation is needed)
- Average document size vs processing time
- Cost per document

---

## Quick Reference

**Start Testing**: Use the prompt above in a new thread  
**Implementation Docs**: `ACTE_OCR_IMPLEMENTATION.md`  
**Quick Start Guide**: `ACTE_OCR_QUICKSTART.md`  
**Main Processor**: `src/ocr/acte-processor.ts`  
**File API Client**: `src/ocr/gemini-file-client.ts`  
**Prompts**: `src/ocr/prompts-acte.ts`  
**Monitor**: `src/ocr/monitor.ts`  
**Config**: `src/config/index.ts`


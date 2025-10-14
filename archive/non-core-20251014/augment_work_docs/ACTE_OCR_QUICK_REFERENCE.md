# Acte OCR Quick Reference

Quick reference guide for testing and operating the Acte OCR pipeline.

---

## Quick Start

### 1. Validate Setup
```bash
npm run test:acte:validate
# or
npx ts-node validate-acte-ocr-setup.ts
```

### 2. Run Standalone Test
```bash
npm run test:acte:standalone
# or
npx ts-node test-acte-ocr.ts [document-id]
```

### 3. Run Integration Test
```bash
npm run test:acte:integration
# or
npx ts-node test-acte-ocr-integration.ts [document-id]
```

### 4. Run All Tests
```bash
npm run test:acte:all
# or
./run-all-acte-tests.sh
```

### 5. Run OCR Monitor
```bash
npm run ocr:monitor
# or
npm run ocr:dev  # with auto-reload
```

---

## Environment Variables

### Required
```bash
GEMINI_API_KEY=your-api-key-here
```

### Supabase (at least one environment)
```bash
# Development
DEV_SUPABASE_URL=https://your-project.supabase.co
DEV_SUPABASE_ANON_KEY=your-anon-key
DEV_SUPABASE_SERVICE_KEY=your-service-key

# Staging (optional)
STAGING_SUPABASE_URL=...
STAGING_SUPABASE_ANON_KEY=...
STAGING_SUPABASE_SERVICE_KEY=...

# Production (optional)
PROD_SUPABASE_URL=...
PROD_SUPABASE_ANON_KEY=...
PROD_SUPABASE_SERVICE_KEY=...
```

### Optional (has defaults)
```bash
# Acte OCR Configuration
ACTE_OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
ACTE_OCR_BOOST_MODEL=gemini-2.5-pro
ACTE_OCR_EXTRACT_TEMPERATURE=0.1
ACTE_OCR_BOOST_TEMPERATURE=0.2

# OCR Environment Control
OCR_DEV=true
OCR_STAGING=true
OCR_PROD=false  # Keep disabled until tested
```

---

## Test Scripts Overview

### validate-acte-ocr-setup.ts
**Purpose:** Validate environment configuration  
**Updates Database:** No  
**Duration:** ~10 seconds

**Checks:**
- ✅ Environment variables
- ✅ Gemini API connectivity
- ✅ Supabase connectivity
- ✅ Test data availability
- ✅ File system permissions

**Usage:**
```bash
npx ts-node validate-acte-ocr-setup.ts
```

---

### test-acte-ocr.ts
**Purpose:** Test core OCR functionality  
**Updates Database:** No  
**Duration:** ~30-60 seconds per document

**Tests:**
- ✅ PDF download
- ✅ File upload to Gemini
- ✅ Text extraction
- ✅ Boost corrections
- ✅ Completion markers
- ✅ File cleanup

**Usage:**
```bash
# Test with specific document
npx ts-node test-acte-ocr.ts abc-123-def-456

# Test with first available document
npx ts-node test-acte-ocr.ts
```

---

### test-acte-ocr-integration.ts
**Purpose:** Test complete workflow with database  
**Updates Database:** Yes (configurable)  
**Duration:** ~30-60 seconds per document

**Tests:**
- ✅ Document locking
- ✅ Status transitions
- ✅ OCR processing
- ✅ Database storage
- ✅ Error handling
- ✅ Rollback on failure

**Usage:**
```bash
# Full integration test (updates database)
npx ts-node test-acte-ocr-integration.ts

# With specific document
npx ts-node test-acte-ocr-integration.ts abc-123-def-456
```

**Dry-run mode:**
Edit the script and set `TEST_CONFIG.updateDatabase = false`

---

### run-all-acte-tests.sh
**Purpose:** Run complete test suite  
**Updates Database:** Yes (with confirmation)  
**Duration:** ~5-10 minutes

**Runs:**
1. Setup validation
2. Project build
3. Standalone OCR test
4. Integration test (with confirmation)
5. Monitor test (optional)

**Usage:**
```bash
./run-all-acte-tests.sh
```

---

## Database Queries

### Find Acte Documents Ready for OCR
```sql
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
LIMIT 10;
```

### Check Active OCR Jobs
```sql
SELECT 
  id,
  document_number,
  document_source,
  ocr_worker_id,
  ocr_started_at,
  EXTRACT(EPOCH FROM (NOW() - ocr_started_at)) as duration_seconds
FROM extraction_queue
WHERE status_id = 6  -- OCR_PROCESSING
  AND document_source = 'acte'
ORDER BY ocr_started_at ASC;
```

### Check Completed OCR Jobs
```sql
SELECT 
  id,
  document_number,
  document_source,
  ocr_completed_at,
  LENGTH(file_content) as raw_text_length,
  LENGTH(boosted_file_content) as boosted_text_length,
  ocr_attempts,
  EXTRACT(EPOCH FROM (ocr_completed_at - ocr_started_at)) as processing_seconds
FROM extraction_queue
WHERE status_id = 5  -- EXTRACTION_COMPLETE
  AND document_source = 'acte'
ORDER BY ocr_completed_at DESC
LIMIT 10;
```

### Check Failed OCR Jobs
```sql
SELECT 
  id,
  document_number,
  document_source,
  ocr_attempts,
  ocr_max_attempts,
  ocr_error,
  ocr_last_error_at
FROM extraction_queue
WHERE document_source = 'acte'
  AND ocr_error IS NOT NULL
ORDER BY ocr_last_error_at DESC
LIMIT 10;
```

### Reset Document for Retry
```sql
UPDATE extraction_queue
SET 
  status_id = 3,
  ocr_attempts = 0,
  ocr_error = NULL,
  ocr_last_error_at = NULL,
  ocr_worker_id = NULL,
  ocr_started_at = NULL,
  ocr_completed_at = NULL
WHERE id = 'document-id-here';
```

---

## Status IDs

| ID | Status | Description |
|----|--------|-------------|
| 3  | COMPLETE | Ready for OCR processing |
| 6  | OCR_PROCESSING | Currently being processed |
| 5  | EXTRACTION_COMPLETE | OCR completed successfully |

---

## Common Issues

### "GEMINI_API_KEY is required"
```bash
export GEMINI_API_KEY=your-api-key-here
```

### "No acte documents found"
Check database for documents with:
- `document_source = 'acte'`
- `status_id = 3`
- `ocr_attempts < ocr_max_attempts`

### "Failed to download PDF"
- Verify `supabase_path` is correct
- Check file exists in `actes` bucket
- Verify Supabase credentials

### "File processing timeout"
- Large PDFs may take longer
- Check Gemini API status
- Increase timeout if needed

### Extraction incomplete (truncated)
- Expected for very large documents
- System retries up to 3 times
- Check for completion markers

---

## Performance Expectations

| Document Size | Upload | Extract | Boost | Total |
|--------------|--------|---------|-------|-------|
| Small (1-5 pages) | 1-2s | 5-10s | 5-10s | 15-25s |
| Medium (5-20 pages) | 2-5s | 10-30s | 10-30s | 30-70s |
| Large (20-50 pages) | 5-10s | 30-60s | 30-60s | 70-140s |
| Very Large (50+ pages) | 10-20s | 60-120s | 60-120s | 140-280s |

---

## File Locations

### Implementation
- `src/ocr/acte-processor.ts` - Main processor
- `src/ocr/gemini-file-client.ts` - File API client
- `src/ocr/prompts-acte.ts` - Extraction and boost prompts
- `src/ocr/monitor.ts` - OCR monitor (supports both index and acte)
- `src/config/index.ts` - Configuration

### Tests
- `validate-acte-ocr-setup.ts` - Setup validation
- `test-acte-ocr.ts` - Standalone OCR test
- `test-acte-ocr-integration.ts` - Integration test
- `run-all-acte-tests.sh` - Complete test suite

### Documentation
- `ACTE_OCR_IMPLEMENTATION.md` - Implementation details
- `ACTE_OCR_QUICKSTART.md` - Quick start guide
- `ACTE_OCR_TESTING.md` - Testing guide
- `ACTE_OCR_TEST_RESULTS.md` - Test results template
- `ACTE_OCR_QUICK_REFERENCE.md` - This file

### Temp Directories
- `/tmp/ocr-acte-processing` - Production temp directory
- `/tmp/test-acte-ocr` - Standalone test temp directory
- `/tmp/test-acte-ocr-integration` - Integration test temp directory

---

## Monitoring

### Check Logs
```bash
# OCR monitor logs
npm run ocr:monitor

# With auto-reload (development)
npm run ocr:dev
```

### Expected Log Output
```
===================================================================
🚀 OCR Monitor Started - Message #1
===================================================================

⚙️  Configuration
   Enabled Environments: dev
   Poll Interval: 10s

===================================================================

===================================================================
📄 OCR Processing Started - Message #2
===================================================================

📋 Document Details
   Document Number: 12345678
   Environment: dev
   Document ID: abc-123-def

===================================================================

📤 Uploading acte PDF to Gemini File API: 12345678
✅ Upload complete (2.3s) - File: files/xyz789, State: ACTIVE
🔍 Extracting text from acte document: 12345678
✅ Extraction complete (15.7s) - 45000 chars, Complete: true
🚀 Applying boost corrections: 12345678
✅ Boost complete (23.4s total) - 47000 chars, Complete: true

===================================================================
✅ OCR Processing Complete - Message #3
===================================================================

📊 Processing Summary
   Document Number: 12345678
   Environment: dev
   Total Pages: 1
   Raw Text: 45,000 chars
   Boosted Text: 47,000 chars
   Total Duration: 23.4s
   Status: ✅ Saved to database

===================================================================
```

---

## Next Steps After Testing

1. **Review Test Results**
   - Check all tests passed
   - Review extraction quality
   - Verify performance metrics

2. **Document Results**
   - Fill out `ACTE_OCR_TEST_RESULTS.md`
   - Note any issues or observations
   - Record performance metrics

3. **Address Issues**
   - Fix any critical issues
   - Document workarounds for known issues
   - Update implementation if needed

4. **Production Deployment**
   - Enable OCR for staging environment
   - Monitor for issues
   - Enable OCR for production when ready
   - Update operational documentation

---

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Review implementation documentation
3. Consult Gemini File API docs: https://ai.google.dev/gemini-api/docs/document-processing
4. Check test results and known issues

---

## Quick Commands Cheat Sheet

```bash
# Validate setup
npm run test:acte:validate

# Test OCR (standalone)
npm run test:acte:standalone

# Test OCR (integration)
npm run test:acte:integration

# Run all tests
npm run test:acte:all

# Run OCR monitor
npm run ocr:monitor

# Build project
npm run build

# Check TypeScript
npm run typecheck

# Lint code
npm run lint
```


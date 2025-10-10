# Acte OCR Implementation Summary

**Date:** 2025-10-10  
**Status:** ✅ Implementation Complete - Ready for Testing

---

## Overview

Implemented a new OCR processing pipeline for acte documents using the Gemini File API. This pipeline processes documents from the `extraction_queue` table where `document_source = 'acte'`, extracting complete text content from both typed and handwritten documents.

---

## Key Features

### 1. **Gemini File API Integration**
- **Direct PDF Processing**: Unlike index documents (which convert PDFs to images), acte documents are uploaded directly to the Gemini File API
- **Resumable Uploads**: Supports large file uploads with automatic retry capability
- **File State Management**: Monitors file processing state (PROCESSING → ACTIVE) before extraction
- **Automatic Cleanup**: Uploaded files are deleted from Gemini after processing

### 2. **Token Limit Handling**
- **Continuation Support**: Implements retry mechanism with continuation prompts for truncated responses
- **Completion Markers**: Uses `✅ EXTRACTION_COMPLETE:` and `✅ BOOST_COMPLETE:` markers to detect truncation
- **Configurable Attempts**: Supports up to 3 retry attempts for both extraction and boost phases
- **Future-Ready**: Architecture supports page-by-page chunking if needed (placeholder in `processActePDFWithChunking`)

### 3. **Queue Management**
Mirrors the existing index OCR pattern with the same tracking fields:
- `status_id`: Transitions through COMPLETE (3) → OCR_PROCESSING (6) → EXTRACTION_COMPLETE (5)
- `ocr_worker_id`: Identifies the worker processing the document
- `ocr_started_at`: Timestamp when OCR begins
- `ocr_completed_at`: Timestamp when OCR completes
- `ocr_attempts`: Number of retry attempts
- `ocr_max_attempts`: Maximum allowed attempts (default: 3)
- `ocr_error`: Error message if processing fails
- `ocr_last_error_at`: Timestamp of last error

### 4. **Dual Processing Modes**
The OCR Monitor now supports both document types:
- **Index Documents**: Uses Vision API with PDF-to-image conversion (existing)
- **Acte Documents**: Uses File API with direct PDF upload (new)
- **Automatic Routing**: Routes documents to appropriate processor based on `document_source`

---

## Architecture

### New Components

#### 1. **GeminiFileClient** (`src/ocr/gemini-file-client.ts`)
- Handles file uploads to Gemini File API
- Monitors file processing status
- Extracts text from uploaded files
- Applies boost corrections
- Manages file cleanup

#### 2. **ActeOCRProcessor** (`src/ocr/acte-processor.ts`)
- Orchestrates the acte OCR workflow
- Manages temporary file storage
- Coordinates upload, extraction, and boost phases
- Implements token limit handling strategy

#### 3. **Acte Prompts** (`src/ocr/prompts-acte.ts`)
- **ACTE_EXTRACT_PROMPT**: Optimized for complete text extraction from acte documents
  - Handles both typed and handwritten text
  - Preserves document structure
  - Captures all critical elements (parties, amounts, dates, descriptions, etc.)
  - Uses confidence markers for uncertain text: `[?]` or `[ILLISIBLE]`
  
- **ACTE_BOOST_PROMPT**: Applies corrections and standardization
  - Fixes common OCR errors
  - Standardizes entity names (banks, government agencies)
  - Formats amounts, dates, and addresses consistently
  - Improves readability with Markdown formatting

#### 4. **Updated OCR Monitor** (`src/ocr/monitor.ts`)
- Now supports both index and acte documents
- Routes to appropriate processor based on `document_source`
- Maintains separate processors for each document type
- Queries for both `document_source IN ('index', 'acte')`

---

## Configuration

### Environment Variables

```bash
# Acte OCR Configuration (uses File API)
ACTE_OCR_EXTRACT_MODEL=gemini-2.0-flash-exp  # Model for text extraction
ACTE_OCR_BOOST_MODEL=gemini-2.5-pro          # Model for boost corrections
ACTE_OCR_EXTRACT_TEMPERATURE=0.1             # Temperature for extraction
ACTE_OCR_BOOST_TEMPERATURE=0.2               # Temperature for boost
```

### Config Structure

```typescript
config.ocr.acte = {
  extractModel: 'gemini-2.0-flash-exp',
  boostModel: 'gemini-2.5-pro',
  extractTemperature: 0.1,
  boostTemperature: 0.2,
}
```

---

## Processing Workflow

### Step-by-Step Process

1. **Document Discovery**
   - Monitor polls `extraction_queue` for documents with:
     - `status_id = 3` (COMPLETE)
     - `document_source = 'acte'`
     - `ocr_attempts < ocr_max_attempts`

2. **Status Update**
   - Update `status_id` to 6 (OCR_PROCESSING)
   - Set `ocr_worker_id`, `ocr_started_at`
   - Increment `ocr_attempts`

3. **File Download**
   - Download PDF from `actes` bucket using `supabase_path`
   - Save to temporary directory

4. **File Upload to Gemini**
   - Upload PDF to Gemini File API
   - Wait for file processing (PROCESSING → ACTIVE)
   - Receive file URI for content generation

5. **Text Extraction**
   - Send extraction prompt with file reference
   - Handle continuation if response is truncated
   - Accumulate complete text with retry logic

6. **Boost Corrections**
   - Apply boost prompt to raw extracted text
   - Standardize entities, formats, and structure
   - Handle continuation if response is truncated

7. **Storage**
   - Store `file_content` (raw text)
   - Store `boosted_file_content` (corrected text)
   - Update `status_id` to 5 (EXTRACTION_COMPLETE)
   - Set `ocr_completed_at`

8. **Cleanup**
   - Delete uploaded file from Gemini File API
   - Remove temporary local file
   - Log completion metrics

---

## Error Handling

### Retry Logic
- **Max Attempts**: 3 attempts per document (configurable via `ocr_max_attempts`)
- **Status Reversion**: On error, reverts `status_id` to 3 (COMPLETE) for retry
- **Error Tracking**: Stores error message in `ocr_error` and timestamp in `ocr_last_error_at`
- **Stale Job Monitoring**: Existing stale OCR monitor will reset stuck jobs

### Error Scenarios
1. **File Upload Failure**: Retries on next poll cycle
2. **File Processing Timeout**: 60-second timeout with 2-second polling
3. **Extraction Truncation**: Up to 3 continuation attempts
4. **Boost Truncation**: Up to 3 continuation attempts
5. **Database Update Failure**: Logs error and reverts status

---

## Logging

### Structured Terminal Logging
Following the established OCR logging pattern:

```
===================================================================
🚀 OCR Monitor Started - Message #1
===================================================================

⚙️  Configuration
   Enabled Environments: dev, staging, prod
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
✅ Upload complete (2.3s) - File: files/xyz789, State: ACTIVE, Size: 1024 KB
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

## Database Schema

### Existing Fields (No Changes Required)
The implementation uses the existing OCR tracking fields added in migration `005_add_ocr_tracking.sql`:

```sql
-- OCR tracking columns (already exist)
ocr_worker_id TEXT
ocr_started_at TIMESTAMPTZ
ocr_completed_at TIMESTAMPTZ
ocr_attempts INTEGER DEFAULT 0
ocr_max_attempts INTEGER DEFAULT 3
ocr_error TEXT
ocr_last_error_at TIMESTAMPTZ

-- Content storage (already exist)
file_content TEXT              -- Raw OCR text
boosted_file_content TEXT      -- Enhanced OCR text
```

### Indexes
Existing indexes support acte OCR:
- `idx_extraction_queue_ocr_ready`: Finds documents ready for OCR (works for both index and acte)
- `idx_extraction_queue_ocr_stuck`: Monitors stuck OCR jobs

---

## Testing Checklist

### Unit Testing
- [ ] Test GeminiFileClient upload functionality
- [ ] Test file status monitoring and waiting
- [ ] Test text extraction with continuation
- [ ] Test boost corrections with continuation
- [ ] Test file cleanup

### Integration Testing
- [ ] Test end-to-end acte OCR flow
- [ ] Test with small acte documents (< 10 pages)
- [ ] Test with large acte documents (> 50 pages)
- [ ] Test with handwritten content
- [ ] Test error handling and retry logic
- [ ] Test concurrent processing of index and acte documents

### Performance Testing
- [ ] Measure processing time for various document sizes
- [ ] Monitor token usage and costs
- [ ] Test token limit handling with very large documents
- [ ] Verify file cleanup (no orphaned files in Gemini)

---

## Next Steps

1. **Testing**: Run comprehensive tests with sample acte documents
2. **Monitoring**: Monitor OCR processing in dev environment
3. **Optimization**: Tune prompts based on initial results
4. **Chunking**: Implement page-by-page chunking if token limits are frequently exceeded
5. **Documentation**: Update operational documentation with acte OCR procedures

---

## Files Created/Modified

### New Files
- `src/ocr/gemini-file-client.ts` - Gemini File API client
- `src/ocr/acte-processor.ts` - Acte OCR processor
- `src/ocr/prompts-acte.ts` - Acte-specific prompts
- `ACTE_OCR_IMPLEMENTATION.md` - This documentation

### Modified Files
- `src/ocr/monitor.ts` - Added acte document support
- `src/ocr/index.ts` - Added new exports
- `src/config/index.ts` - Added acte OCR configuration

---

## References

- **Gemini File API Documentation**: https://ai.google.dev/gemini-api/docs/document-processing
- **Existing Index OCR**: `src/ocr/processor.ts`, `src/ocr/prompts.ts`
- **OCR Tracking Enhancement**: `augment_work_docs/OCR_TRACKING_ENHANCEMENT.md`
- **Migration**: `supabase/migrations/005_add_ocr_tracking.sql`


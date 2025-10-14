# Acte OCR Quick Start Guide

This guide will help you test the new acte OCR pipeline.

---

## Prerequisites

1. **Gemini API Key**: Ensure `GEMINI_API_KEY` is set in your environment
2. **Supabase Access**: Configured access to dev/staging/prod environments
3. **Acte Documents**: At least one acte document in the `extraction_queue` with:
   - `document_source = 'acte'`
   - `status_id = 3` (COMPLETE)
   - Valid `supabase_path` pointing to a PDF in the `actes` bucket

---

## Configuration

### Environment Variables

Add these to your `.env` file (optional - defaults are provided):

```bash
# Acte OCR Configuration
ACTE_OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
ACTE_OCR_BOOST_MODEL=gemini-2.5-pro
ACTE_OCR_EXTRACT_TEMPERATURE=0.1
ACTE_OCR_BOOST_TEMPERATURE=0.2

# OCR Environment Control (enable/disable per environment)
OCR_DEV=true
OCR_STAGING=true
OCR_PROD=false  # Keep disabled in prod until tested
```

---

## Running the OCR Monitor

### Option 1: Run Existing Monitor (Supports Both Index and Acte)

The existing OCR monitor now automatically processes both index and acte documents:

```bash
# Build the project
npm run build

# Run the OCR monitor
npm run ocr:monitor
```

Or directly with ts-node:

```bash
npx ts-node src/ocr/monitor.ts
```

### Option 2: Test with a Specific Document

Create a test script to process a specific acte document:

```typescript
// test-acte-ocr.ts
import { ActeOCRProcessor } from './src/ocr/acte-processor';
import { config } from './src/config';

async function testActeOCR() {
  if (!config.ocr.geminiApiKey) {
    console.error('GEMINI_API_KEY is required');
    process.exit(1);
  }

  const processor = new ActeOCRProcessor({
    geminiApiKey: config.ocr.geminiApiKey,
    extractModel: config.ocr.acte.extractModel,
    boostModel: config.ocr.acte.boostModel,
    extractTemperature: config.ocr.acte.extractTemperature,
    boostTemperature: config.ocr.acte.boostTemperature,
  });

  await processor.initialize();

  try {
    // Replace with your test PDF path
    const pdfPath = '/path/to/test-acte.pdf';
    const documentNumber = 'TEST-12345678';

    console.log('Processing acte document...');
    const result = await processor.processActePDFWithChunking(pdfPath, documentNumber);

    console.log('\n=== RESULTS ===');
    console.log(`Raw Text Length: ${result.rawText.length} chars`);
    console.log(`Boosted Text Length: ${result.boostedText.length} chars`);
    console.log(`Extraction Complete: ${result.extractionComplete}`);
    console.log(`Boost Complete: ${result.boostComplete}`);
    
    console.log('\n=== RAW TEXT (first 500 chars) ===');
    console.log(result.rawText.substring(0, 500));
    
    console.log('\n=== BOOSTED TEXT (first 500 chars) ===');
    console.log(result.boostedText.substring(0, 500));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await processor.cleanup();
  }
}

testActeOCR();
```

Run it:

```bash
npx ts-node test-acte-ocr.ts
```

---

## Monitoring

### Check Queue Status

Query documents ready for acte OCR:

```sql
SELECT 
  id,
  document_number,
  document_source,
  status_id,
  ocr_attempts,
  ocr_max_attempts,
  ocr_started_at,
  ocr_completed_at,
  ocr_error,
  created_at
FROM extraction_queue
WHERE status_id = 3 
  AND document_source = 'acte'
  AND (ocr_attempts IS NULL OR ocr_attempts < ocr_max_attempts)
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

---

## Expected Output

### Console Output

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

### Database Updates

After successful processing, the document should have:
- `status_id = 5` (EXTRACTION_COMPLETE)
- `file_content` populated with raw extracted text
- `boosted_file_content` populated with corrected text
- `ocr_completed_at` timestamp set
- `ocr_error` cleared (NULL)

---

## Troubleshooting

### Issue: "GEMINI_API_KEY is required"
**Solution**: Set the `GEMINI_API_KEY` environment variable

```bash
export GEMINI_API_KEY=your-api-key-here
```

### Issue: "No documents to process"
**Solution**: Ensure you have acte documents with `status_id = 3` and `document_source = 'acte'`

### Issue: "Failed to download PDF from bucket"
**Solution**: 
- Verify the `supabase_path` is correct
- Ensure the file exists in the `actes` bucket
- Check Supabase credentials and permissions

### Issue: "File processing timeout"
**Solution**: 
- Large PDFs may take longer to process
- Increase timeout in `waitForFileProcessing` if needed
- Check Gemini API status

### Issue: Extraction incomplete (truncated)
**Solution**: 
- This is expected for very large documents
- The system will retry up to 3 times with continuation prompts
- If still incomplete, consider implementing page-by-page chunking

### Issue: "boosted_file_content column not found"
**Solution**: 
- Run migration `004_add_boosted_content.sql` if not already applied
- The system will fall back to saving only `file_content`

---

## Performance Expectations

### Processing Times (Approximate)

| Document Size | Upload | Extraction | Boost | Total |
|--------------|--------|------------|-------|-------|
| Small (1-5 pages) | 1-2s | 5-10s | 5-10s | 15-25s |
| Medium (5-20 pages) | 2-5s | 10-30s | 10-30s | 30-70s |
| Large (20-50 pages) | 5-10s | 30-60s | 30-60s | 70-140s |
| Very Large (50+ pages) | 10-20s | 60-120s | 60-120s | 140-280s |

### Token Usage

- **Extraction**: ~1,000-2,000 tokens per page (input + output)
- **Boost**: ~500-1,000 tokens per page (input + output)
- **Total**: ~1,500-3,000 tokens per page

### Cost Estimates (Gemini 2.0 Flash)

- **Small document (5 pages)**: ~$0.01-0.02
- **Medium document (20 pages)**: ~$0.05-0.10
- **Large document (50 pages)**: ~$0.15-0.30

---

## Next Steps

1. **Test with Sample Documents**: Start with small, simple acte documents
2. **Verify Output Quality**: Review extracted text for accuracy
3. **Test Edge Cases**: Try documents with handwritten content, poor quality scans
4. **Monitor Performance**: Track processing times and token usage
5. **Tune Prompts**: Adjust prompts based on results
6. **Scale Testing**: Test with larger batches of documents

---

## Support

For issues or questions:
1. Check the logs for detailed error messages
2. Review `ACTE_OCR_IMPLEMENTATION.md` for architecture details
3. Consult Gemini File API documentation: https://ai.google.dev/gemini-api/docs/document-processing


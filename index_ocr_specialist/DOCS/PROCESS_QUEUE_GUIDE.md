# Process Queue Document - Usage Guide

## Overview

The `process-queue` command allows you to process a specific document from the `extraction_queue` table by its ID. This is useful for:

- **Testing**: Test the pipeline with a specific document
- **Debugging**: Debug issues with a particular document
- **Reprocessing**: Reprocess a document that failed or needs updating
- **Development**: Test changes without waiting for the monitor to pick up documents

---

## Quick Start

```bash
# Process a document from the dev environment
npm run process-queue -- --queue-id 123 --env dev

# Process a document from staging
npm run process-queue -- --queue-id 456 --env staging

# Process a document from production
npm run process-queue -- --queue-id 789 --env prod
```

**Note**: The `--` after `npm run process-queue` is required to pass arguments to the script.

---

## Command Syntax

```bash
npm run process-queue -- --queue-id <id> [--env <environment>]
```

### Required Arguments

- `--queue-id <id>`: The ID of the document in the `extraction_queue` table

### Optional Arguments

- `--env <environment>`: Environment name (default: `dev`)
  - Available: `dev`, `staging`, `prod`

---

## Environment Configuration

⚠️ **Important**: The `index_ocr_specialist` uses the **root `.env` file** (one level up from `index_ocr_specialist/`).

Configure these variables in `/path/to/registre-extractor/.env`:

### Development Environment

```bash
DEV_SUPABASE_URL=https://your-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your-service-role-key
```

### Staging Environment

```bash
STAGING_SUPABASE_URL=https://your-staging-project.supabase.co
STAGING_SUPABASE_SERVICE_KEY=your-staging-service-role-key
```

### Production Environment

```bash
PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_SERVICE_KEY=your-prod-service-role-key
```

See the root `.env.example` file for a complete template.

---

## How It Works

### 1. Fetch Document

The command fetches the document from `extraction_queue`:

```sql
SELECT * FROM extraction_queue WHERE id = <queue-id>
```

### 2. Validate Document

Checks that the document exists and displays its details:

- Document Number
- Document Source (index, acte, plan_cadastraux)
- Status ID
- Worker ID
- Supabase Path
- Created At

### 3. Download PDF

Downloads the PDF from Supabase Storage:

- Determines the correct bucket (`index`, `actes`, `plans-cadastraux`)
- Parses the storage path
- Downloads the file

### 4. Update Status

Updates the document status to PROCESSING (2):

```sql
UPDATE extraction_queue
SET status_id = 2, worker_id = 'cli-<timestamp>'
WHERE id = <queue-id>
```

### 5. Run Pipeline

Runs the complete OCR pipeline:

1. Fetch PDF (already downloaded)
2. Convert PDF → PNG images
3. Upscale images
4. Count lines (Gemini - PARALLEL)
5. Extract text (Gemini - PARALLEL)
6. Verify coherence (Claude)
7. Boost (Claude - PARALLEL)
8. Merge results

### 6. Save Results

Updates the database with results:

```sql
UPDATE extraction_queue
SET 
  status_id = 4,
  worker_id = NULL,
  file_content = <extracted_data>,
  boosted_file_content = <boosted_data>
WHERE id = <queue-id>
```

### 7. Cleanup

- Removes temporary PDF file
- Logs completion

---

## Example Output

```
================================================================================
📋 EXTRACTION QUEUE DOCUMENT PROCESSOR
================================================================================

🌍 Environment: dev
🔗 Supabase URL: https://your-project.supabase.co
🆔 Queue ID: 123

📥 Fetching document from extraction_queue...
✅ Document found!
   Document Number: 2024-001234
   Document Source: index
   Status ID: 3
   Worker ID: null
   Supabase Path: index/2024/document.pdf
   Created At: 2024-10-14T10:30:00.000Z

📦 Storage Details:
   Bucket: index
   Path: 2024/document.pdf

📥 Downloading PDF from storage...
✅ PDF downloaded successfully (245.67 KB)

💾 Temporary PDF saved to: /tmp/queue-123-1697280000000.pdf

🔄 Updating status to PROCESSING (2)...
✅ Status updated to PROCESSING

================================================================================
🚀 STARTING OCR PIPELINE
================================================================================

[Pipeline logs...]

================================================================================
✅ PIPELINE COMPLETED SUCCESSFULLY
================================================================================

📊 Results:
   Total Pages: 10
   Total Lines: 450
   Artifacts: artifacts/queue-123-1697280000000

💾 Updating extraction_queue with results...
✅ Results saved to database

🗑️  Temporary file cleaned up

✅ Document processed successfully!
```

---

## Error Handling

### Document Not Found

```
❌ Processing failed: Failed to fetch document: Document not found
```

**Solution**: Verify the queue ID exists in the database.

### Invalid Environment

```
❌ Processing failed: Invalid environment: invalid. Available: dev, staging, prod
```

**Solution**: Use one of the valid environment names.

### Download Failed

```
❌ Processing failed: Failed to download PDF: Object not found
```

**Solution**: 
- Verify the `supabase_path` is correct
- Check that the file exists in Supabase Storage
- Verify bucket permissions

### Pipeline Failed

If the pipeline fails, the document status is reset to COMPLETE (3) so it can be retried:

```sql
UPDATE extraction_queue
SET status_id = 3, worker_id = NULL
WHERE id = <queue-id>
```

---

## Finding Queue IDs

### Using Supabase Dashboard

1. Go to your Supabase project
2. Navigate to Table Editor
3. Open the `extraction_queue` table
4. Find the document you want to process
5. Copy the `id` value

### Using SQL

```sql
-- Find documents ready for processing
SELECT id, document_number, document_source, status_id, created_at
FROM extraction_queue
WHERE status_id = 3
ORDER BY created_at DESC
LIMIT 10;

-- Find a specific document by number
SELECT id, document_number, document_source, status_id
FROM extraction_queue
WHERE document_number = '2024-001234';

-- Find failed documents
SELECT id, document_number, document_source, status_id, error_message
FROM extraction_queue
WHERE status_id = 5
ORDER BY created_at DESC;
```

---

## Status Codes Reference

| Status ID | Meaning | Description |
|-----------|---------|-------------|
| 1 | PENDING | Initial upload, not ready for OCR |
| 2 | PROCESSING | OCR in progress |
| 3 | COMPLETE | Ready for OCR (or OCR not started) |
| 4 | COMPLETE | OCR completed successfully |
| 5 | ERROR | OCR failed |

---

## Tips & Best Practices

### 1. Test with Small Documents First

Start with a small document (1-5 pages) to verify the pipeline works before processing large documents.

### 2. Check Logs

The pipeline creates detailed logs in `artifacts/queue-<id>-<timestamp>/`:

- `run.log`: Complete execution log
- `document.json`: Extracted data
- `summary.txt`: Summary report

### 3. Monitor Progress

The command shows real-time progress:

- Stage completion
- Page processing
- Token usage
- Timing information

### 4. Reprocess Failed Documents

If a document fails, fix the issue and reprocess:

```bash
# Reset status to 3 if needed
UPDATE extraction_queue SET status_id = 3, worker_id = NULL WHERE id = 123;

# Reprocess
npm run process-queue -- --queue-id 123 --env dev
```

### 5. Compare Environments

Process the same document in different environments to compare results:

```bash
npm run process-queue -- --queue-id 123 --env dev
npm run process-queue -- --queue-id 456 --env staging  # Same document in staging
```

---

## Troubleshooting

### "No such file or directory" Error

**Cause**: Missing environment variables

**Solution**: Ensure `.env` file has the required Supabase credentials

### "Permission denied" Error

**Cause**: Service role key doesn't have sufficient permissions

**Solution**: Verify you're using the service role key, not the anon key

### "Rate limit exceeded" Error

**Cause**: Too many API requests

**Solution**: Wait a few minutes and try again, or reduce concurrency in `config/rate-limits.ts`

### Pipeline Hangs

**Cause**: Network issues or API timeout

**Solution**: 
- Check internet connection
- Verify API keys are valid
- Check Gemini/Claude API status

---

## Related Commands

```bash
# Run pipeline with custom PDF URL
npm run dev -- --url "https://example.com/doc.pdf"

# Run end-to-end test
npm run test:e2e:gemini

# Analyze throughput configuration
npm run analyze-throughput

# Build for production
npm run build
```

---

## References

- **Implementation**: `src/server/process-queue.ts`
- **CLI**: `src/server/cli.ts`
- **Pipeline**: `src/server/pipeline.ts`
- **Architecture**: `docs/ARCHITECTURE.md`
- **Quick Reference**: `docs/QUICK_REFERENCE.md`


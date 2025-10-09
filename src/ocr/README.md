# OCR Module for Quebec Land Registry Index Documents

This module provides automated OCR (Optical Character Recognition) processing for Quebec land registry index documents using Google's Gemini AI with specialized prompts and 60+ domain-specific correction rules.

## 🎯 Overview

The OCR module automatically processes completed index document extractions by:

1. **Monitoring** the `extraction_queue` table for documents with `status_id=3` (Complété) and `document_source='index'`
2. **Converting** PDF documents to high-resolution images
3. **Extracting** text using Gemini Vision AI with specialized prompts
4. **Boosting** the extracted text with 60+ correction rules specific to Quebec land registry documents
5. **Storing** the final boosted text in the `file_content` column
6. **Updating** the status to `status_id=5` (Extraction Complété)

### ⚡ Parallel Processing

The module now supports **parallel processing** for multi-page PDFs, providing significant performance improvements:

- **~5x faster** for multi-page documents
- All pages converted, extracted, and boosted **simultaneously**
- Backward compatible with existing single-page processing

See [PARALLEL_PROCESSING.md](./PARALLEL_PROCESSING.md) for detailed documentation.

## 🏗️ Architecture

```
src/ocr/
├── monitor.ts                      # Main OCR monitor service
├── processor.ts                    # OCR processing orchestrator (with parallel support)
├── gemini-client.ts                # Gemini AI client wrapper
├── pdf-converter.ts                # PDF to image conversion (with multi-page support)
├── prompts.ts                      # Extraction and boost prompts
├── index.ts                        # Module exports
├── README.md                       # This file
├── PARALLEL_PROCESSING.md          # Parallel processing documentation
└── examples/
    └── parallel-processing-example.ts  # Usage examples
```

## 🚀 Quick Start

### Prerequisites

1. **Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. **ImageMagick or Poppler**: For PDF to image conversion
   ```bash
   # macOS
   brew install imagemagick poppler
   
   # Ubuntu/Debian
   sudo apt-get install imagemagick poppler-utils
   
   # CentOS/RHEL
   sudo yum install ImageMagick poppler-utils
   ```

### Configuration

Add to your `.env` file:

```env
# Required
GEMINI_API_KEY=your-gemini-api-key

# Optional (defaults shown)
OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
OCR_BOOST_MODEL=gemini-2.5-pro
OCR_EXTRACT_TEMPERATURE=0.1
OCR_BOOST_TEMPERATURE=0.2
OCR_POLL_INTERVAL_MS=10000
OCR_TEMP_DIR=/tmp/ocr-processing
```

### Running the OCR Monitor

```bash
# Development mode (with auto-reload)
npm run ocr:dev

# Production mode
npm run ocr
```

## 📊 How It Works

### 1. Document Monitoring

The monitor polls the database every 10 seconds (configurable) looking for documents that meet these criteria:

- `status_id = 3` (Complété - extraction completed)
- `document_source = 'index'` (index documents only)
- `file_content IS NULL` (not yet OCR processed)

### 2. PDF Processing

When a document is found:

1. **Download**: Fetch the PDF from Supabase storage using `supabase_path`
2. **Convert**: Convert the first page to a high-resolution PNG image (300 DPI)
3. **Encode**: Convert the image to base64 for Gemini API

### 3. Text Extraction

The extraction phase uses a specialized prompt that:

- Analyzes document structure and quality
- Extracts data line-by-line with confidence scores
- Provides multiple options for ambiguous characters
- Focuses on critical fields (publication numbers, dates, parties, nature of act)
- Ensures complete extraction with retry logic

### 4. Text Boosting

The boost phase applies 60+ correction rules including:

**Utilities & Infrastructure**
- Hydro-Québec servitude detection
- Ministry of Transport corrections
- Railway company standardization

**Banking & Finance**
- Bank name standardization (RBC, TD, BMO, etc.)
- Hypothèque vs. Quittance disambiguation
- Mortgage amount validation

**Public Organizations**
- Municipality name corrections
- School board standardization
- Conservation organization detection

**Semantic Validation**
- Cross-column validation
- Party role disambiguation
- Temporal consistency checks
- Low OCR signal fallbacks

### 5. Database Update

After successful processing:

```sql
UPDATE extraction_queue
SET 
  file_content = '<boosted_text>',
  status_id = 5,  -- EXTRACTION_COMPLETE
  updated_at = NOW()
WHERE id = '<document_id>';
```

## 🔧 API Reference

### OCRMonitor

Main service that monitors and processes documents.

```typescript
import { OCRMonitor } from './ocr';

const monitor = new OCRMonitor({
  geminiApiKey: 'your-api-key',
  pollIntervalMs: 10000,
  tempDir: '/tmp/ocr-processing'
});

await monitor.initialize();
await monitor.start();

// Later...
await monitor.stop();
```

### OCRProcessor

Handles the actual OCR processing.

```typescript
import { OCRProcessor } from './ocr';

const processor = new OCRProcessor({
  geminiApiKey: 'your-api-key',
  extractModel: 'gemini-2.0-flash-exp',
  boostModel: 'gemini-2.5-pro',
  extractTemperature: 0.1,
  boostTemperature: 0.2
});

await processor.initialize();

// Process from URL
const result = await processor.processPDFFromURL('https://...');

// Process from local file
const result = await processor.processPDF('/path/to/file.pdf');

// Process from base64
const result = await processor.processPDFFromBase64('base64data...');
```

### GeminiOCRClient

Low-level Gemini API client.

```typescript
import { GeminiOCRClient } from './ocr';

const client = new GeminiOCRClient({
  apiKey: 'your-api-key',
  model: 'gemini-2.0-flash-exp',
  temperature: 0.1
});

// Extract text from image
const extraction = await client.extractText(
  base64ImageData,
  'image/png',
  EXTRACT_PROMPT
);

// Boost text
const boost = await client.boostText(
  rawText,
  BOOST_PROMPT
);
```

## 📈 Monitoring & Logging

The OCR module uses the application's logger (Pino) with structured logging:

```typescript
// Success
logger.info({
  documentId: '...',
  documentNumber: '...',
  textLength: 1234,
  extractionComplete: true,
  boostComplete: true
}, 'OCR processing completed successfully');

// Error
logger.error({
  error: 'Error message',
  documentId: '...',
  documentNumber: '...'
}, 'OCR processing failed for document');
```

## 🐛 Troubleshooting

### ImageMagick Not Found

**Error**: `Failed to convert PDF to image`

**Solution**: Install ImageMagick or poppler-utils:
```bash
brew install imagemagick poppler  # macOS
```

### Gemini API Rate Limits

**Error**: `429 Too Many Requests`

**Solution**: 
- Increase `OCR_POLL_INTERVAL_MS` to reduce request frequency
- Use a higher-tier Gemini API plan
- Implement exponential backoff (already built-in with retry logic)

### Incomplete Extractions

**Error**: Response truncated warnings in logs

**Solution**:
- The system automatically retries up to 3 times
- Consider using `gemini-2.5-pro` for extraction (higher token limit)
- Check if documents are exceptionally large

### Memory Issues

**Error**: Out of memory errors

**Solution**:
- Reduce image DPI in `pdf-converter.ts` (default: 300)
- Ensure temp directory has sufficient space
- Monitor and clean up temp files regularly

## 🔒 Security Considerations

1. **API Keys**: Never commit `.env` files. Use environment variables in production.
2. **Temp Files**: Automatically cleaned up after processing. Ensure `/tmp` has proper permissions.
3. **Database Access**: Uses service role keys for database operations. Ensure proper RLS policies.

## 📝 Database Schema

The OCR module requires these columns in `extraction_queue`:

```sql
-- OCR result storage
file_content TEXT,

-- Optional: for full-text search
searchable_file_content TEXT,

-- Optional: for Claude API integration
claude_file_id TEXT,
file_id_active BOOLEAN DEFAULT false
```

Run the migration:
```bash
# Apply migration to Supabase
supabase db push
```

## 🎯 Performance

- **Processing Time**: ~10-30 seconds per document (depending on complexity)
- **Accuracy**: 95%+ for high-quality scans
- **Throughput**: ~200-300 documents/hour (with default settings)

## 📚 References

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Quebec Land Registry](https://www.registrefoncier.gouv.qc.ca/)
- [ImageMagick Documentation](https://imagemagick.org/index.php)


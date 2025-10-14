# Index OCR Specialist - Architecture Overview

## Table of Contents
1. [System Overview](#system-overview)
2. [Trigger Mechanism](#trigger-mechanism)
3. [Document Management](#document-management)
4. [Pipeline Stages](#pipeline-stages)
5. [Prompt System](#prompt-system)
6. [Parallel Processing](#parallel-processing)
7. [Error Handling](#error-handling)

---

## System Overview

The Index OCR Specialist is a **Supabase Edge Function** that processes Quebec Land Registry index documents using a multi-model AI pipeline.

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                    OCR Monitor (Polling)                     │
│  - Polls extraction_queue every 5-10 seconds                │
│  - Checks multiple Supabase environments                    │
│  - Claims documents atomically with worker_id               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                     │
│  - Coordinates 8 stages of processing                       │
│  - Manages parallel execution                               │
│  - Handles errors and retries                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Multi-Model AI Clients                    │
│  - Gemini 2.5 Pro (line counting, extraction)              │
│  - Claude Sonnet 3.5 (verification, boost)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Database Update                           │
│  - Stores extracted data in file_content                    │
│  - Stores boosted data in boosted_file_content             │
│  - Updates status to COMPLETE (4)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Trigger Mechanism

### Polling-Based Architecture

**No database triggers** - Uses continuous polling instead:

```typescript
// src/ocr/monitor.ts
async start(): Promise<void> {
  this.isRunning = true;
  this.poll(); // Start polling loop
}

private async poll(): Promise<void> {
  try {
    await this.processNextDocument();
  } catch (error) {
    logger.error(error, 'Error in OCR monitor poll');
  }
  
  // Schedule next poll
  this.pollTimeout = setTimeout(() => this.poll(), this.pollIntervalMs);
}
```

### Configuration

- **Default Interval**: 5-10 seconds (configurable via `pollIntervalMs`)
- **Multi-Environment**: Checks all configured Supabase environments
- **Worker-Based**: Each worker has a unique `workerId` for distributed processing

### Document Selection Query

```typescript
const { data: documents, error } = await client
  .from('extraction_queue')
  .select('*')
  .eq('status_id', EXTRACTION_STATUS.COMPLETE)  // status_id = 3
  .in('document_source', ['index', 'acte'])
  .is('worker_id', null)                        // Not claimed by another worker
  .order('created_at', { ascending: true })
  .limit(1);
```

### Atomic Document Claiming

```typescript
const { data: claimed, error: claimError } = await client
  .from('extraction_queue')
  .update({ 
    worker_id: this.workerId,
    status_id: EXTRACTION_STATUS.PROCESSING  // status_id = 2
  })
  .eq('id', document.id)
  .is('worker_id', null)  // Only claim if still unclaimed
  .select()
  .single();
```

**Key Point**: The `is('worker_id', null)` condition ensures only one worker can claim a document, preventing race conditions.

---

## Document Management

### Document Lifecycle

```
┌──────────────┐
│   PENDING    │  status_id = 1 (initial upload)
└──────┬───────┘
       ↓
┌──────────────┐
│   COMPLETE   │  status_id = 3 (ready for OCR)
└──────┬───────┘
       ↓ (claimed by worker)
┌──────────────┐
│  PROCESSING  │  status_id = 2 (OCR in progress)
└──────┬───────┘
       ↓ (OCR complete)
┌──────────────┐
│   COMPLETE   │  status_id = 4 (OCR done)
└──────────────┘
```

### Document Storage

Documents are stored in **Supabase Storage**:

```typescript
// Download from storage
const { data: fileData, error: downloadError } = await client.storage
  .from('documents')
  .download(document.supabase_path);

// Convert to buffer
const arrayBuffer = await fileData.arrayBuffer();
const pdfBuffer = Buffer.from(arrayBuffer);
```

### Document Fields

- `id`: Unique identifier
- `supabase_path`: Path in Supabase Storage (e.g., `index/2024/document.pdf`)
- `document_source`: Type of document (`index` or `acte`)
- `status_id`: Current processing status
- `worker_id`: ID of worker processing this document
- `file_content`: Extracted data (JSON)
- `boosted_file_content`: Boosted data (JSON)
- `created_at`: Upload timestamp

---

## Pipeline Stages

### Complete Pipeline Flow

```
1. Fetch PDF from Supabase Storage
   ↓
2. Convert PDF to PNG images (one per page)
   ↓
3. Upscale images for better OCR quality
   ↓
4. Count lines per page (Gemini - PARALLEL)
   ↓
5. Extract text from each page (Gemini - PARALLEL)
   ↓
6. Verify extraction coherence (Claude)
   ↓
7. Boost extraction with confidence scores (Claude - PARALLEL)
   ↓
8. Merge all pages and update database
```

### Stage Details

#### Stage 1-3: PDF Processing
- **Library**: `pdf-to-png-converter`
- **Upscaling**: Sharp library with Lanczos3 algorithm
- **Output**: High-quality PNG images per page

#### Stage 4: Line Counting (PARALLEL)
- **Model**: Gemini 2.5 Pro
- **Concurrency**: 10 pages at once
- **Stagger**: 500ms between starts
- **Purpose**: Determine how many lines to extract per page
- **Output**: `LineCountConsensus[]`

#### Stage 5: Text Extraction (PARALLEL)
- **Model**: Gemini 2.5 Pro
- **Concurrency**: 6 pages at once
- **Stagger**: 2 seconds between starts
- **Strategy**: Single-pass extraction (no windowing)
- **Max Output**: 65,536 tokens
- **Output**: `PageExtraction[]` with `ExtractedLine[]`

#### Stage 6: Coherence Check
- **Model**: Claude Sonnet 3.5
- **Purpose**: Verify extraction makes sense
- **Checks**: Field consistency, data validity
- **Output**: Validation report

#### Stage 7: Boost (PARALLEL)
- **Model**: Claude Sonnet 3.5
- **Concurrency**: 5 pages at once
- **Stagger**: 1 second between starts
- **Purpose**: Add confidence scores, normalize fields
- **Output**: `BoostResult[]` with improved `ExtractedLine[]`

#### Stage 8: Merge & Update
- **Combines**: All page results into single document
- **Stores**: Both original and boosted data
- **Updates**: Database status to COMPLETE (4)

---

## Prompt System

### Prompt Structure

Prompts are stored in `prompts/prompts-unified.js`:

```javascript
export const PROMPTS = {
  lineCount: {
    gemini: "Count the number of lines in this index page...",
    claude: "Count the number of lines in this index page..."
  },
  extract: {
    gemini: "Extract all lines from this index page...",
    continue: "Continue extraction from line [[NEXT_LINE]]..."
  },
  verify: {
    claude: "Verify the coherence of this extraction..."
  },
  boost: {
    claude: "Add confidence scores and normalize fields..."
  }
};
```

### Prompt Variables

Prompts support variable substitution:

- `[[TOTAL_LINES]]`: Total lines detected
- `[[LINES_DONE]]`: Lines already extracted
- `[[NEXT_LINE]]`: Next line to extract
- `[[PAGE_NUMBER]]`: Current page number

### Prompt Loading

```typescript
// Load prompts at runtime
const prompts = await loadPrompts();

// Use in pipeline
const extraction = await extractPageText(
  page,
  lineCount,
  prompts.extract.gemini,
  prompts.extract.continue,
  'gemini',
  logger
);
```

---

## Parallel Processing

### Rate Limit Configuration

See [PARALLEL_PROCESSING.md](./PARALLEL_PROCESSING.md) for full details.

**Summary**:
- **Line Counting**: 10 concurrent, 500ms stagger (240 pages/min)
- **Text Extraction**: 6 concurrent, 2s stagger (24 pages/min)
- **Boost**: 5 concurrent, 1s stagger (37.5 pages/min)

### Parallel Utility

```typescript
const results = await processInParallel(
  items,
  processor,
  logger,
  'operation_name',
  {
    maxConcurrency: 6,
    apiDelayMs: 2000,
    retryOptions: {
      maxAttempts: 3,
      baseDelayMs: 5000,
      maxDelayMs: 30000
    }
  }
);
```

---

## Error Handling

### Retry Strategy

All API calls use exponential backoff retry:

```typescript
retryOptions: {
  maxAttempts: 3,              // Retry up to 3 times
  baseDelayMs: 5000,           // Start with 5 second delay
  maxDelayMs: 30000,           // Max 30 second delay
  retryableErrors: [
    '503',                     // Service unavailable
    '429',                     // Rate limit exceeded
    'timeout',                 // Request timeout
    'deadline',                // Deadline exceeded
    'service unavailable'      // Generic service error
  ]
}
```

### Error Recovery

1. **Transient Errors**: Automatic retry with exponential backoff
2. **Rate Limits**: Retry with longer delays
3. **Permanent Errors**: Log and continue with next item
4. **Partial Failures**: Continue processing other pages

### Logging

All operations are logged with:
- Operation name
- Page number
- Duration
- Success/failure status
- Error details (if failed)
- Retry attempts

---

## Performance Characteristics

### Throughput

- **Small documents (1-5 pages)**: ~0.5 minutes
- **Medium documents (6-20 pages)**: ~1-2 minutes
- **Large documents (21-50 pages)**: ~3-5 minutes

### Resource Usage

- **Memory**: ~500MB per worker
- **CPU**: Minimal (mostly I/O bound)
- **Network**: High (large image uploads to APIs)

### Scalability

- **Horizontal**: Multiple workers can run in parallel
- **Vertical**: Limited by API rate limits, not compute
- **Bottleneck**: API rate limits (especially Claude OTPM)

---

## Configuration Files

- `config/rate-limits.ts`: Rate limit configuration
- `config/runtime.ts`: Runtime configuration
- `prompts/prompts-unified.js`: AI prompts
- `.env`: Environment variables (API keys, Supabase URLs)

---

## Monitoring & Debugging

### Logs

All logs include:
- Timestamp
- Operation name
- Page number
- Duration
- Metadata (concurrency, tokens, etc.)

### Metrics

Track:
- Pages processed per minute
- API requests per second
- Token usage
- Error rates
- Retry counts

### Tools

- `npm run analyze-throughput`: Analyze rate limit configuration
- `npm run dev`: Run in development mode with verbose logging
- `npm run test:e2e:gemini`: End-to-end test with Gemini

---

## References

- **Main Pipeline**: `src/server/pipeline.ts`
- **OCR Monitor**: `src/ocr/monitor.ts`
- **Parallel Processing**: [PARALLEL_PROCESSING.md](./PARALLEL_PROCESSING.md)
- **Gemini Client**: `src/clients/gemini.ts`
- **Claude Client**: `src/clients/claude.ts`


# Alternative OCR Triggering Methods

## Current Implementation: Polling

The OCR Monitor currently uses **polling** (checks database every 10 seconds).

**Pros**:
- Simple to implement
- No additional infrastructure
- Works across all environments

**Cons**:
- 10-second delay before processing starts
- Continuous database queries (even when idle)
- Requires separate process to be running

---

## Alternative 1: Supabase Database Webhooks (Recommended)

Use Supabase's built-in webhook functionality to trigger OCR processing when a document is completed.

### Setup

1. **Create a webhook endpoint** in your API:

```typescript
// src/api/webhooks/ocr-trigger.ts
import { Request, Response } from 'express';
import { OCRProcessor } from '../../ocr/processor';
import { supabaseManager } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export async function handleOCRTrigger(req: Request, res: Response) {
  // Verify webhook signature (important for security)
  const signature = req.headers['x-supabase-signature'];
  // TODO: Verify signature
  
  const { record, old_record } = req.body;
  
  // Check if this is a newly completed extraction
  if (
    record.status_id === 3 &&
    record.document_source === 'index' &&
    record.supabase_path &&
    !record.file_content &&
    old_record.status_id !== 3
  ) {
    logger.info({ documentId: record.id }, 'Webhook triggered OCR processing');
    
    // Process OCR asynchronously (don't block webhook response)
    processOCRAsync(record).catch(err => {
      logger.error({ error: err, documentId: record.id }, 'OCR processing failed');
    });
    
    res.status(200).json({ message: 'OCR processing triggered' });
  } else {
    res.status(200).json({ message: 'No action needed' });
  }
}

async function processOCRAsync(document: any) {
  const processor = new OCRProcessor({
    geminiApiKey: config.ocr.geminiApiKey!,
  });
  
  await processor.initialize();
  
  // Download PDF, process OCR, update database
  // (similar to OCR Monitor logic)
  
  await processor.cleanup();
}
```

2. **Add webhook route** to your API:

```typescript
// src/api/index.ts
import { handleOCRTrigger } from './webhooks/ocr-trigger';

app.post('/webhooks/ocr-trigger', handleOCRTrigger);
```

3. **Configure Supabase webhook**:

```sql
-- In Supabase SQL Editor
CREATE OR REPLACE FUNCTION notify_ocr_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for index documents that just became complete
  IF NEW.status_id = 3 
     AND NEW.document_source = 'index' 
     AND NEW.supabase_path IS NOT NULL
     AND NEW.file_content IS NULL
     AND (OLD.status_id IS NULL OR OLD.status_id != 3) THEN
    
    PERFORM net.http_post(
      url := 'https://your-api-url.com/webhooks/ocr-trigger',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-supabase-signature', 'your-secret-key'
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ocr_trigger_webhook
AFTER INSERT OR UPDATE ON extraction_queue
FOR EACH ROW
EXECUTE FUNCTION notify_ocr_trigger();
```

**Pros**:
- Instant triggering (no polling delay)
- No continuous database queries
- Scales automatically

**Cons**:
- Requires public API endpoint
- Need to handle webhook security
- More complex setup

---

## Alternative 2: Supabase Edge Functions

Use Supabase Edge Functions (Deno) to process OCR directly in Supabase.

### Setup

1. **Create Edge Function**:

```typescript
// supabase/functions/ocr-processor/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const { record } = await req.json()
  
  // Process OCR using Gemini API
  // Update database with results
  
  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
```

2. **Trigger from database**:

```sql
CREATE TRIGGER ocr_edge_function_trigger
AFTER UPDATE ON extraction_queue
FOR EACH ROW
WHEN (NEW.status_id = 3 AND NEW.document_source = 'index')
EXECUTE FUNCTION supabase_functions.http_request(
  'ocr-processor',
  'POST',
  '{"record": NEW}'
);
```

**Pros**:
- Runs in Supabase (no external infrastructure)
- Instant triggering
- Scales automatically

**Cons**:
- Limited to Deno runtime
- May have cold start delays
- More expensive than self-hosted

---

## Alternative 3: Integrate into Extraction Worker

Modify the extraction worker to trigger OCR processing directly after extraction.

### Implementation

```typescript
// src/worker/index.ts
import { OCRProcessor } from '../ocr/processor';

class ExtractionWorker {
  private ocrProcessor?: OCRProcessor;
  
  async initialize() {
    // Initialize OCR processor if enabled
    if (config.ocr.enabled && config.ocr.geminiApiKey) {
      this.ocrProcessor = new OCRProcessor({
        geminiApiKey: config.ocr.geminiApiKey,
      });
      await this.ocrProcessor.initialize();
    }
  }
  
  async processJob(job: ExtractionQueueJob) {
    // ... existing extraction logic ...
    
    // Update job as completed
    await client
      .from('extraction_queue')
      .update({
        status_id: EXTRACTION_STATUS.COMPLETE,
        supabase_path: publicUrl,
      })
      .eq('id', job.id);
    
    // Trigger OCR processing if enabled and applicable
    if (
      this.ocrProcessor &&
      job.document_source === 'index' &&
      publicUrl
    ) {
      logger.info({ jobId: job.id }, 'Triggering OCR processing');
      
      // Process OCR asynchronously (don't block worker)
      this.processOCRAsync(job.id, publicUrl).catch(err => {
        logger.error({ error: err, jobId: job.id }, 'OCR processing failed');
      });
    }
  }
  
  private async processOCRAsync(jobId: string, pdfUrl: string) {
    try {
      const result = await this.ocrProcessor!.processPDFFromURL(pdfUrl);
      
      await client
        .from('extraction_queue')
        .update({
          file_content: result.rawText,
          boosted_file_content: result.boostedText,
          status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
        })
        .eq('id', jobId);
        
      logger.info({ jobId }, 'OCR processing completed');
    } catch (error) {
      logger.error({ error, jobId }, 'OCR processing failed');
    }
  }
}
```

**Pros**:
- Single service to manage
- Immediate processing after extraction
- Simpler deployment

**Cons**:
- Couples extraction and OCR (violates separation of concerns)
- Cannot scale independently
- Extraction worker becomes heavier (more RAM/CPU needed)
- OCR failures could affect extraction

---

## Alternative 4: Message Queue (Redis/Bull)

Use a proper message queue to trigger OCR processing.

### Setup

```typescript
// src/worker/index.ts
import Bull from 'bull';

const ocrQueue = new Bull('ocr-processing', {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
  }
});

// After extraction completes
await ocrQueue.add({
  jobId: job.id,
  documentSource: job.document_source,
  supabasePath: publicUrl,
});
```

```typescript
// src/ocr/worker.ts
import Bull from 'bull';

const ocrQueue = new Bull('ocr-processing', {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
  }
});

ocrQueue.process(async (job) => {
  const { jobId, supabasePath } = job.data;
  
  // Process OCR
  const processor = new OCRProcessor({
    geminiApiKey: config.ocr.geminiApiKey!,
  });
  
  await processor.initialize();
  const result = await processor.processPDFFromURL(supabasePath);
  
  // Update database
  await client
    .from('extraction_queue')
    .update({
      file_content: result.rawText,
      boosted_file_content: result.boostedText,
      status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
    })
    .eq('id', jobId);
});
```

**Pros**:
- Proper message queue architecture
- Reliable delivery
- Can handle retries, priorities, etc.
- Scales well

**Cons**:
- Requires Redis infrastructure
- More complex setup
- Additional dependency

---

## Recommendation

For your use case, I recommend **keeping the current polling approach** because:

1. ✅ **Simple**: No additional infrastructure needed
2. ✅ **Reliable**: Database is the source of truth
3. ✅ **Flexible**: Easy to start/stop OCR processing
4. ✅ **Debuggable**: Clear separation of concerns

The 10-second polling delay is acceptable for most use cases. If you need faster processing, you can:
- Reduce `OCR_POLL_INTERVAL_MS` to 5000 (5 seconds) or even 2000 (2 seconds)
- The database can easily handle the extra queries

### When to Consider Alternatives

- **Webhooks**: If you need instant processing (<1 second latency)
- **Message Queue**: If you're already using Redis for other purposes
- **Integrated**: If you only ever run 1 extraction worker and 1 OCR worker
- **Edge Functions**: If you want to minimize infrastructure management

---

## Current Configuration

To adjust polling interval:

```bash
# .env
OCR_POLL_INTERVAL_MS=10000  # Default: 10 seconds
# Change to 5000 for 5 seconds, 2000 for 2 seconds, etc.
```

The current polling approach is production-ready and works well for most scenarios!


# Architecture Decision: Post-Processing Workflow

## Decision Summary

**Decision**: Use a **separate dedicated OCR worker** for post-processing, rather than integrating post-processing into the existing extraction workers.

**Status**: ✅ Implemented (OCR Monitor service)

**Date**: 2025-10-09

---

## Context

The registre-extractor system needs to perform OCR (Optical Character Recognition) on successfully extracted PDF documents from the Quebec Land Registry. The question was whether to:

**Option A**: Integrate OCR processing into existing extraction workers  
**Option B**: Create a separate dedicated OCR worker service

## Decision

We chose **Option B: Separate Dedicated OCR Worker** (OCR Monitor service)

## Rationale

### 1. Separation of Concerns

**Extraction Workers**:
- Responsibility: Web scraping and PDF extraction from Quebec Land Registry
- Technology: Playwright browser automation, AgentQL AI navigation
- Resource Profile: I/O-bound, network-intensive
- Failure Modes: Login issues, website changes, network timeouts

**OCR Workers**:
- Responsibility: Text extraction and enhancement from PDFs
- Technology: Gemini Vision AI, ImageMagick, PDF processing
- Resource Profile: CPU-bound, API-intensive
- Failure Modes: API rate limits, image conversion errors, AI model issues

These are fundamentally different concerns that should not be coupled.

### 2. Independent Scalability

With separate workers, we can:
- Scale extraction workers based on website scraping demand
- Scale OCR workers based on OCR processing backlog
- Optimize resource allocation independently

**Example Scenario**:
- High extraction demand → Add more extraction workers
- OCR backlog → Add more OCR workers
- Different scaling patterns don't interfere with each other

### 3. Resource Management

**Extraction Worker Resources**:
- 2-4 GB RAM (browser instances)
- 2-4 CPU cores (browser rendering)
- Persistent browser sessions
- Network bandwidth

**OCR Worker Resources**:
- 1-2 GB RAM (image processing)
- 1-2 CPU cores (PDF conversion)
- Temporary file storage
- API quota management

Combining these would require:
- 4-6 GB RAM per worker (inefficient)
- Complex resource sharing logic
- Potential resource contention

### 4. Failure Isolation

**Benefits**:
- Extraction failures don't affect OCR processing
- OCR failures don't affect extraction pipeline
- Can restart services independently
- Easier debugging and monitoring

**Example**:
- If Gemini API goes down → OCR queue builds up, but extraction continues
- If Quebec Land Registry website is down → Extraction pauses, but OCR continues processing backlog

### 5. Different Dependencies

**Extraction Dependencies**:
```
- Playwright
- AgentQL
- Browser binaries
- OpenAI API (for fuzzy matching)
```

**OCR Dependencies**:
```
- Google Gemini AI
- ImageMagick
- Poppler (PDF tools)
- PDF processing libraries
```

Separating these:
- Reduces Docker image size
- Simplifies dependency management
- Allows different update cycles

### 6. Queue-Based Architecture

Both services use the same `extraction_queue` table as a message queue:

```
Extraction Worker:
  Poll for status_id = 1 (EN_ATTENTE)
  ↓
  Process extraction
  ↓
  Update to status_id = 3 (COMPLETE)

OCR Worker:
  Poll for status_id = 3 AND document_source = 'index' AND file_content IS NULL
  ↓
  Process OCR
  ↓
  Update to status_id = 5 (EXTRACTION_COMPLETE)
```

This provides:
- Natural decoupling
- Automatic retry on failure
- Clear status tracking
- Easy monitoring

### 7. Deployment Flexibility

Separate workers allow:
- Different deployment strategies (e.g., extraction on-premise, OCR in cloud)
- Different scaling policies
- Different resource limits
- Different monitoring and alerting

## Alternatives Considered

### Option A: Integrated Processing

**Pros**:
- Simpler deployment (one service)
- Slightly less code
- No polling overhead

**Cons**:
- Tight coupling of unrelated concerns
- Cannot scale independently
- Resource inefficiency
- Complex error handling
- Harder to maintain

**Why Rejected**: The cons significantly outweigh the pros. The slight deployment simplicity is not worth the loss of flexibility, scalability, and maintainability.

## Implementation

### Current Architecture

```
┌─────────────────────┐
│  Extraction Queue   │
│   (Database Table)  │
└──────────┬──────────┘
           │
           ├─────────────────────┐
           │                     │
           ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│ Extraction Worker│  │   OCR Monitor    │
│                  │  │                  │
│ • Web scraping   │  │ • PDF→Image      │
│ • PDF download   │  │ • Gemini AI      │
│ • Browser auto   │  │ • Text boost     │
│                  │  │                  │
│ Status: 1 → 3    │  │ Status: 3 → 5    │
└──────────────────┘  └──────────────────┘
```

### Trigger Conditions

**OCR Monitor activates when**:
```sql
SELECT * FROM extraction_queue
WHERE status_id = 3                    -- Extraction complete
  AND document_source = 'index'        -- Index documents only
  AND supabase_path IS NOT NULL        -- PDF available
  AND file_content IS NULL             -- Not yet processed
ORDER BY created_at ASC
LIMIT 1;
```

### Data Flow

1. **Extraction Phase**:
   - Worker extracts PDF from website
   - Uploads to Supabase Storage
   - Sets `status_id = 3`, `supabase_path = <url>`

2. **OCR Phase**:
   - Monitor detects completed extraction
   - Downloads PDF from storage
   - Converts to high-res image (300 DPI)
   - Extracts text with Gemini Vision AI
   - Applies 60+ correction rules
   - Stores raw text in `file_content`
   - Stores enhanced text in `boosted_file_content`
   - Sets `status_id = 5`

## Performance Characteristics

### Extraction Workers
- **Throughput**: 50-100 documents/hour per worker
- **Bottleneck**: Website response time, CAPTCHA, login sessions
- **Scaling**: Linear (add more workers = proportional throughput)

### OCR Workers
- **Throughput**: 200-300 documents/hour per worker
- **Bottleneck**: Gemini API rate limits, image processing
- **Scaling**: Linear up to API limits

### System Capacity
- **1 Extraction Worker + 1 OCR Worker**: ~50-100 docs/hour (extraction-limited)
- **2 Extraction Workers + 1 OCR Worker**: ~100-200 docs/hour (balanced)
- **4 Extraction Workers + 2 OCR Workers**: ~200-400 docs/hour (API-limited)

## Monitoring

### Key Metrics

**Extraction Queue Depth**:
```sql
SELECT COUNT(*) FROM extraction_queue WHERE status_id = 1;
```

**OCR Queue Depth**:
```sql
SELECT COUNT(*) FROM extraction_queue 
WHERE status_id = 3 AND document_source = 'index' AND file_content IS NULL;
```

**Processing Rates**:
```sql
-- Extractions per hour
SELECT COUNT(*) FROM extraction_queue 
WHERE status_id >= 3 AND updated_at > NOW() - INTERVAL '1 hour';

-- OCR completions per hour
SELECT COUNT(*) FROM extraction_queue 
WHERE status_id = 5 AND updated_at > NOW() - INTERVAL '1 hour';
```

## Conclusion

The separate worker architecture provides:
- ✅ Better separation of concerns
- ✅ Independent scalability
- ✅ Efficient resource utilization
- ✅ Failure isolation
- ✅ Easier maintenance and debugging
- ✅ Deployment flexibility

This architecture is well-suited for the current requirements and provides a solid foundation for future enhancements.

## References

- [OCR Integration Documentation](OCR_INTEGRATION.md)
- [Server Capacity Analysis](SERVER_CAPACITY.md)
- [OCR Module README](src/ocr/README.md)


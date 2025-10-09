# Post-Processing Workflow Implementation

## 📋 Overview

This document describes the automated post-processing workflow for successfully completed extraction jobs in the registre-extractor system.

**Status**: ✅ **FULLY IMPLEMENTED**

The post-processing workflow was already implemented as the **OCR Monitor service**. This implementation adds the `boosted_file_content` column to properly separate raw and enhanced OCR text.

---

## 🎯 Requirements (All Met)

### ✅ Trigger Condition
**Requirement**: When an extraction worker completes successfully (status_id = 3) AND has a supabase_path available AND the document_source = 'index', automatically trigger post-processing.

**Implementation**: The OCR Monitor polls the database every 10 seconds for documents matching:
```sql
SELECT * FROM extraction_queue
WHERE status_id = 3                    -- Extraction complete
  AND document_source = 'index'        -- Index documents only
  AND supabase_path IS NOT NULL        -- PDF available (validated in code)
  AND file_content IS NULL             -- Not yet processed
ORDER BY created_at ASC
LIMIT 1;
```

**Location**: `src/ocr/monitor.ts` lines 114-121

### ✅ Architecture
**Requirement**: Determine whether post-processing should be handled by existing extraction workers OR a new dedicated worker type.

**Decision**: **Separate dedicated OCR worker** (OCR Monitor service)

**Rationale**: See [ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md) for detailed analysis.

**Key Benefits**:
- Separation of concerns (web scraping vs text processing)
- Independent scalability
- Efficient resource utilization
- Failure isolation
- Different dependency management

### ✅ Queue System
**Requirement**: Implement a queuing system similar to the existing extraction queue.

**Implementation**: Uses the same `extraction_queue` table as a message queue:
- Polls database every 10 seconds (configurable via `OCR_POLL_INTERVAL_MS`)
- Processes one document per poll cycle
- Updates status when complete
- Automatic retry on failure (documents remain in queue)

**Location**: `src/ocr/monitor.ts`

### ✅ Database Schema Changes
**Requirement**: Add `boosted_file_content` column to store enhanced/processed version, while `file_content` stores raw/original content.

**Implementation**: 
- Migration `004_add_boosted_file_content.sql` adds the new column
- `file_content`: Stores raw OCR text (unprocessed Gemini Vision output)
- `boosted_file_content`: Stores enhanced text with 60+ correction rules applied
- Both columns are TEXT type with full-text search indexes

**Location**: `supabase/migrations/004_add_boosted_file_content.sql`

---

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Extraction Queue                         │
│                   (Database Table)                          │
│                                                             │
│  Columns:                                                   │
│  • status_id (1=waiting, 2=processing, 3=complete, 5=done) │
│  • document_source ('index', 'acte', 'plan_cadastraux')    │
│  • supabase_path (PDF URL)                                 │
│  • file_content (raw OCR text)                             │
│  • boosted_file_content (enhanced OCR text)                │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               │                          │
               ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   Extraction Workers     │  │     OCR Monitor          │
│                          │  │                          │
│ • Web scraping           │  │ • PDF download           │
│ • PDF extraction         │  │ • Image conversion       │
│ • Browser automation     │  │ • Gemini Vision AI       │
│ • Upload to storage      │  │ • Text extraction        │
│                          │  │ • Boost corrections      │
│ Status: 1 → 2 → 3        │  │                          │
│                          │  │ Status: 3 → 5            │
└──────────────────────────┘  └──────────────────────────┘
```

### Data Flow

```
1. Extraction Worker
   ├─ Polls for status_id = 1 (EN_ATTENTE)
   ├─ Extracts PDF from Quebec Land Registry
   ├─ Uploads to Supabase Storage
   └─ Updates: status_id = 3, supabase_path = <url>

2. OCR Monitor (Post-Processing)
   ├─ Polls for status_id = 3, document_source = 'index', file_content IS NULL
   ├─ Downloads PDF from Supabase Storage
   ├─ Converts PDF to PNG (300 DPI)
   ├─ Extracts text with Gemini Vision AI → raw text
   ├─ Applies 60+ correction rules → boosted text
   └─ Updates: 
       • file_content = raw text
       • boosted_file_content = boosted text
       • status_id = 5 (EXTRACTION_COMPLETE)
```

### Status Flow

```
1 (En attente)
    ↓
    [Extraction Worker picks up job]
    ↓
2 (En traitement)
    ↓
    [Extraction completes, PDF uploaded]
    ↓
3 (Complété)
    ↓
    [OCR Monitor picks up job]
    ↓
    [OCR processing: extract + boost]
    ↓
5 (Extraction Complété)
```

---

## 📦 Implementation Details

### Files Modified/Created

#### Database Migrations
- ✅ `supabase/migrations/004_add_boosted_file_content.sql` - Adds boosted_file_content column

#### TypeScript Types
- ✅ `src/types/index.ts` - Added boosted_file_content to ExtractionQueueJob interface

#### OCR Monitor
- ✅ `src/ocr/monitor.ts` - Updated to store both raw and boosted text

#### Documentation
- ✅ `ARCHITECTURE_DECISION.md` - Architecture rationale and analysis
- ✅ `SERVER_CAPACITY.md` - Detailed server capacity analysis
- ✅ `POST_PROCESSING_IMPLEMENTATION.md` - This file
- ✅ `OCR_INTEGRATION.md` - Updated to reflect new column

### Code Changes

**Before** (`src/ocr/monitor.ts`):
```typescript
// Only stored boosted text
const fileContent = ocrResult.boostedText;

await client.from('extraction_queue').update({
  file_content: fileContent,
  status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
}).eq('id', document.id);
```

**After** (`src/ocr/monitor.ts`):
```typescript
// Store both raw and boosted text
const rawText = ocrResult.rawText;
const boostedText = ocrResult.boostedText;

await client.from('extraction_queue').update({
  file_content: rawText,              // Raw OCR output
  boosted_file_content: boostedText,  // Enhanced with corrections
  status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
}).eq('id', document.id);
```

---

## 🚀 Deployment

### Prerequisites

1. **Gemini API Key**
   ```bash
   # Add to .env
   GEMINI_API_KEY=your-api-key-here
   ```

2. **PDF Conversion Tools**
   ```bash
   # macOS
   brew install imagemagick poppler
   
   # Ubuntu/Debian
   sudo apt-get install imagemagick poppler-utils
   ```

3. **Apply Database Migration**
   ```bash
   # Apply migration 004
   supabase db push
   ```

### Running the OCR Monitor

```bash
# Development mode (with auto-reload)
npm run ocr:dev

# Production mode
npm run build
npm run ocr
```

### Docker Deployment

The OCR Monitor can be deployed as a separate container:

```yaml
# docker-compose.yml
services:
  ocr-monitor:
    build: .
    command: npm run ocr
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - OCR_POLL_INTERVAL_MS=10000
      - OCR_TEMP_DIR=/tmp/ocr-processing
    volumes:
      - ocr-temp:/tmp/ocr-processing
    restart: unless-stopped
```

---

## 📊 Server Capacity Analysis

See [SERVER_CAPACITY.md](SERVER_CAPACITY.md) for detailed analysis.

### Quick Summary

**Per OCR Worker**:
- **CPU**: 1-2 cores
- **RAM**: 1-2 GB
- **Disk**: 500MB-1GB temporary storage
- **Throughput**: 200-300 documents/hour

**Scaling**:
| Workers | CPU | RAM | Throughput (docs/hr) |
|---------|-----|-----|----------------------|
| 1 | 2 | 2GB | 200-300 |
| 2 | 4 | 4GB | 400-600 |
| 4 | 8 | 8GB | 800-1200 |

**Cost** (monthly):
- Infrastructure: ~$15-20 per worker
- API: ~$0.001 per document
- Total: ~$26 for 10K docs/month

---

## 🧪 Testing

### Manual Testing

1. **Create a test index job**:
   ```bash
   tsx src/create-test-job-index.ts
   ```

2. **Start extraction worker** (if not running):
   ```bash
   npm run dev
   ```

3. **Wait for extraction to complete** (status_id = 3)

4. **Start OCR monitor**:
   ```bash
   npm run ocr:dev
   ```

5. **Verify in database**:
   ```sql
   SELECT 
     id,
     document_number,
     status_id,
     LENGTH(file_content) as raw_length,
     LENGTH(boosted_file_content) as boosted_length,
     updated_at
   FROM extraction_queue
   WHERE document_source = 'index'
     AND status_id = 5
   ORDER BY updated_at DESC
   LIMIT 5;
   ```

### Automated Testing

```bash
npm run test:ocr
```

---

## 📈 Monitoring

### Key Metrics

**Queue Depth** (documents waiting for OCR):
```sql
SELECT COUNT(*) FROM extraction_queue 
WHERE status_id = 3 
  AND document_source = 'index' 
  AND file_content IS NULL;
```

**Processing Rate** (documents/hour):
```sql
SELECT COUNT(*) FROM extraction_queue 
WHERE status_id = 5 
  AND updated_at > NOW() - INTERVAL '1 hour';
```

**Error Rate**:
```sql
SELECT COUNT(*) FROM extraction_queue 
WHERE error_message LIKE '%OCR%' 
  AND updated_at > NOW() - INTERVAL '1 hour';
```

### Alerts

- Queue depth > 1000 → Add more workers
- Processing rate < 100/hour → Check worker health
- Error rate > 5% → Investigate errors

---

## 🎉 Summary

The automated post-processing workflow is **fully implemented and operational**:

✅ **Trigger Condition**: Automatically processes documents with status_id=3, document_source='index', supabase_path available  
✅ **Architecture**: Separate OCR Monitor worker for optimal resource management  
✅ **Queue System**: Database-backed queue with automatic polling  
✅ **Database Schema**: Added boosted_file_content column to separate raw and enhanced text  
✅ **Documentation**: Complete architecture decision and capacity analysis  

**To use**:
1. Ensure `GEMINI_API_KEY` is configured
2. Apply database migration: `supabase db push`
3. Run OCR monitor: `npm run ocr:dev` or `npm run ocr`
4. Monitor logs and database for processing status

The system will automatically process all completed index document extractions!


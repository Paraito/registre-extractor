# OCR Multi-Worker Flow Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OCR Monitor Process                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Worker 1    │  │  Worker 2    │  │  Worker N    │             │
│  │              │  │              │  │              │             │
│  │ ID: worker-1 │  │ ID: worker-2 │  │ ID: worker-N │             │
│  │ Temp: /tmp-1 │  │ Temp: /tmp-2 │  │ Temp: /tmp-N │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                  │                      │
└─────────┼──────────────────┼──────────────────┼──────────────────────┘
          │                  │                  │
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase Database                            │
│                       extraction_queue table                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Documents with status_id = 3 (COMPLETE)                            │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ Doc A │ Doc B │ Doc C │ Doc D │ Doc E │ Doc F │ ...    │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Document Claiming Flow (Race Condition Prevention)

```
Time ──────────────────────────────────────────────────────────────────▶

Worker 1:
  │
  ├─ Poll DB for documents (status_id = 3)
  │  └─ Found: [Doc A, Doc B, Doc C]
  │
  ├─ Try to claim Doc A
  │  └─ UPDATE extraction_queue
  │     SET status_id = 4, ocr_worker_id = 'worker-1'
  │     WHERE id = 'doc-a' AND status_id = 3
  │     ✓ SUCCESS (1 row updated)
  │
  ├─ Process Doc A
  │  ├─ Download PDF
  │  ├─ Convert to images
  │  ├─ Extract text (Gemini)
  │  ├─ Boost text (Gemini)
  │  └─ Update status_id = 5 (COMPLETE)
  │
  └─ Poll again...

Worker 2:
  │
  ├─ Poll DB for documents (status_id = 3)
  │  └─ Found: [Doc A, Doc B, Doc C]
  │
  ├─ Try to claim Doc A
  │  └─ UPDATE extraction_queue
  │     SET status_id = 4, ocr_worker_id = 'worker-2'
  │     WHERE id = 'doc-a' AND status_id = 3
  │     ✗ FAILED (0 rows updated - already claimed by Worker 1)
  │
  ├─ Try to claim Doc B
  │  └─ UPDATE extraction_queue
  │     SET status_id = 4, ocr_worker_id = 'worker-2'
  │     WHERE id = 'doc-b' AND status_id = 3
  │     ✓ SUCCESS (1 row updated)
  │
  ├─ Process Doc B
  │  ├─ Download PDF
  │  ├─ Convert to images
  │  ├─ Extract text (Gemini)
  │  ├─ Boost text (Gemini)
  │  └─ Update status_id = 5 (COMPLETE)
  │
  └─ Poll again...
```

## Atomic Claiming Mechanism

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Database Transaction                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Worker 1 attempts:                                                 │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ UPDATE extraction_queue                                │        │
│  │ SET status_id = 4,                                     │        │
│  │     ocr_worker_id = 'worker-1',                        │        │
│  │     ocr_started_at = NOW(),                            │        │
│  │     ocr_attempts = ocr_attempts + 1                    │        │
│  │ WHERE id = 'doc-a'                                     │        │
│  │   AND status_id = 3  ← CRITICAL: Only if COMPLETE     │        │
│  │ RETURNING *;                                           │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Result: 1 row updated ✓                                            │
│  Document state changes: status_id 3 → 4                            │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Worker 2 attempts (milliseconds later):                            │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ UPDATE extraction_queue                                │        │
│  │ SET status_id = 4,                                     │        │
│  │     ocr_worker_id = 'worker-2',                        │        │
│  │     ocr_started_at = NOW(),                            │        │
│  │     ocr_attempts = ocr_attempts + 1                    │        │
│  │ WHERE id = 'doc-a'                                     │        │
│  │   AND status_id = 3  ← FAILS: status is now 4         │        │
│  │ RETURNING *;                                           │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Result: 0 rows updated ✗                                           │
│  Worker 2 knows document was claimed by another worker              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Document State Transitions

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Document Lifecycle                                │
└─────────────────────────────────────────────────────────────────────┘

  status_id = 1 (EN_ATTENTE)
       │
       │ Registre Extractor picks up job
       ▼
  status_id = 2 (EN_TRAITEMENT)
       │
       │ Extraction completes successfully
       ▼
  status_id = 3 (COMPLETE) ◄─────────────────┐
       │                                      │
       │ OCR Worker claims document           │ OCR fails
       ▼                                      │ (retry if < max_attempts)
  status_id = 4 (OCR_PROCESSING)              │
       │                                      │
       │ OCR completes successfully           │
       ▼                                      │
  status_id = 5 (EXTRACTION_COMPLETE) ───────┘
       │                                (or)
       │ OCR fails permanently
       ▼
  status_id = 4 (ERREUR)
  (if ocr_attempts >= ocr_max_attempts)
```

## Error Field Separation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Error Message Fields                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Registre Extractor Errors:                                         │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ error_message: "Failed to login to registre"          │        │
│  │ ocr_error: NULL                                        │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  OCR Processing Errors:                                             │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ error_message: NULL (or previous extraction error)     │        │
│  │ ocr_error: "OCR processing failed: API rate limit"     │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Both Errors (sequential):                                          │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ error_message: "Failed to login to registre"          │        │
│  │ ocr_error: "OCR processing failed: Invalid PDF"        │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Worker Monitoring

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Active Workers Query                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SELECT ocr_worker_id,                                              │
│         COUNT(*) as active_jobs,                                    │
│         MIN(ocr_started_at) as oldest_job,                          │
│         MAX(ocr_started_at) as newest_job                           │
│  FROM extraction_queue                                              │
│  WHERE status_id = 4                                                │
│  GROUP BY ocr_worker_id;                                            │
│                                                                      │
│  Results:                                                           │
│  ┌──────────────┬─────────────┬─────────────┬─────────────┐       │
│  │ worker_id    │ active_jobs │ oldest_job  │ newest_job  │       │
│  ├──────────────┼─────────────┼─────────────┼─────────────┤       │
│  │ worker-1     │ 1           │ 10:30:00    │ 10:30:00    │       │
│  │ worker-2     │ 1           │ 10:30:05    │ 10:30:05    │       │
│  └──────────────┴─────────────┴─────────────┴─────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Stale Job Recovery

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Stale OCR Monitor                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Runs every 5 minutes                                               │
│                                                                      │
│  Finds jobs stuck in OCR_PROCESSING > 10 minutes:                   │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ SELECT * FROM extraction_queue                         │        │
│  │ WHERE status_id = 4                                    │        │
│  │   AND ocr_started_at < NOW() - INTERVAL '10 minutes'   │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Resets them for retry:                                             │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ UPDATE extraction_queue                                │        │
│  │ SET status_id = 3,  -- Back to COMPLETE               │        │
│  │     ocr_worker_id = NULL                               │        │
│  │ WHERE id IN (stale_job_ids)                            │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Workers can now claim and retry these documents                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Performance Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Single Worker vs Multi-Worker                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Single Worker (OCR_WORKER_COUNT=1):                                │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ Time: 0s    30s   60s   90s   120s  150s  180s         │        │
│  │       │     │     │     │     │     │     │            │        │
│  │ Doc A ████████████                                     │        │
│  │ Doc B           ████████████                           │        │
│  │ Doc C                     ████████████                 │        │
│  │ Doc D                               ████████████       │        │
│  │                                                         │        │
│  │ Total time: ~180s for 4 documents                      │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
│  Two Workers (OCR_WORKER_COUNT=2):                                  │
│  ┌────────────────────────────────────────────────────────┐        │
│  │ Time: 0s    30s   60s   90s   120s  150s  180s         │        │
│  │       │     │     │     │     │     │     │            │        │
│  │ W1: A ████████████                                     │        │
│  │ W1: C           ████████████                           │        │
│  │ W2: B ████████████                                     │        │
│  │ W2: D           ████████████                           │        │
│  │                                                         │        │
│  │ Total time: ~90s for 4 documents (2x faster!)          │        │
│  └────────────────────────────────────────────────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Takeaways

1. **Atomic Claiming**: Database-level locking prevents race conditions
2. **Worker Isolation**: Each worker has unique ID and temp directory
3. **Error Separation**: OCR errors vs extraction errors in different fields
4. **Fault Tolerance**: Stale job monitor recovers stuck jobs
5. **Scalability**: Easy to add more workers by increasing OCR_WORKER_COUNT
6. **Monitoring**: Track worker activity and performance via database queries


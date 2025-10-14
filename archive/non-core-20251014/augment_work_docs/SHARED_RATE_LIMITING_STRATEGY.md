# Shared Rate Limiting Strategy - Complete System Analysis

## 🎯 Executive Summary

**CRITICAL FINDING**: Both the **Registre Extractor** and **Index OCR Specialist** share the SAME Gemini API rate limits but currently have NO coordination. This creates a high risk of exceeding rate limits and causing failures.

**SOLUTION**: Implement shared Redis-based rate limiting across BOTH systems to ensure total API usage stays within Gemini Tier 3 limits.

---

## 📊 Current System Architecture

### System 1: Registre Extractor (Main System)

**Location**: `src/worker/`, `src/ocr/`

**Purpose**: Extract documents from Quebec land registry

**Components**:
1. **Worker System** (`src/worker/index.ts`)
   - Uses Bull queue (Redis-based)
   - Polls `extraction_queue` for jobs
   - Processes index, actes, and plans cadastraux

2. **Acte OCR Processor** (`src/ocr/acte-processor.ts`)
   - Uses Gemini File API
   - **3 API calls per acte document**:
     1. Upload PDF to Gemini File API
     2. Extract text (1 call)
     3. Boost text (1 call)

**Gemini API Usage**:
- **Per Acte**: 3 API calls, ~101K tokens, ~25 seconds
- **Throughput**: ~144 actes/hour per worker
- **API Load**: ~7.2 RPM, ~242K TPM per worker

**Current Rate Limiting**: ❌ **NONE** - No coordination between workers

---

### System 2: Index OCR Specialist

**Location**: `index_ocr_specialist/`

**Purpose**: OCR processing for index documents

**Components**:
1. **Worker System** (`index_ocr_specialist/src/worker/index-ocr-worker.ts`)
   - NEW: Just implemented
   - Polls `extraction_queue` for status_id = 3
   - Processes index documents only

2. **OCR Pipeline** (`index_ocr_specialist/src/pipeline/`)
   - **20 API calls per 10-page index document**:
     - 10 line counting calls
     - 10 text extraction calls

**Gemini API Usage**:
- **Per Index (10 pages)**: 20 API calls, ~161K tokens, ~3 minutes
- **Throughput**: ~20 indices/hour per worker
- **API Load**: ~6.7 RPM, ~53K TPM per worker

**Current Rate Limiting**: ✅ **Redis-based** - But only coordinates index OCR workers, NOT acte workers

---

## ⚠️ THE PROBLEM

### Shared Rate Limits (Gemini Tier 3)

**BOTH systems share the SAME API limits:**
- **RPM**: 2,000 requests per minute (safe: 1,600)
- **TPM**: 8,000,000 tokens per minute (safe: 6,400,000)

### Current Risk Scenario

**Example: 5 Index Workers + 10 Acte Workers (NO coordination)**

| System | Workers | RPM | TPM | % of Limit |
|--------|---------|-----|-----|------------|
| Index OCR | 5 | 34 | 265K | 2% RPM, 4% TPM |
| Acte OCR | 10 | 72 | 2.42M | 5% RPM, 38% TPM |
| **TOTAL** | **15** | **106** | **2.69M** | **7% RPM, 42% TPM** |

**This looks safe... BUT:**

1. **No coordination** - Each system doesn't know about the other
2. **Burst traffic** - If both systems spike at once, could exceed limits
3. **No backpressure** - Workers don't slow down when approaching limits
4. **429 errors** - Will cause job failures and retries (making it worse)

### Worst Case Scenario

**If both systems scale up independently:**

| System | Workers | RPM | TPM | Status |
|--------|---------|-----|-----|--------|
| Index OCR | 20 | 134 | 1.06M | ⚠️ Unaware of acte load |
| Acte OCR | 20 | 144 | 4.84M | ⚠️ Unaware of index load |
| **TOTAL** | **40** | **278** | **5.9M** | ✅ Still under limit... barely |

**But add a spike:**
- Index workers process large documents (30 pages instead of 10)
- Acte workers retry failed jobs
- **Result**: 400+ RPM, 8M+ TPM → **429 ERRORS** → **CASCADING FAILURES**

---

## ✅ THE SOLUTION: Unified Rate Limiting

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         REDIS                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Shared Rate Limit State                              │  │
│  │  - gemini:rpm:current                                 │  │
│  │  - gemini:tpm:current                                 │  │
│  │  - gemini:workers (all workers from both systems)     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │                                    │
         │                                    │
┌────────┴────────┐                  ┌────────┴────────┐
│  Index OCR      │                  │  Acte OCR       │
│  Workers        │                  │  Workers        │
│  (type: index)  │                  │  (type: acte)   │
│                 │                  │                 │
│  Before API:    │                  │  Before API:    │
│  checkLimit()   │                  │  checkLimit()   │
│                 │                  │                 │
│  After API:     │                  │  After API:     │
│  recordUsage()  │                  │  recordUsage()  │
└─────────────────┘                  └─────────────────┘
```

### Implementation Strategy

#### Phase 1: Integrate Rate Limiter into Acte OCR (PRIORITY)

**File**: `src/ocr/acte-processor.ts`

**Changes**:
1. Import `SharedRateLimiter` from `index_ocr_specialist/src/worker/rate-limiter.ts`
2. Add rate limit checks before each Gemini API call
3. Record actual usage after each call

**Example**:

```typescript
// Before upload
const uploadCheck = await rateLimiter.checkRateLimit(1000);
if (!uploadCheck.allowed) {
  await sleep(60000); // Wait for reset
}

// Upload file
const uploadResult = await this.geminiClient.uploadFile(...);

// Record usage
await rateLimiter.recordApiCall(1000);

// Before extraction
const extractCheck = await rateLimiter.checkRateLimit(50000);
if (!extractCheck.allowed) {
  await sleep(60000);
}

// Extract text
const extractionResult = await this.geminiClient.extractTextFromFile(...);

// Record usage (get actual from response metadata)
await rateLimiter.recordApiCall(actualTokens);
```

#### Phase 2: Move Rate Limiter to Shared Location

**Current**: `index_ocr_specialist/src/worker/rate-limiter.ts`

**New**: `src/shared/rate-limiter.ts` (accessible by both systems)

**Why**: Both systems need to import the same rate limiter

#### Phase 3: Update Worker Registration

**Both systems register with type**:
- Index OCR workers: `type: 'index'`
- Acte OCR workers: `type: 'acte'`

**Redis tracks**:
```json
{
  "index-ocr-1": { "type": "index", "lastHeartbeat": 1234567890 },
  "index-ocr-2": { "type": "index", "lastHeartbeat": 1234567891 },
  "acte-worker-1": { "type": "acte", "lastHeartbeat": 1234567892 },
  "acte-worker-2": { "type": "acte", "lastHeartbeat": 1234567893 }
}
```

#### Phase 4: Add Monitoring Dashboard

**Create**: `scripts/monitor-rate-limits.ts`

**Features**:
- Real-time RPM/TPM usage
- Active workers by type
- Usage percentage
- Alerts when >80% of limits

---

## 📋 Recommended Worker Configuration

### Development Environment

```yaml
Index OCR Workers: 1
Acte OCR Workers: 1

Total API Usage:
  RPM: ~14 (0.9% of limit)
  TPM: ~154K (2.4% of limit)
```

### Staging Environment

```yaml
Index OCR Workers: 2
Acte OCR Workers: 3

Total API Usage:
  RPM: ~35 (2.2% of limit)
  TPM: ~832K (13% of limit)
```

### Production Environment

```yaml
Index OCR Workers: 5
Acte OCR Workers: 10

Total API Usage:
  RPM: ~106 (6.6% of limit)
  TPM: ~2.69M (42% of limit)

Safety Margin: 58% TPM remaining for bursts
```

### Maximum Safe Capacity

```yaml
Index OCR Workers: 10
Acte OCR Workers: 20

Total API Usage:
  RPM: ~211 (13% of limit)
  TPM: ~5.37M (84% of limit)

⚠️ WARNING: Only 16% TPM margin - risky for production
```

---

## 🔧 Implementation Checklist

### Immediate (Phase 1)

- [ ] Move `rate-limiter.ts` to `src/shared/`
- [ ] Update imports in `index_ocr_specialist/`
- [ ] Add rate limiter to `src/ocr/acte-processor.ts`
- [ ] Add rate limiter to `src/ocr/gemini-file-client.ts`
- [ ] Test with 1 index + 1 acte worker
- [ ] Verify Redis shows both worker types

### Short-term (Phase 2)

- [ ] Create monitoring dashboard
- [ ] Add alerts for >80% usage
- [ ] Document worker scaling guidelines
- [ ] Update `.env.example` with Redis URL
- [ ] Add rate limit status to worker logs

### Long-term (Phase 3)

- [ ] Implement auto-scaling based on queue depth + API usage
- [ ] Add circuit breaker for 429 errors
- [ ] Implement graceful degradation (slow down vs fail)
- [ ] Add metrics to Datadog/CloudWatch
- [ ] Create runbook for rate limit incidents

---

## 🎓 Key Takeaways

1. ✅ **Shared rate limiting is CRITICAL** - Both systems must coordinate
2. ✅ **Redis is the right choice** - Already used by Bull queue
3. ✅ **TPM is the bottleneck** - Not RPM (acte workers are token-heavy)
4. ✅ **Safe production config**: 5 index + 10 acte workers (42% TPM usage)
5. ✅ **Monitor closely** - Set alerts at 80% usage
6. ✅ **Start small** - Test with 1+1 workers before scaling
7. ✅ **Implement Phase 1 ASAP** - High risk without coordination

---

## 💡 Best Strategy

### Recommended Approach

1. **Move rate limiter to shared location** (`src/shared/rate-limiter.ts`)
2. **Integrate into acte processor** (add checks before each API call)
3. **Test with minimal workers** (1 index + 1 acte)
4. **Monitor for 24 hours** (verify coordination works)
5. **Gradually scale up** (add workers one at a time)
6. **Set up alerts** (>80% TPM usage)
7. **Document runbook** (what to do if limits hit)

### Why This Works

- ✅ **Single source of truth** (Redis)
- ✅ **Real-time coordination** (all workers check before API calls)
- ✅ **Automatic reset** (every 60 seconds)
- ✅ **Worker awareness** (can see all active workers)
- ✅ **Graceful degradation** (wait vs fail)
- ✅ **Observable** (Redis CLI shows current state)

---

## 🚨 Risks Without Shared Rate Limiting

1. **429 Errors** - API rejects requests
2. **Job Failures** - Workers mark jobs as failed
3. **Retry Storms** - Failed jobs retry, making it worse
4. **Cascading Failures** - One system's spike affects the other
5. **Wasted API Quota** - Failed requests still count
6. **Unpredictable Behavior** - No visibility into total usage

---

## ✅ Benefits With Shared Rate Limiting

1. **Predictable Performance** - Know exactly how much capacity remains
2. **No 429 Errors** - Stay under limits proactively
3. **Coordinated Scaling** - Both systems aware of each other
4. **Graceful Degradation** - Slow down instead of fail
5. **Observable** - Real-time visibility into usage
6. **Cost Optimization** - Maximize API quota without waste

---

**RECOMMENDATION**: Implement shared rate limiting BEFORE deploying multiple workers in production. The risk of cascading failures is too high without coordination.


# Index OCR Specialist - Worker Requirements & Rate Limit Management

## 📊 Gemini API Rate Limits (Tier 3)

**Shared across ALL workers and services:**
- **RPM (Requests Per Minute)**: 2,000 max → **1,600 safe limit** (80%)
- **TPM (Tokens Per Minute)**: 8,000,000 max → **6,400,000 safe limit** (80%)

---

## 🔍 API Usage Analysis

### Index OCR Specialist (per document)

**Average 10-page index document:**

| Stage | API Calls | Duration | RPM Impact | TPM Impact |
|-------|-----------|----------|------------|------------|
| **Line Counting** | 10 calls | ~25s | ~24 RPM | ~11K TPM |
| **Text Extraction** | 10 calls | ~150s | ~4 RPM | ~150K TPM |
| **Total per doc** | **20 calls** | **~3 min** | **~28 RPM** | **~161K TPM** |

**Throughput per worker:**
- **~20 documents/hour** (3 min each)
- **~400 API calls/hour** (6.7 RPM per worker)
- **~3.2M tokens/hour** (53K TPM per worker)

### Acte Extraction (per document)

**Average acte document:**

| Stage | API Calls | Duration | RPM Impact | TPM Impact |
|-------|-----------|----------|------------|------------|
| **Upload** | 1 call | ~5s | ~12 RPM | ~1K TPM |
| **Extract** | 1 call | ~10s | ~6 RPM | ~50K TPM |
| **Boost** | 1 call | ~10s | ~6 RPM | ~50K TPM |
| **Total per doc** | **3 calls** | **~25s** | **~24 RPM** | **~101K TPM** |

**Throughput per worker:**
- **~144 documents/hour** (25s each)
- **~432 API calls/hour** (7.2 RPM per worker)
- **~14.5M tokens/hour** (242K TPM per worker)

---

## 🎯 Maximum Worker Capacity

### Scenario 1: Index OCR Only

**Safe limits:**
- RPM: 1,600 / 6.7 = **~238 workers max**
- TPM: 6,400,000 / 53,000 = **~120 workers max** ← **BOTTLENECK**

**Recommendation: Max 100 index OCR workers** (leaves 20% buffer)

### Scenario 2: Acte Extraction Only

**Safe limits:**
- RPM: 1,600 / 7.2 = **~222 workers max**
- TPM: 6,400,000 / 242,000 = **~26 workers max** ← **BOTTLENECK**

**Recommendation: Max 20 acte workers** (leaves 20% buffer)

### Scenario 3: Mixed Workload (Realistic)

**Typical production mix:**
- 5 index OCR workers
- 10 acte workers

**Total usage:**
- RPM: (5 × 6.7) + (10 × 7.2) = **105.5 RPM** (6.6% of limit) ✅
- TPM: (5 × 53K) + (10 × 242K) = **2,685K TPM** (42% of limit) ✅

**Safe capacity: 5 index + 10 acte workers** with plenty of headroom

---

## 💻 Worker Hardware Requirements

### CPU Requirements

**Index OCR Worker:**
- **CPU**: 1-2 vCPUs (most work done by Gemini servers)
- **Reason**: Minimal local processing
  - Image conversion (Sharp): ~100ms per page
  - JSON parsing: negligible
  - Network I/O: main bottleneck

**Acte Worker:**
- **CPU**: 1 vCPU (even less local work)
- **Reason**: Only PDF upload and JSON parsing

### Memory Requirements

**Index OCR Worker:**
- **RAM**: 512 MB - 1 GB
- **Breakdown**:
  - Node.js runtime: ~200 MB
  - Image buffers (10 pages × 2MB): ~20 MB
  - PDF processing: ~50 MB
  - Overhead: ~230 MB

**Acte Worker:**
- **RAM**: 256 MB - 512 MB
- **Breakdown**:
  - Node.js runtime: ~200 MB
  - PDF buffer: ~10 MB
  - Overhead: ~50 MB

### Storage Requirements

**Both worker types:**
- **Disk**: 1-2 GB
- **Breakdown**:
  - Node.js + dependencies: ~500 MB
  - Temporary files: ~500 MB
  - Logs: ~100 MB
  - Artifacts (optional): ~500 MB

### Network Requirements

**Both worker types:**
- **Bandwidth**: 10 Mbps minimum
- **Latency**: <100ms to Gemini API (us-central1)
- **Reason**: Most time spent waiting for API responses

---

## 🏗️ Recommended Worker Configurations

### Development Environment

```yaml
Index OCR Workers: 1
Acte Workers: 1

Per Worker:
  CPU: 1 vCPU
  RAM: 512 MB
  Disk: 1 GB
  Network: 10 Mbps

Total Resources:
  CPU: 2 vCPUs
  RAM: 1 GB
  Disk: 2 GB
```

### Staging Environment

```yaml
Index OCR Workers: 2
Acte Workers: 3

Per Worker:
  CPU: 1 vCPU
  RAM: 512 MB
  Disk: 1 GB
  Network: 10 Mbps

Total Resources:
  CPU: 5 vCPUs
  RAM: 2.5 GB
  Disk: 5 GB
```

### Production Environment

```yaml
Index OCR Workers: 5
Acte Workers: 10

Per Worker:
  CPU: 1-2 vCPUs
  RAM: 1 GB
  Disk: 2 GB
  Network: 10 Mbps

Total Resources:
  CPU: 15-30 vCPUs
  RAM: 15 GB
  Disk: 30 GB

API Usage:
  RPM: ~105 (6.6% of limit)
  TPM: ~2.7M (42% of limit)
```

---

## 🔐 Rate Limit Management Strategy

### 1. Shared Rate Limit Tracker (Redis)

**Use Redis to track global API usage:**

```typescript
interface RateLimitState {
  currentRPM: number;
  currentTPM: number;
  lastResetTime: number;
  activeWorkers: {
    [workerId: string]: {
      type: 'index' | 'acte';
      lastHeartbeat: number;
    };
  };
}
```

### 2. Worker Registration

**Each worker registers on startup:**

```typescript
await redis.hset('workers', workerId, JSON.stringify({
  type: 'index', // or 'acte'
  startedAt: Date.now(),
  lastHeartbeat: Date.now()
}));
```

### 3. Pre-Request Rate Limit Check

**Before each API call:**

```typescript
async function checkRateLimit(estimatedTokens: number): Promise<boolean> {
  const state = await redis.get('rate_limit_state');
  
  // Check if we have capacity
  if (state.currentRPM >= 1600) return false;
  if (state.currentTPM + estimatedTokens >= 6_400_000) return false;
  
  return true;
}
```

### 4. Post-Request Usage Tracking

**After each API call:**

```typescript
await redis.incrby('current_rpm', 1);
await redis.incrby('current_tpm', actualTokensUsed);
```

### 5. Automatic Reset (Every Minute)

**Reset counters every 60 seconds:**

```typescript
setInterval(async () => {
  await redis.set('current_rpm', 0);
  await redis.set('current_tpm', 0);
}, 60000);
```

---

## 📋 Worker Deployment Checklist

### Before Deploying Workers

- [ ] Verify Gemini API key is valid
- [ ] Confirm Tier 3 rate limits are active
- [ ] Set up Redis for rate limit tracking
- [ ] Configure environment variables
- [ ] Test with 1 worker first
- [ ] Monitor API usage for 1 hour
- [ ] Gradually scale up workers

### Monitoring Requirements

- [ ] Track RPM per minute
- [ ] Track TPM per minute
- [ ] Alert if >80% of limits
- [ ] Alert if 429 errors occur
- [ ] Track worker health/heartbeat
- [ ] Monitor queue depth
- [ ] Track processing times

---

## 🚨 Safety Mechanisms

### 1. Graceful Degradation

If approaching limits:
1. Slow down API calls (increase delays)
2. Reduce concurrency per worker
3. Pause new job claims
4. Wait for rate limit window to reset

### 2. Circuit Breaker

If 429 errors occur:
1. Immediately pause all workers
2. Wait 60 seconds (full rate limit window)
3. Resume with reduced capacity (50%)
4. Gradually increase back to normal

### 3. Worker Auto-Scaling

Based on queue depth and API usage:
- **Queue > 100 docs + API < 50% limit** → Scale up
- **Queue < 10 docs** → Scale down
- **API > 80% limit** → Scale down immediately

---

## 💡 Key Takeaways

1. **Most work is done by Gemini servers** → Workers need minimal CPU/RAM
2. **TPM is the bottleneck** → Not RPM
3. **Safe production capacity**: 5 index + 10 acte workers
4. **Each worker needs**: 1 vCPU, 512MB-1GB RAM, 1-2GB disk
5. **Must use shared rate limit tracking** (Redis) across all workers
6. **Monitor API usage closely** to avoid hitting limits
7. **Start small and scale gradually** based on actual usage

---

## 📞 Next Steps

1. Implement shared rate limit tracker (Redis)
2. Create worker service with registration
3. Add pre-request rate limit checks
4. Deploy 1 test worker and monitor
5. Gradually scale to production capacity


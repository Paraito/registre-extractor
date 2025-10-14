# Index OCR Specialist - Quick Reference Card

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Analyze throughput
npm run analyze-throughput

# Process a specific extraction_queue document
npm run process-queue -- --queue-id 123 --env dev
```

---

## 📊 Performance Metrics

| Metric | Value |
|--------|-------|
| **10-page document** | ~0.7 minutes |
| **Line counting** | 240 pages/min |
| **Text extraction** | 24 pages/min |
| **Boost** | 37.5 pages/min |
| **Overall speedup** | 5.7x faster |

---

## 🎛️ Parallel Configuration

| Stage | Concurrency | Stagger | Throughput |
|-------|-------------|---------|------------|
| **Line Counting** | 10 pages | 500ms | 240 pages/min |
| **Text Extraction** | 6 pages | 2s | 24 pages/min |
| **Boost** | 5 pages | 1s | 37.5 pages/min |

---

## 📈 Rate Limits (Tier 3)

### Gemini 2.5 Pro
- **RPM**: 2,000 (safe: 1,600)
- **TPM**: 8,000,000 (safe: 6,400,000)

### Claude Sonnet 3.5
- **RPM**: 4,000 (safe: 3,200)
- **ITPM**: 2,000,000 (safe: 1,600,000)
- **OTPM**: 400,000 (safe: 320,000) ⚠️ Bottleneck

---

## 🔄 Pipeline Stages

```
1. Fetch PDF from Supabase Storage
2. Convert PDF → PNG images
3. Upscale images (Sharp + Lanczos3)
4. Count lines per page (Gemini - PARALLEL)
5. Extract text from pages (Gemini - PARALLEL)
6. Verify extraction coherence (Claude)
7. Boost with confidence scores (Claude - PARALLEL)
8. Merge results and update database
```

---

## 🔍 Trigger Mechanism

- **Type**: Polling (not database triggers)
- **Interval**: 5-10 seconds
- **Query**: `status_id = 3` AND `worker_id = null`
- **Claiming**: Atomic update with `worker_id`
- **Multi-worker**: Supports distributed processing

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `config/rate-limits.ts` | Rate limit configuration |
| `src/pipeline/ocr_line_count.ts` | Line counting (parallel) |
| `src/pipeline/ocr_extract.ts` | Text extraction (parallel) |
| `src/pipeline/boost.ts` | Boost processing (parallel) |
| `src/util/retry.ts` | Parallel processing utility |
| `src/ocr/monitor.ts` | OCR monitor (polling) |
| `src/server/pipeline.ts` | Pipeline orchestrator |

---

## 🛠️ Configuration Files

```typescript
// config/rate-limits.ts
export const LINE_COUNT_CONFIG = {
  maxConcurrency: 10,
  apiDelayMs: 500,
  estimatedDurationMs: 2500,
  model: 'gemini'
};

export const EXTRACTION_CONFIG = {
  maxConcurrency: 6,
  apiDelayMs: 2000,
  estimatedDurationMs: 15000,
  model: 'gemini'
};

export const BOOST_CONFIG = {
  maxConcurrency: 5,
  apiDelayMs: 1000,
  estimatedDurationMs: 8000,
  model: 'claude'
};
```

---

## 🔧 Tuning Guide

### Increase Concurrency If:
- ✅ Consistently under 60% of safe limits
- ✅ No 429 errors in logs
- ✅ Processing time is the bottleneck

### Decrease Concurrency If:
- ⚠️ Seeing 429 errors
- ⚠️ Approaching 80% of safe limits
- ⚠️ Other apps sharing same API key

---

## 🚨 Error Handling

### Retry Strategy
```typescript
retryOptions: {
  maxAttempts: 3,
  baseDelayMs: 5000,
  maxDelayMs: 30000,
  retryableErrors: ['503', '429', 'timeout', 'deadline']
}
```

### Common Errors
- **429**: Rate limit exceeded → Reduce concurrency
- **503**: Service unavailable → Automatic retry
- **Timeout**: Request timeout → Automatic retry
- **Deadline**: Deadline exceeded → Automatic retry

---

## 📊 Monitoring

### Key Metrics to Track
- Pages processed per minute
- API requests per second
- Token usage (estimated)
- Error rates
- Retry counts
- Concurrency utilization

### Log Levels
- `info`: General information
- `success`: Successful operations
- `warn`: Warnings (non-critical)
- `error`: Errors (with retry)
- `time`: Performance timing

---

## 🎯 Status Codes

| Status ID | Meaning |
|-----------|---------|
| 1 | PENDING (initial upload) |
| 2 | PROCESSING (OCR in progress) |
| 3 | COMPLETE (ready for OCR) |
| 4 | COMPLETE (OCR done) |

---

## 🔐 Environment Variables

⚠️ **Important**: Configure in the **root `.env` file** (not in `index_ocr_specialist/.env`)

```bash
# AI API Keys (Required)
GEMINI_API_KEY=your_gemini_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Supabase (for process-queue command)
DEV_SUPABASE_URL=your_dev_supabase_url
DEV_SUPABASE_SERVICE_KEY=your_dev_service_key
STAGING_SUPABASE_URL=your_staging_supabase_url
STAGING_SUPABASE_SERVICE_KEY=your_staging_service_key
PROD_SUPABASE_URL=your_prod_supabase_url
PROD_SUPABASE_SERVICE_KEY=your_prod_service_key

# Optional Configuration
QWEN_API_URL=http://localhost:8000/v1
QWEN_MODEL_NAME=qwen3-vl
PORT=3001
```

See root `.env.example` for complete configuration template.

---

## 📚 Documentation

- **Architecture**: `docs/ARCHITECTURE.md`
- **Parallel Processing**: `docs/PARALLEL_PROCESSING.md`
- **Optimization Summary**: `PARALLEL_OPTIMIZATION_SUMMARY.md`
- **This Reference**: `docs/QUICK_REFERENCE.md`

---

## 🧪 Testing

```bash
# End-to-end test with Gemini
npm run test:e2e:gemini

# End-to-end test with Qwen3
npm run test:e2e:qwen3

# Analyze throughput
npm run analyze-throughput

# Process a specific extraction_queue document
npm run process-queue -- --queue-id 123 --env dev
```

---

## 🔮 Future Enhancements

1. **Gemini Batch API**: For bulk processing
2. **Dynamic Rate Limiting**: Adapt based on headers
3. **Multi-Region**: Distribute load
4. **Adaptive Concurrency**: Adjust by complexity

---

## 📞 Troubleshooting

### Pipeline Not Processing Documents
1. Check `status_id = 3` in `extraction_queue`
2. Verify `worker_id = null`
3. Check OCR monitor is running
4. Verify API keys are valid

### 429 Rate Limit Errors
1. Reduce `maxConcurrency` in config
2. Increase `apiDelayMs` stagger
3. Check other API usage
4. Verify Tier 3 status

### Slow Processing
1. Check concurrency settings
2. Verify API response times
3. Monitor network latency
4. Check document complexity

### Memory Issues
1. Reduce concurrency
2. Check image sizes
3. Monitor worker memory
4. Verify upscaling settings

---

**Last Updated**: 2025-10-14
**Version**: 1.0.0 (Parallel Optimized)


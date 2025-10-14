# Parallel Processing & Rate Limit Optimization

## Overview

The OCR pipeline has been optimized for **Tier 3 API limits** with parallel processing across all major stages. This document explains the implementation, configuration, and performance characteristics.

---

## 🎯 Performance Summary

### Before Optimization (Sequential)
- **Line Counting**: ~20 pages/minute (already parallel)
- **Text Extraction**: ~4 pages/minute (sequential)
- **Boost**: ~7.5 pages/minute (sequential)
- **10-page document**: ~4 minutes total

### After Optimization (Parallel)
- **Line Counting**: ~240 pages/minute (10 concurrent)
- **Text Extraction**: ~24 pages/minute (6 concurrent)
- **Boost**: ~37.5 pages/minute (5 concurrent)
- **10-page document**: ~0.7 minutes total

**Overall Speedup: ~5.7x faster** 🚀

---

## 📊 Rate Limit Configuration

### Tier 3 Limits

#### Gemini 2.5 Pro
- **RPM**: 2,000 requests per minute
- **TPM**: 8,000,000 tokens per minute
- **Source**: https://ai.google.dev/gemini-api/docs/rate-limits

#### Claude Sonnet 3.5
- **RPM**: 4,000 requests per minute
- **ITPM**: 2,000,000 input tokens per minute
- **OTPM**: 400,000 output tokens per minute (bottleneck!)
- **Source**: https://docs.anthropic.com/en/api/rate-limits

### Safe Operating Limits

We use **80% of maximum limits** as safe operating thresholds to prevent hitting rate limits:

```typescript
// Gemini Safe Limits
safeRpm: 1600    // 80% of 2,000
safeTpm: 6,400,000  // 80% of 8,000,000

// Claude Safe Limits
safeRpm: 3200    // 80% of 4,000
safeItpm: 1,600,000  // 80% of 2,000,000
safeOtpm: 320,000    // 80% of 400,000
```

---

## ⚙️ Stage Configuration

### Stage 1: Line Counting (Gemini)

```typescript
{
  maxConcurrency: 10,           // 10 pages at once
  apiDelayMs: 500,              // 500ms stagger between starts
  estimatedDurationMs: 2500,    // ~2.5 seconds per request
  estimatedInputTokens: 1000,   // Image tokens
  estimatedOutputTokens: 100,   // Just a number
}
```

**Throughput**: 240 pages/minute, 1,200 RPM (75% of safe limit)

### Stage 2: Text Extraction (Gemini)

```typescript
{
  maxConcurrency: 6,            // 6 pages at once
  apiDelayMs: 2000,             // 2 second stagger
  estimatedDurationMs: 15000,   // ~15 seconds per request
  estimatedInputTokens: 10000,  // Image + prompt tokens
  estimatedOutputTokens: 5000,  // JSON response
}
```

**Throughput**: 24 pages/minute, 180 RPM (11% of safe limit)

### Stage 3: Boost (Claude)

```typescript
{
  maxConcurrency: 5,            // 5 pages at once
  apiDelayMs: 1000,             // 1 second stagger
  estimatedDurationMs: 8000,    // ~8 seconds per request
  estimatedInputTokens: 5000,   // JSON input
  estimatedOutputTokens: 5000,  // JSON output
}
```

**Throughput**: 37.5 pages/minute, 300 RPM (9% of safe limit)

**Note**: OTPM is the bottleneck for Claude (187,500 OTPM vs 320,000 safe limit = 59% usage)

---

## 🔧 Implementation Details

### Parallel Processing Utility

All stages use the `processInParallel` utility from `src/util/retry.ts`:

```typescript
const results = await processInParallel(
  items,
  processor,
  logger,
  'operation_name',
  {
    maxConcurrency: 6,        // Max concurrent operations
    apiDelayMs: 2000,         // Stagger delay between starts
    retryOptions: {
      maxAttempts: 3,
      baseDelayMs: 5000,
      maxDelayMs: 30000,
      retryableErrors: ['503', '429', 'timeout', 'deadline']
    }
  }
);
```

### Key Features

1. **Controlled Concurrency**: Never exceeds `maxConcurrency` simultaneous operations
2. **Staggered Starts**: Delays `apiDelayMs` between each operation start
3. **Automatic Retry**: Retries on transient errors (503, 429, timeouts)
4. **Error Handling**: Continues processing other items if one fails
5. **Progress Tracking**: Logs progress and timing for each operation

### Rate Limiting Strategy

- **Token Bucket Algorithm**: Continuous replenishment, not fixed intervals
- **Conservative Limits**: Use 80% of max to account for burst traffic
- **Staggered Requests**: Prevent burst rate limiting by spacing out starts
- **Adaptive Retry**: Exponential backoff on 429 errors

---

## 📈 Throughput Analysis Tool

Run the throughput analysis tool to validate configuration:

```bash
npm run analyze-throughput
```

This will:
- Calculate theoretical throughput for each stage
- Validate against Tier 3 rate limits
- Show estimated processing time for documents
- Warn if any limits are exceeded

---

## 🚨 Rate Limit Handling

### 429 Errors (Rate Limit Exceeded)

If you encounter 429 errors:

1. **Check Current Usage**: Verify you're on Tier 3
2. **Reduce Concurrency**: Lower `maxConcurrency` in config
3. **Increase Stagger**: Increase `apiDelayMs` to space out requests
4. **Monitor Headers**: Check rate limit headers in API responses

### Automatic Retry Logic

The pipeline automatically retries on rate limit errors:

```typescript
retryOptions: {
  maxAttempts: 3,              // Retry up to 3 times
  baseDelayMs: 5000,           // Start with 5 second delay
  maxDelayMs: 30000,           // Max 30 second delay
  retryableErrors: ['429', '503', 'timeout']
}
```

---

## 🔍 Monitoring & Debugging

### Logging

All parallel operations log:
- Start time and page number
- Completion time and duration
- Success/failure status
- Retry attempts
- Rate limit warnings

### Performance Metrics

The pipeline tracks:
- Pages processed per minute
- Requests per second
- Token usage (estimated)
- Average processing time per page
- Concurrency utilization

---

## 🎛️ Tuning Guide

### When to Increase Concurrency

✅ **Safe to increase if**:
- Consistently under 60% of safe limits
- No 429 errors in logs
- Processing time is the bottleneck

### When to Decrease Concurrency

⚠️ **Decrease if**:
- Seeing 429 errors
- Approaching 80% of safe limits
- Other applications sharing the same API key

### Optimal Settings by Document Size

| Document Size | Line Count | Extraction | Boost |
|--------------|-----------|-----------|-------|
| Small (1-5 pages) | 10 concurrent | 6 concurrent | 5 concurrent |
| Medium (6-20 pages) | 10 concurrent | 6 concurrent | 5 concurrent |
| Large (21-50 pages) | 8 concurrent | 4 concurrent | 4 concurrent |
| Very Large (50+ pages) | 6 concurrent | 3 concurrent | 3 concurrent |

**Rationale**: Larger documents have longer processing times, so lower concurrency prevents timeout issues.

---

## 🔮 Future Optimizations

### Gemini Batch API

For bulk processing (not real-time), consider using Gemini Batch API:

- **Queued Tokens**: 1,000,000,000 (1 billion!)
- **Use Case**: Batch processing of 100+ documents
- **Trade-off**: Higher throughput, but asynchronous (polling required)

### Dynamic Rate Limiting

Implement adaptive rate limiting based on:
- Real-time rate limit headers
- Historical success/failure rates
- Time of day patterns
- Document complexity

### Multi-Region Deployment

For higher throughput:
- Deploy workers in multiple regions
- Use separate API keys per region
- Distribute load across regions

---

## 📚 References

- **Rate Limit Config**: `config/rate-limits.ts`
- **Parallel Utility**: `src/util/retry.ts`
- **Line Counting**: `src/pipeline/ocr_line_count.ts`
- **Text Extraction**: `src/pipeline/ocr_extract.ts`
- **Boost**: `src/pipeline/boost.ts`
- **Gemini Docs**: https://ai.google.dev/gemini-api/docs/rate-limits
- **Claude Docs**: https://docs.anthropic.com/en/api/rate-limits


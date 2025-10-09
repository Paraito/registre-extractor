# Server Capacity Analysis: OCR Workers

## Executive Summary

**Per OCR Worker Requirements**:
- **CPU**: 1-2 cores
- **RAM**: 1-2 GB
- **Disk**: 500MB-1GB temporary storage
- **Network**: Stable internet connection

**Performance**:
- **Processing Time**: 10-30 seconds per document
- **Throughput**: 200-300 documents/hour per worker
- **Cost**: ~$0.001-0.005 per document (Gemini API)

---

## Detailed Resource Analysis

### 1. CPU Requirements

#### PDF to Image Conversion
- **Tool**: ImageMagick or Poppler (pdftoppm)
- **Operation**: Rasterize PDF at 300 DPI to PNG
- **CPU Usage**: Moderate (single-threaded)
- **Duration**: 2-5 seconds per page
- **Cores Needed**: 1-2 cores

**Calculation**:
```
Average document: 1-3 pages
Conversion time: 2-5 seconds per page
CPU utilization: 60-80% during conversion
Idle time: 5-25 seconds (waiting for API)
Average CPU usage: 20-30% over full cycle
```

**Recommendation**: 2 CPU cores per worker for optimal performance

#### Image Processing
- **Operations**: Base64 encoding, memory buffering
- **CPU Usage**: Low
- **Duration**: <1 second

### 2. Memory Requirements

#### Components

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| Node.js Runtime | 50-100 MB | Base process |
| PDF Conversion | 100-500 MB | Depends on document size/complexity |
| Image Buffers | 50-200 MB | 300 DPI PNG images |
| Gemini API Client | 20-50 MB | HTTP client, response buffering |
| Temporary Storage | 50-100 MB | File system cache |
| **Total** | **270-950 MB** | **Peak usage** |

**Recommendation**: 1-2 GB RAM per worker (with safety margin)

#### Memory Profile Over Time

```
Document Processing Cycle (30 seconds):

Memory (MB)
1000 |                    ╱╲
 900 |                   ╱  ╲
 800 |                  ╱    ╲
 700 |                 ╱      ╲
 600 |                ╱        ╲
 500 |               ╱          ╲___
 400 |              ╱                ╲
 300 |             ╱                  ╲
 200 |            ╱                    ╲
 100 |___________╱                      ╲________
   0 |─────────────────────────────────────────
     0s   5s   10s  15s  20s  25s  30s  35s  40s
     
     Download  Convert  Extract  Boost  Cleanup
```

### 3. Disk Requirements

#### Temporary Storage

| File Type | Size | Lifecycle |
|-----------|------|-----------|
| Downloaded PDF | 100KB-5MB | Deleted after processing |
| Converted PNG | 500KB-10MB | Deleted after processing |
| Logs | 1-10MB/day | Rotated daily |

**Calculation**:
```
Concurrent processing: 1 document
Max PDF size: 5 MB
Max PNG size: 10 MB
Buffer space: 2x (safety)
Total: ~30 MB active + 100 MB buffer = 130 MB
```

**Recommendation**: 500MB-1GB for temporary files and logs

#### Disk I/O
- **Read**: Download PDF from Supabase (~1-5 MB)
- **Write**: Save temporary files (~5-15 MB)
- **Pattern**: Sequential, not random
- **IOPS**: Low (<100 IOPS)

**Recommendation**: Standard SSD is sufficient (no NVMe required)

### 4. Network Requirements

#### Bandwidth

| Operation | Direction | Size | Frequency |
|-----------|-----------|------|-----------|
| Download PDF | Inbound | 1-5 MB | Per document |
| Gemini API Request | Outbound | 1-10 MB | 2x per document |
| Gemini API Response | Inbound | 10-100 KB | 2x per document |
| Database Updates | Outbound | 1-50 KB | Per document |

**Calculation**:
```
Per document:
- Download: 2 MB (average)
- API upload: 5 MB (average, 2 calls)
- API response: 50 KB (average, 2 calls)
- DB updates: 10 KB
Total: ~7 MB per document

At 200 docs/hour:
- Bandwidth: 7 MB × 200 = 1.4 GB/hour
- Average: ~400 KB/s
- Peak: ~1-2 MB/s
```

**Recommendation**: 5-10 Mbps sustained, 20 Mbps burst

#### Latency
- **Gemini API**: 2-10 seconds per call (processing time)
- **Supabase Storage**: <1 second (download)
- **Database**: <100ms (updates)

**Requirement**: Stable connection, latency <500ms to Google Cloud

### 5. API Quotas

#### Gemini API Limits

**Free Tier** (if applicable):
- 15 requests per minute
- 1 million tokens per day

**Paid Tier**:
- 1000 requests per minute (default)
- Can request higher limits

**Our Usage**:
```
Per document: 2 API calls
At 200 docs/hour: 400 calls/hour = 6.7 calls/minute
At 300 docs/hour: 600 calls/hour = 10 calls/minute
```

**Conclusion**: Well within limits for single worker. Multiple workers may need quota increase.

---

## Scaling Analysis

### Single Worker Performance

```
Processing Time: 10-30 seconds per document (average: 20s)
Theoretical Max: 180 docs/hour (3 per minute)
Practical Throughput: 200-300 docs/hour (accounting for polling, errors)
```

### Multi-Worker Scaling

| Workers | CPU Cores | RAM (GB) | Throughput (docs/hr) | API Calls/min |
|---------|-----------|----------|----------------------|---------------|
| 1 | 2 | 2 | 200-300 | 7-10 |
| 2 | 4 | 4 | 400-600 | 14-20 |
| 4 | 8 | 8 | 800-1200 | 28-40 |
| 8 | 16 | 16 | 1600-2400 | 56-80 |

**Bottlenecks**:
- **1-4 workers**: Linear scaling (no bottlenecks)
- **4-8 workers**: May hit Gemini API rate limits
- **8+ workers**: Definitely need increased API quota

### Cost Analysis

#### Infrastructure Costs (Monthly)

**Cloud VM (per worker)**:
- **AWS t3.small**: 2 vCPU, 2GB RAM = ~$15/month
- **GCP e2-small**: 2 vCPU, 2GB RAM = ~$13/month
- **Hetzner CX21**: 2 vCPU, 4GB RAM = ~$5/month

**Storage**:
- Minimal (temporary files only) = <$1/month

#### API Costs

**Gemini API Pricing** (as of 2024):
- **gemini-2.0-flash-exp**: $0.00001 per 1K tokens (input), $0.00004 per 1K tokens (output)
- **gemini-2.5-pro**: $0.0001 per 1K tokens (input), $0.0004 per 1K tokens (output)

**Per Document**:
```
Extract (flash):
- Input: ~5K tokens (image) = $0.00005
- Output: ~2K tokens (text) = $0.00008
- Total: ~$0.00013

Boost (pro):
- Input: ~2K tokens (text) = $0.0002
- Output: ~2K tokens (corrected) = $0.0008
- Total: ~$0.001

Total per document: ~$0.00113
```

**Monthly Costs** (at different volumes):

| Volume (docs/month) | API Cost | Infrastructure | Total |
|---------------------|----------|----------------|-------|
| 10,000 | $11 | $15 | $26 |
| 50,000 | $57 | $15 | $72 |
| 100,000 | $113 | $30 (2 workers) | $143 |
| 500,000 | $565 | $75 (5 workers) | $640 |

---

## Deployment Recommendations

### Development Environment
```yaml
CPU: 1-2 cores
RAM: 1 GB
Disk: 10 GB
Workers: 1
Cost: ~$5-10/month
```

### Production Environment (Small)
```yaml
CPU: 2 cores per worker
RAM: 2 GB per worker
Disk: 20 GB
Workers: 1-2
Expected Throughput: 400-600 docs/hour
Cost: ~$20-30/month + API costs
```

### Production Environment (Medium)
```yaml
CPU: 8 cores (4 workers × 2)
RAM: 8 GB (4 workers × 2)
Disk: 50 GB
Workers: 4
Expected Throughput: 800-1200 docs/hour
Cost: ~$60-80/month + API costs
```

### Production Environment (Large)
```yaml
CPU: 16 cores (8 workers × 2)
RAM: 16 GB (8 workers × 2)
Disk: 100 GB
Workers: 8
Expected Throughput: 1600-2400 docs/hour
Cost: ~$120-150/month + API costs
Note: Requires increased Gemini API quota
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Queue Depth**
   ```sql
   SELECT COUNT(*) FROM extraction_queue 
   WHERE status_id = 3 AND document_source = 'index' AND file_content IS NULL;
   ```
   - Alert if > 1000 (backlog building)

2. **Processing Rate**
   ```sql
   SELECT COUNT(*) FROM extraction_queue 
   WHERE status_id = 5 AND updated_at > NOW() - INTERVAL '1 hour';
   ```
   - Alert if < 100/hour (worker issues)

3. **Error Rate**
   ```sql
   SELECT COUNT(*) FROM extraction_queue 
   WHERE error_message LIKE '%OCR%' AND updated_at > NOW() - INTERVAL '1 hour';
   ```
   - Alert if > 5% of processed documents

4. **Resource Usage**
   - CPU: Alert if > 90% sustained
   - Memory: Alert if > 90% sustained
   - Disk: Alert if > 80% used

### Performance Optimization

**If queue is growing**:
1. Check worker health (logs, CPU, memory)
2. Verify Gemini API is responding
3. Add more workers if resources allow
4. Consider increasing API quota

**If processing is slow**:
1. Check network latency to Gemini API
2. Verify disk I/O is not bottlenecked
3. Check for memory swapping
4. Review logs for retry patterns

---

## Conclusion

**Recommended Starting Configuration**:
- **1 OCR Worker**: 2 CPU cores, 2 GB RAM, 20 GB disk
- **Expected Performance**: 200-300 documents/hour
- **Monthly Cost**: ~$15-20 infrastructure + ~$0.001/document API

**Scaling Path**:
1. Start with 1 worker
2. Monitor queue depth and processing rate
3. Add workers linearly as needed
4. Request API quota increase at 4+ workers

This configuration provides excellent cost-efficiency while maintaining high throughput and reliability.


# Qwen3-VL Integration Guide

## Overview

This guide explains how to set up and use **Qwen3-VL-235B-A22B-Instruct-FP8** alongside the existing Gemini OCR system for Quebec land registry documents.

**Key Features**:
- Side-by-side comparison with Gemini
- Shared prompts (edit once, affects both engines)
- Independent servers (Gemini on port 3001, Qwen on port 3002)
- Docker-based deployment with vLLM
- Same test suite structure as Gemini

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Unified Prompts                           │
│              (prompts-unified.js)                            │
│  Edit here → affects both Gemini and Qwen                   │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
              ┌───────────┴───────────┐
              ↓                       ↓
   ┌──────────────────┐    ┌──────────────────┐
   │  Gemini Server   │    │   Qwen Server    │
   │  (port 3001)     │    │  (port 3002)     │
   │                  │    │                  │
   │  • Extract       │    │  • Extract ONLY  │
   │  • Boost  ⭐     │    │  (vision)        │
   └────────┬─────────┘    └────────┬─────────┘
            ↓                       ↓
   ┌──────────────────┐    ┌──────────────────┐
   │  Google Gemini   │    │  vLLM + Qwen3-VL │
   │  API             │    │  (Docker)        │
   └──────────────────┘    └──────────────────┘

WORKFLOW:
1. Qwen3-VL (port 3002): Extract raw text from image (vision task)
2. Gemini (port 3001): Boost raw text (text-only task)

⚠️  Qwen is ONLY used for extraction, NOT boost!
   Boost is text-only and handled by Gemini server.
```

## Hardware Requirements

### For 235B Model (Full Size)

- **GPU**: NVIDIA with 80GB+ VRAM
  - Recommended: 2x A100 80GB or 2x H100 80GB
  - Minimum: 2x RTX 6000 Ada (48GB each, may be tight)

- **RAM**: 128GB+ system RAM
- **Storage**: 500GB+ free space (for model weights)
- **CUDA**: 12.1+ with compute capability 8.0+

### For 7B Model (Smaller Alternative)

- **GPU**: NVIDIA with 16GB+ VRAM
  - Examples: RTX 4090, RTX 3090, A5000, V100

- **RAM**: 32GB+ system RAM
- **Storage**: 50GB+ free space
- **CUDA**: 11.8+

### Alternative: Cloud/API Options

If you don't have local GPU:
- Hugging Face Inference API (paid)
- RunPod (GPU rental)
- Replicate (pay-per-use)
- AWS SageMaker with Inferentia

## Installation

### Step 1: Install Docker + NVIDIA Runtime

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Verify GPU access
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### Step 2: Configure Environment

```bash
cd backend

# Copy Qwen environment template
cp .env.qwen.example .env.qwen

# Edit configuration
vim .env.qwen
```

**For local vLLM (default)**:
```env
QWEN_API_URL=http://localhost:8000/v1
QWEN_MODEL_NAME=qwen3-vl
QWEN_TIMEOUT=300000
```

**For Hugging Face API** (if no GPU):
```env
QWEN_API_URL=https://api-inference.huggingface.co/models/Qwen/Qwen3-VL-235B-A22B-Instruct-FP8
QWEN_HF_TOKEN=hf_your_token_here
QWEN_TIMEOUT=600000
```

### Step 3: Download Model (Optional)

Pre-download model to avoid waiting during first start:

```bash
# Create models directory
mkdir -p backend/models backend/cache

# Download using huggingface-cli
pip install -U "huggingface_hub[cli]"

huggingface-cli download Qwen/Qwen3-VL-235B-A22B-Instruct-FP8 \
  --local-dir backend/models/Qwen3-VL-235B-A22B-Instruct-FP8 \
  --local-dir-use-symlinks False
```

This downloads ~300GB and may take 1-3 hours depending on your connection.

### Step 4: Start vLLM Server

**For 235B model** (requires 80GB+ VRAM):
```bash
docker-compose -f backend/docker-compose.qwen.yml up -d

# Watch logs
docker-compose -f backend/docker-compose.qwen.yml logs -f qwen-vllm
```

**For 7B model** (requires 16GB+ VRAM):
```bash
docker-compose -f backend/docker-compose.qwen.yml --profile small up -d

# Watch logs
docker-compose -f backend/docker-compose.qwen.yml logs -f qwen-vllm-7b
```

**First startup**: May take 5-15 minutes to load model into GPU memory.

### Step 5: Verify vLLM Health

```bash
# Check health endpoint
curl http://localhost:8000/health

# Expected response:
# {"status": "ok"}

# Test inference
curl http://localhost:8000/v1/models

# Expected: List of available models
```

### Step 6: Start Qwen Backend Server

```bash
cd backend
npm run start:qwen

# Expected output:
# 🚀 Qwen OCR Server running on http://localhost:3002
# ✅ Qwen client configured
#    API URL: http://localhost:8000/v1
#    Model: qwen3-vl
```

## Usage

### Test Qwen Backend

```bash
cd backend
npm run test:qwen
```

This runs the Qwen equivalent of `test-backend.js` (11 tests).

### Test Qwen with PDF URL

```bash
npm run test:qwen:pages <pdf-url>

# Example:
npm run test:qwen:pages "https://example.com/document.pdf"

# With options:
npm run test:qwen:pages <pdf-url> --pages=1,2,3 --delay=2000
```

### Compare Gemini vs Qwen

```bash
npm run test:compare <pdf-url>

# This processes the same PDF with BOTH engines and shows side-by-side results
```

**Expected output**:
```
╔══════════════════════════════════════════════════════════════════╗
║ COMPARISON TEST - PAGE 1                                         ║
╚══════════════════════════════════════════════════════════════════╝

┌─ GEMINI (gemini-2.5-pro) ─────────────────────────────────────────┐
│ Time: 3.2s                                                         │
│ Inscriptions: 12/12                                                │
│ [RAW OUTPUT...]                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ QWEN (Qwen3-VL-235B) ────────────────────────────────────────────┐
│ Time: 1.8s (44% faster)                                            │
│ Inscriptions: 12/12                                                │
│ [RAW OUTPUT...]                                                    │
└────────────────────────────────────────────────────────────────────┘

📊 Differences: [detailed comparison]
```

### Run Both Servers Simultaneously

```bash
# Terminal 1: Gemini
cd backend
npm start

# Terminal 2: Qwen
cd backend
npm run start:qwen

# Or use concurrently (requires npm install concurrently)
npm run start:both
```

## API Endpoints

### Qwen Extract Text

**Endpoint**: `POST http://localhost:3002/api/qwen-extract`

**Request**:
```json
{
  "imageData": "base64_encoded_image",
  "mimeType": "image/png",
  "temperature": 0.1,
  "maxRetries": 8,
  "delayMs": 1000
}
```

**Response**:
```json
{
  "text": "{\n  \"is_completed\": true,\n  \"inscriptions_detected\": 12,\n  \"inscriptions_extracted\": 12,\n  \"extracted_content\": [...]\n}",
  "is_completed": true,
  "attempts": 1,
  "stats": {
    "inscriptions_detected": 12,
    "inscriptions_extracted": 12
  }
}
```

### Gemini Boost Text (Used After Qwen Extraction)

**⚠️ Important**: Boost is handled by Gemini server, NOT Qwen!

**Endpoint**: `POST http://localhost:3001/api/boost` (Gemini server)

**Request**:
```json
{
  "rawText": "{...raw extraction JSON from Qwen...}",
  "temperature": 0.2,
  "maxRetries": 8,
  "delayMs": 1000
}
```

**Response**:
```json
{
  "boostedText": "{...boosted JSON...}",
  "is_completed": true,
  "attempts": 1
}
```

**Why Gemini for boost?**
- Boost is text-only (no image needed)
- Gemini excels at text processing
- Qwen3-VL is optimized for vision tasks

### Health Check

**Endpoint**: `GET http://localhost:3002/health`

**Response**:
```json
{
  "status": "ok",
  "message": "Qwen backend is running",
  "engine": "Qwen3-VL",
  "model": "qwen3-vl"
}
```

## Troubleshooting

### Issue: Docker fails to start

**Error**: `docker: Error response from daemon: could not select device driver "" with capabilities: [[gpu]]`

**Solution**:
```bash
# Install NVIDIA Container Toolkit
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Verify
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### Issue: Out of memory (OOM)

**Error**: `OutOfMemoryError: CUDA out of memory`

**Solutions**:
1. **Use smaller model (7B)**:
   ```bash
   docker-compose -f backend/docker-compose.qwen.yml --profile small up
   ```

2. **Reduce GPU memory utilization**:
   Edit `docker-compose.qwen.yml`:
   ```yaml
   command: >
     ...
     --gpu-memory-utilization 0.70  # Reduce from 0.85
   ```

3. **Reduce max model length**:
   ```yaml
   command: >
     ...
     --max-model-len 4096  # Reduce from 8192
   ```

4. **Use quantization** (already using FP8):
   The 235B-A22B-Instruct-FP8 is already quantized to FP8.

### Issue: Model download is slow

**Solution**:
Use Hugging Face mirror or pre-download:
```bash
# Set mirror (China example)
export HF_ENDPOINT=https://hf-mirror.com

# Download
huggingface-cli download Qwen/Qwen3-VL-235B-A22B-Instruct-FP8 \
  --local-dir backend/models/Qwen3-VL-235B-A22B-Instruct-FP8
```

### Issue: vLLM startup takes forever

**Symptoms**: Container starts but health check fails after 5+ minutes.

**Debug**:
```bash
# Check logs
docker-compose -f backend/docker-compose.qwen.yml logs qwen-vllm

# Look for errors like:
# - Model not found
# - CUDA errors
# - Memory issues
```

**Solutions**:
- Increase `start_period` in healthcheck (default: 300s)
- Check disk space for model cache
- Verify model path in docker-compose.yml

### Issue: Qwen gives different results than Gemini

**This is expected!** Different models have different capabilities and biases.

**To verify prompts are identical**:
```bash
npm run test:compare <pdf-url>

# Check for:
#   ✓ Both engines using prompts from prompts-unified.js
#   ✓ Prompt hash: a3f2d9e1 (identical)
```

### Issue: Requests timeout

**Error**: `Request timeout after 300000ms`

**Solutions**:
1. Increase timeout in `.env.qwen`:
   ```env
   QWEN_TIMEOUT=600000  # 10 minutes
   ```

2. Check vLLM server health:
   ```bash
   curl http://localhost:8000/health
   ```

3. Monitor GPU usage:
   ```bash
   nvidia-smi -l 1  # Updates every second
   ```

## Performance Comparison

### Expected Performance (235B Model)

| Metric | Gemini 2.5 Pro | Qwen3-VL 235B | Notes |
|--------|----------------|---------------|-------|
| **Speed** | 3-5s/page | 1.5-3s/page | Qwen faster (local GPU) |
| **Accuracy** | 94-96% | 96-98% | Varies by document |
| **Cost** | $0.001/page | Free (self-hosted) | GPU electricity cost |
| **Context** | 65K tokens | 256K tokens | Qwen handles longer docs |

### Expected Performance (7B Model)

| Metric | Gemini 2.5 Pro | Qwen3-VL 7B | Notes |
|--------|----------------|-------------|-------|
| **Speed** | 3-5s/page | 0.5-1.5s/page | Qwen much faster |
| **Accuracy** | 94-96% | 90-93% | Gemini more accurate |
| **Cost** | $0.001/page | Free (self-hosted) | Lower GPU requirements |
| **Context** | 65K tokens | 32K tokens | Sufficient for most docs |

## Cost Analysis

### Gemini (API)
- **Cost**: $0.00125 per 1K input tokens + $0.005 per 1K output tokens
- **Average page**: ~2K input + 1K output = $0.0075/page
- **1000 pages/month**: ~$7.50/month

### Qwen 235B (Self-Hosted)
- **Hardware**: 2x A100 80GB ($3/hour on cloud)
- **Electricity**: ~$0.30/hour (home, 1.5kW @ $0.20/kWh)
- **Running 24/7**: $216/month (electricity only)
- **Pay-per-use** (cloud): $0.03-0.05/page

### Break-Even Analysis

**Self-hosted is cheaper if**:
- Processing >10,000 pages/month consistently
- Have existing GPU infrastructure
- GPU used for other tasks too

**API is cheaper if**:
- Processing <5,000 pages/month
- Sporadic usage
- No GPU infrastructure

## Advanced Configuration

### Multi-GPU Setup

Edit `docker-compose.qwen.yml`:
```yaml
command: >
  --model Qwen/Qwen3-VL-235B-A22B-Instruct-FP8
  --tensor-parallel-size 4  # Use 4 GPUs
  --gpu-memory-utilization 0.90
```

### Batch Processing

For large batches, use vLLM's batch inference:
```javascript
// In qwen-client.js, add batch support
async generateBatch(messages[], options = {}) {
  // Send multiple requests in parallel
  const results = await Promise.all(
    messages.map(msg => this.generateContent(msg, options))
  );
  return results;
}
```

### Custom vLLM Serving

For more control, run vLLM directly:
```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-VL-235B-A22B-Instruct-FP8 \
  --served-model-name qwen3-vl \
  --dtype float8 \
  --max-model-len 8192 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.85 \
  --trust-remote-code \
  --port 8000
```

## Best Practices

### ✅ DO

- Pre-download models before first use
- Monitor GPU memory usage
- Use rate limiting for sustained loads
- Test with small model (7B) first
- Compare results with Gemini regularly

### ❌ DON'T

- Run out of disk space (models are large!)
- Forget to set tensor-parallel-size for multi-GPU
- Use 235B model without sufficient VRAM
- Skip health checks before processing
- Modify prompts in server files (use prompts-unified.js)

## Next Steps

1. **Read**: [PROMPT_ARCHITECTURE.md](./PROMPT_ARCHITECTURE.md) - Understand unified prompts
2. **Read**: [COMPARISON_GUIDE.md](./COMPARISON_GUIDE.md) - How to compare engines
3. **Test**: Run comparison on sample PDFs
4. **Optimize**: Tune temperature, batch size, memory settings
5. **Monitor**: Track accuracy, speed, cost metrics

## Support

- **vLLM Issues**: https://github.com/vllm-project/vllm/issues
- **Qwen3-VL Issues**: https://github.com/QwenLM/Qwen3-VL/issues
- **OCR King Issues**: [Your repo issues]

## License

Same as main project (MIT).

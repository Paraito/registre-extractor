# 🔧 Registre Extractor Recovery Strategy

**Date**: October 15, 2025  
**Goal**: Restore system to "VERY VERY good" quality from 2-3 weeks ago while keeping OCR functionality

---

## 📊 Root Cause Analysis

### Timeline of System Quality

| Period | Status | Key Features |
|--------|--------|--------------|
| **Sept 25 (2b22234, adaa2c4)** | ✅ **VERY GOOD** | IndexFallbackHandler with LLM, Vision analyzer working |
| **Oct 9-13 (fa1dd6e, 760df3d)** | ✅ **EXCELLENT** | OCR added, Claude fallback, Docker deployment |
| **Oct 14 (88f0310, 83ae39a)** | ⚠️ **CLEANUP** | Removed Docker, archived OCR (intended simplification) |
| **Oct 14 (5cf2bd3+)** | ❌ **BROKEN** | OCR restored WITHOUT Docker, Playwright not installed |
| **Current** | ❌ **BROKEN** | Single worker, Playwright errors, extraction failures |

### What Made It "VERY VERY Good"

1. **Intelligent Fallback System** (Sept 25):
   - `IndexFallbackHandler` with LLM-based cadastre/designation selection
   - OpenAI Vision API for screenshot analysis
   - Multiple retry strategies with smart option matching

2. **Robust OCR Pipeline** (Oct 9-13):
   - Gemini File API for index documents
   - Claude fallback for reliability
   - Acte OCR processor with dual-phase extraction
   - Sanitization for structured output

3. **Proper Infrastructure** (Oct 10):
   - Docker deployment with all dependencies
   - Playwright browsers properly installed
   - Multiple concurrent workers

### What Broke

1. **Playwright Installation Missing**:
   - Docker removed but Playwright system deps not installed on server
   - `npx playwright install chromium` only installs browsers, NOT system libraries
   - Server needs: `npx playwright install-deps chromium`

2. **Single Worker Configuration**:
   - `ecosystem.config.js` has `instances: 1` for registre-worker
   - `.env.example` shows `WORKER_COUNT=1`
   - Lost concurrency that allowed multiple docs simultaneously

3. **Incomplete Cleanup**:
   - OCR system restored but Docker infrastructure not restored
   - Configuration mismatch between deployment method and code expectations

---

## 🎯 Recovery Strategy

### Phase 1: Restore Infrastructure (CRITICAL - Do First)

#### Option A: Restore Docker Deployment (RECOMMENDED)
**Why**: Docker ensures all dependencies are properly installed and isolated

**Steps**:
1. Restore Dockerfile from commit a37ae00
2. Restore docker-compose.yml (if exists in archives)
3. Update deployment to use Docker instead of direct PM2
4. All Playwright dependencies handled automatically

**Pros**:
- ✅ Guaranteed working environment
- ✅ All dependencies managed
- ✅ Easier to scale
- ✅ Matches the "very good" period setup

**Cons**:
- ⚠️ Requires Docker on server
- ⚠️ Different deployment workflow

#### Option B: Fix PM2 Deployment
**Why**: Keep current deployment method but fix dependencies

**Steps**:
1. SSH to server
2. Run: `npx playwright install-deps chromium`
3. Run: `npx playwright install chromium`
4. Verify: `npx playwright --version`

**Pros**:
- ✅ Keep current deployment workflow
- ✅ Simpler if Docker not available

**Cons**:
- ⚠️ Manual dependency management
- ⚠️ May break on system updates
- ⚠️ Harder to reproduce environment

### Phase 2: Restore Concurrency

#### Fix Worker Configuration

**Current State**:
```javascript
// ecosystem.config.js
{
  name: 'registre-worker',
  script: 'dist/worker/index.js',
  instances: 1,  // ❌ ONLY 1 INSTANCE
}
```

**Target State**:
```javascript
{
  name: 'registre-worker',
  script: 'dist/worker/index.js',
  instances: 3,  // ✅ MULTIPLE INSTANCES for concurrency
  exec_mode: 'cluster',  // ✅ Enable cluster mode
}
```

**Environment Variables**:
```bash
# .env
WORKER_COUNT=3  # Number of workers per PM2 instance
WORKER_CONCURRENCY=20  # Jobs per worker (already correct)
```

**Total Concurrency**: 3 instances × 3 workers × 20 concurrency = 180 potential concurrent jobs

### Phase 3: Verify Core Extraction Quality

#### Ensure Vision Analyzer is Active

**Check**:
- `src/utils/vision-analyzer.ts` exists ✅
- `OPENAI_API_KEY` is set in .env
- Vision fallback is used in `extractor-ai.ts`

**Verify**:
```typescript
// src/worker/extractor-ai.ts should have:
this.visionAnalyzer = new VisionAnalyzer(config.openai.apiKey);
```

#### Ensure IndexFallbackHandler is Active

**Check**:
- `src/worker/extractor-index-fallback.ts` exists ✅
- LLM-based cadastre/designation selection is enabled
- Fallback triggers on "inexistante" errors

### Phase 4: Verify OCR System

#### Ensure OCR Workers are Properly Configured

**Current**:
```javascript
// ecosystem.config.js
{
  name: 'registre-ocr',
  script: 'dist/ocr/start-ocr-workers.js',
  instances: 1,
  env: {
    OCR_WORKER_COUNT: 5  // ✅ Good - 5 OCR workers
  }
}
```

**Environment**:
```bash
GEMINI_API_KEY=xxx  # Required
CLAUDE_API_KEY=xxx  # For fallback
OCR_PROD=true       # Enable for production
```

---

## 📋 Implementation Checklist

### Immediate Actions (Do Today)

- [ ] **1. Choose Infrastructure Path**
  - [ ] Option A: Restore Docker (recommended)
  - [ ] Option B: Install Playwright deps on server

- [ ] **2. Fix Playwright Installation**
  - [ ] If Docker: Restore Dockerfile from a37ae00
  - [ ] If PM2: Run `npx playwright install-deps chromium` on server

- [ ] **3. Restore Worker Concurrency**
  - [ ] Update `ecosystem.config.js` instances to 3
  - [ ] Add `exec_mode: 'cluster'`
  - [ ] Set `WORKER_COUNT=3` in .env

- [ ] **4. Verify Environment Variables**
  - [ ] OPENAI_API_KEY (for vision fallback)
  - [ ] AGENTQL_API_KEY (for AI extraction)
  - [ ] GEMINI_API_KEY (for OCR)
  - [ ] CLAUDE_API_KEY (for OCR fallback)

### Testing & Verification

- [ ] **5. Test Extraction Worker**
  - [ ] Create test job for index document
  - [ ] Verify Playwright launches successfully
  - [ ] Verify vision fallback works
  - [ ] Verify IndexFallbackHandler triggers on errors

- [ ] **6. Test OCR Worker**
  - [ ] Create test job that completes extraction
  - [ ] Verify OCR picks up completed job
  - [ ] Verify Gemini processes document
  - [ ] Verify Claude fallback if Gemini fails

- [ ] **7. Test Concurrency**
  - [ ] Create 10 test jobs
  - [ ] Verify multiple workers process simultaneously
  - [ ] Check PM2 logs show multiple workers active

### Monitoring

- [ ] **8. Set Up Monitoring**
  - [ ] Monitor PM2 logs: `pm2 logs`
  - [ ] Check worker status: `pm2 list`
  - [ ] Monitor database for stuck jobs
  - [ ] Check error rates in Supabase

---

## 🚀 Recommended Implementation Order

### Step 1: Restore Docker (Recommended Path)

```bash
# 1. Restore Dockerfile
git show a37ae00:Dockerfile > Dockerfile

# 2. Create docker-compose.yml (if needed)
# See next section for template

# 3. Build and deploy
docker-compose build
docker-compose up -d

# 4. Verify
docker-compose ps
docker-compose logs -f registre-worker
```

### Step 2: Update Worker Configuration

```bash
# Edit ecosystem.config.js or create docker-compose.yml with proper scaling
```

### Step 3: Deploy and Test

```bash
# If Docker:
docker-compose restart

# If PM2:
npm run build
pm2 restart ecosystem.config.js
pm2 save
```

---

## 📈 Expected Results After Recovery

### Performance Metrics

| Metric | Before (Broken) | After (Recovered) |
|--------|----------------|-------------------|
| Concurrent Extractions | 1 | 9-60 (depending on config) |
| Playwright Errors | 100% | 0% |
| Extraction Success Rate | <50% | >95% |
| OCR Processing | Broken | Working with fallback |
| Vision Fallback | Not working | Working |

### System Health Indicators

✅ **Healthy System**:
- PM2 shows all workers online
- No Playwright browser errors
- Jobs move from "En attente" → "En traitement" → "Complete"
- OCR picks up completed jobs within 10 seconds
- Vision analyzer provides fallback suggestions
- IndexFallbackHandler successfully retries with different options

❌ **Unhealthy System** (Current):
- Playwright browser not found errors
- waitForSelector timeouts
- Jobs stuck in "En traitement"
- Single worker processing sequentially

---

## 🔍 Debugging Commands

```bash
# Check Playwright installation
npx playwright --version
npx playwright install --dry-run chromium

# Check PM2 status
pm2 list
pm2 logs registre-worker --lines 100
pm2 logs registre-ocr --lines 100

# Check worker processes
ps aux | grep node

# Check database for stuck jobs
# (Run in Supabase SQL editor)
SELECT status_id, COUNT(*) 
FROM extraction_queue 
GROUP BY status_id;

# Check recent errors
SELECT * FROM extraction_queue 
WHERE status_id = 4 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 📞 Next Steps

**Choose your path and I'll implement it**:

1. **🐳 Docker Path** (Recommended):
   - I'll restore the Dockerfile
   - Create docker-compose.yml with proper scaling
   - Update deployment documentation

2. **⚡ PM2 Path** (Faster but less robust):
   - I'll provide server commands to install Playwright deps
   - Update ecosystem.config.js for concurrency
   - Create deployment script

**Which path do you prefer?**


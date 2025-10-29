# Worker Status Report

**Last Updated**: October 29, 2025  
**Deployment Method**: PM2 (recommended over Docker for single-server)

---

## ✅ FULLY WORKING WORKERS

### 1. Registre Extraction Workers (9 workers)

**Status**: ✅ **FULLY OPERATIONAL** with new fallback mechanisms

**What They Do**:
- Extract documents from Quebec Land Registry (Registre foncier du Québec)
- Handle three document types: `acte`, `index`, `plan_cadastraux`

**New Features (Oct 2025)**:
- ✅ **Acte Fallback**: Automatically tries alternative acte types on failure
  - Sequence: `Acte` → `Acte divers` → `Radiation`
  - Uses LLM-powered option selection with fuzzy matching fallback
  - Implemented in: `src/worker/extractor-acte-fallback.ts`

- ✅ **Plan Cadastraux Fallback**: Tries different cadastre/designation combinations
  - Similar to index fallback mechanism
  - Uses LLM for intelligent dropdown selection
  - Implemented in: `src/worker/extractor-plan-cadastraux-fallback.ts`

- ✅ **Confirmation Page Handling**: Handles large file download confirmations
  - Detects URL pattern: `pf_13_01_13_confr_demnd.asp`
  - Automatically clicks "Confirmer" button
  - Implemented in: `src/worker/extractor-ai.ts`

**Configuration**:
- **PM2 Instances**: 3
- **Workers per Instance**: 3
- **Total Workers**: 9
- **Memory Limit**: 1GB per PM2 instance
- **Script**: `dist/worker/index.js`

**Environment Variables Required**:
```bash
SUPABASE_URL_PROD=https://your-project.supabase.co
SUPABASE_SERVICE_KEY_PROD=your-service-key
OPENAI_API_KEY=your-openai-key  # Optional, for LLM fallback selection
```

---

### 2. OCR Workers (5 workers)

**Status**: ✅ **FULLY OPERATIONAL**

**What They Do**:
- Process extracted documents with OCR (Optical Character Recognition)
- Use Gemini File API or Claude for document analysis
- Extract structured data from PDF documents

**Process Flow**:
1. Poll for jobs with `status_id=3` (COMPLETE) that have `supabase_path`
2. Download PDF from Supabase storage
3. Process with Gemini/Claude OCR
4. Update job with `status_id=5` (EXTRACTION_COMPLETE) and `file_content`

**Configuration**:
- **PM2 Instances**: 1
- **Workers**: 5 concurrent workers
- **Memory Limit**: 768MB
- **Script**: `dist/ocr/start-ocr-workers.js`

**Environment Variables Required**:
```bash
GEMINI_API_KEY=your-gemini-key
# OR
CLAUDE_API_KEY=your-claude-key

# OCR Environment Flags
OCR_PROD=true
OCR_STAGING=false
OCR_DEV=false
```

---

### 3. Health Monitor (1 instance)

**Status**: ✅ **FULLY OPERATIONAL**

**What It Does**:
- Monitors worker health and system status
- Tracks worker heartbeats
- Reports system metrics

**Configuration**:
- **PM2 Instances**: 1
- **Memory Limit**: 256MB
- **Script**: `dist/monitor/index.js`

---

### 4. API Server (1 instance)

**Status**: ✅ **FULLY OPERATIONAL**

**What It Does**:
- REST API for job management and monitoring
- Provides worker status endpoints
- Handles job queue operations

**Endpoints**:
- `GET /api/workers` - List all workers and their status
- `GET /api/jobs` - List recent jobs
- `POST /api/jobs` - Create new extraction job
- And more...

**Configuration**:
- **PM2 Instances**: 1
- **Port**: 3000
- **Memory Limit**: 512MB
- **Script**: `dist/api/index.js`

**Test**:
```bash
curl http://localhost:3000/api/workers | jq
```

---

## ✅ NEWLY IMPLEMENTED

### 1. REQ Workers

**Status**: ✅ **IMPLEMENTED**

**What They Do**:
- Scrape Registre des Entreprises du Québec (Quebec Business Registry)
- Extract company information by NEQ (Numéro d'entreprise du Québec)
- Extract director/officer names for RDPRM searches

**Implementation**:
- Full implementation in `src/req/scraper.ts`
- Uses Playwright + AgentQL for AI-powered scraping
- Searches by company name or NEQ number
- Extracts company details including directors
- Saves results to `req_companies` and `req_company_details` tables

**Features**:
- AI-powered element detection with AgentQL
- Automatic company search and selection
- Director name extraction for RDPRM
- Error handling and logging

---

### 2. RDPRM Workers

**Status**: ✅ **IMPLEMENTED**

**What They Do**:
- Scrape Registre des Droits Personnels et Réels Mobiliers
- Extract personal and movable real rights information
- Download results as PDF

**Implementation**:
- Full implementation in `src/rdprm/scraper.ts`
- Uses Playwright + AgentQL for AI-powered scraping
- Searches by person/company name
- Downloads results as PDF
- Handles "no results" cases gracefully

**Features**:
- AI-powered element detection with AgentQL
- Automatic terms acceptance
- Result detection (has results vs no results)
- PDF download and storage
- Error handling and logging

---

## Worker Architecture

### Current Setup (PM2)

```
ecosystem.config.js
├── registre-worker (3 PM2 instances × 3 workers = 9 workers)
│   └── Uses: src/worker/index.ts → dist/worker/index.js
│       └── Handles: acte, index, plan_cadastraux extraction
│
├── registre-ocr (1 PM2 instance, 5 workers)
│   └── Uses: src/ocr/start-ocr-workers.ts → dist/ocr/start-ocr-workers.js
│       └── Handles: OCR processing with Gemini/Claude
│
├── registre-monitor (1 PM2 instance)
│   └── Uses: src/monitor/index.ts → dist/monitor/index.js
│       └── Handles: Health monitoring
│
└── registre-api (1 PM2 instance)
    └── Uses: src/api/index.ts → dist/api/index.js
        └── Handles: REST API (port 3000)
```

### Alternative Setup (Unified Worker - Not Used)

```
src/worker/unified-worker.ts
├── Handles: extraction, REQ, RDPRM jobs
├── Status: Code exists but not used in ecosystem.config.js
└── Problem: REQ and RDPRM scrapers not implemented
```

---

## Deployment

### Quick Deploy

```bash
./deploy-pm2.sh
```

### Manual Deploy

```bash
git pull origin main
npm install
npm run build
docker compose down  # Stop Docker if running
pm2 restart ecosystem.config.js
pm2 save
pm2 list
```

### Verify Deployment

```bash
# Check PM2 status
pm2 list

# Check worker status via API
curl http://localhost:3000/api/workers | jq

# Check logs
pm2 logs --lines 50

# Check for zombie processes
ps aux | grep 'Z' | wc -l
```

---

## Summary

| Component | Status | Count | Notes |
|-----------|--------|-------|-------|
| **Registre Workers** | ✅ Working | 9 workers | With new fallback mechanisms |
| **OCR Workers** | ✅ Working | 5 workers | Gemini/Claude OCR |
| **Monitor** | ✅ Working | 1 instance | Health monitoring |
| **API Server** | ✅ Working | 1 instance | Port 3000 |
| **REQ Workers** | ❌ Not Implemented | - | Placeholder only |
| **RDPRM Workers** | ❌ Not Implemented | - | Placeholder only |

**Total Working**: 4 PM2 apps, 15 workers  
**Total Not Working**: 2 worker types (REQ, RDPRM)

---

## Next Steps

To implement REQ and RDPRM workers:

1. **Implement REQ Scraper** (`src/req/scraper.ts`)
   - Define scraping logic for Quebec Business Registry
   - Handle authentication and session management
   - Extract company data by NEQ

2. **Implement RDPRM Scraper** (`src/rdprm/scraper.ts`)
   - Define scraping logic for Personal/Movable Rights Registry
   - Handle authentication and session management
   - Extract rights information

3. **Switch to Unified Worker** (optional)
   - Update `ecosystem.config.js` to use `dist/worker/unified-worker.js`
   - This will enable all three job types (registre, REQ, RDPRM)
   - Only do this after implementing REQ and RDPRM scrapers

4. **Test Thoroughly**
   - Test REQ scraping with sample companies
   - Test RDPRM scraping with sample searches
   - Verify error handling and retry logic
   - Monitor for zombie processes

---

**For questions or issues, see**: `PM2-DEPLOYMENT.md`


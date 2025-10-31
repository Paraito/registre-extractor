# RDPRM 2 - High-Level Architecture & File Structure

## Project Overview

RDPRM 2 is a **local development tool** that automates data extraction from two Quebec government registries:

1. **REQ (Registre des Entreprises du Québec)** - Company registry
2. **RDPRM (Registre des droits personnels et réels mobiliers)** - Personal and movable property rights

**Purpose:** Research and data collection for due diligence on Quebec companies.

**Key Characteristic:** Designed for **local execution** with visible browser for debugging, NOT production server deployment.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User/Client                          │
│  (Creates search session, selects company names)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     Supabase Database                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  search_sessions (parent)                           │    │
│  │    ↓                                                 │    │
│  │  selected_names_for_rdprm ─[TRIGGER]→ rdprm_searches│    │
│  │                              (status: pending)       │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Polls every 10s
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    RDPRM Worker Process                      │
│                  (rdprm-worker.ts)                          │
│                                                              │
│  while (isRunning):                                         │
│    1. SELECT * FROM rdprm_searches WHERE status='pending'   │
│    2. UPDATE status='in_progress'                           │
│    3. Call scraper: scrapeFicheComplete()                   │
│    4. UPDATE status='completed' with storage_path           │
│    5. Check if session complete                             │
│    6. Sleep 10 seconds                                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Calls
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  RDPRM Scraper (lib/rdprm.ts)               │
│                                                              │
│  1. Launch Chromium (headless: false)                       │
│  2. Navigate + Login (networkidle waits)                    │
│  3. Search company                                          │
│  4. Download PDF (4 fallback strategies)                    │
│  5. Upload to Supabase Storage                              │
│  6. Return storage path                                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase Storage                          │
│                   Bucket: rdprm-documents                   │
│                                                              │
│  session-id-1/                                              │
│    ├── company_name_1.pdf                                   │
│    ├── company_name_2.pdf                                   │
│    └── company_name_3.pdf                                   │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
/Users/marco/Documents/Dev/RDPRM 2/
│
├── 📄 Worker Entry Points (Main Processes)
│   ├── rdprm-worker.ts         # RDPRM background worker (296 lines)
│   └── req-worker.ts           # REQ background worker (225 lines)
│
├── 📁 lib/ (Core Library)
│   ├── rdprm.ts                # RDPRM scraper automation (573 lines)
│   ├── registre-entreprise.ts  # REQ scraper
│   ├── html-cleaner.ts         # Parse/clean HTML (345 lines)
│   ├── supabase.ts             # Database client (76 lines)
│   ├── storage.ts              # File utilities (14 lines)
│   └── gemini.ts               # AI analysis
│
├── 📁 supabase/ (Database Schema)
│   └── migrations/
│       ├── 001_simplified_schema.sql
│       ├── 002_add_cleaned_data.sql
│       ├── 003_trigger_rdprm_on_name_selection.sql  # CRITICAL TRIGGER
│       ├── 004_add_req_tracking.sql
│       ├── 20250122000000_fix_rdprm_trigger.sql
│       └── 20250122010000_add_rdprm_storage.sql
│
├── 📁 Test/Debug Scripts
│   ├── test-rdprm-workflow.ts
│   ├── test-registre.ts
│   ├── debug-rdprm.ts
│   └── verify-database.ts
│
├── ⚙️ Configuration Files
│   ├── package.json            # Dependencies (Playwright 1.48.0)
│   ├── playwright.config.ts    # Browser configuration
│   ├── tsconfig.json           # TypeScript config
│   ├── .env.example            # Environment template
│   └── .env                    # Secrets (not committed)
│
└── 📁 data/ (Local Storage)
    └── Screenshots, downloads, session cache
```

## Component Purposes

### 1. Worker Files (Background Processes)

**rdprm-worker.ts** - Main RDPRM worker
- Polls `rdprm_searches` table every 10 seconds
- Processes pending searches one at a time
- Updates status: pending → in_progress → completed/failed/not_found
- Checks session completion after each search

**req-worker.ts** - REQ company search worker
- Polls `search_sessions` for pending company selections
- Uses BrowserBase (cloud browsers) for REQ scraping
- Stores results in `req_companies` table

### 2. Core Library Files

**lib/rdprm.ts** - Browser automation
- **573 lines** of Playwright automation
- Handles: login, navigation, search, PDF download
- 4-layer fallback strategy for PDF acquisition
- Returns storage path after upload

**lib/html-cleaner.ts** - Data extraction
- Parses raw HTML from REQ results
- Extracts structured data (administrators, fusions, etc.)
- Cleans and normalizes company information

**lib/supabase.ts** - Database client
- Initializes Supabase client with service role key
- Provides storage bucket access
- 76 lines of client setup

**lib/storage.ts** - File system utilities
- Ensures data directory exists
- Generates safe filenames from company names
- 14 lines of utility functions

### 3. Database Migrations

**Critical migration:** `003_trigger_rdprm_on_name_selection.sql`

Creates the automatic job creation trigger:
```sql
CREATE TRIGGER on_selected_name_insert
  AFTER INSERT ON selected_names_for_rdprm
  FOR EACH ROW
  EXECUTE FUNCTION trigger_rdprm_search_on_name_insert();
```

**Effect:** When a name is selected, a pending RDPRM search is automatically created.

### 4. Configuration Files

**package.json** - Key dependencies:
```json
{
  "dependencies": {
    "playwright": "1.48.0",              // Locked version
    "@supabase/supabase-js": "^2.76.1",
    "dotenv": "16.4.5"
  }
}
```

**playwright.config.ts** - Browser settings (likely default Playwright config)

**tsconfig.json** - TypeScript compilation with ES modules

**.env** - Runtime secrets:
```env
RDPRM_USER=DVA3
RDPRM_PASS=Rdprm123!!!
RDPRM_SEC=RDPRM
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Data Flow

### REQ Search Flow
```
User creates session
  → REQ worker polls
  → BrowserBase scrapes company results
  → Stores in req_companies table
  → User selects company
  → Names extracted to selected_names_for_rdprm
  → TRIGGER creates rdprm_searches
```

### RDPRM Search Flow
```
selected_names_for_rdprm INSERT
  → TRIGGER creates rdprm_searches (pending)
  → RDPRM worker polls (every 10s)
  → Claims job (status: in_progress)
  → Launches browser (headless: false)
  → Login + Navigate + Search
  → Download PDF (4 strategies)
  → Upload to Supabase Storage
  → Update rdprm_searches (status: completed, storage_path)
  → Check if all session searches done
  → If yes: search_sessions.status = completed
```

## Key Design Decisions

### 1. Local Execution Only
- `headless: false` - Visible browser for debugging
- `slowMo: 500` - Slowed down for human observation
- Runs on Mac with display (won't work on headless server)

### 2. Polling Architecture
- Simple polling loop (every 10 seconds)
- No job queue infrastructure (Redis, Bull, etc.)
- In-memory concurrency tracking only

### 3. Automatic Job Creation
- Database trigger eliminates manual job queuing
- Tight coupling between name selection and RDPRM search
- Fully automated workflow

### 4. Storage Organization
- Supabase Storage bucket: `rdprm-documents`
- Path structure: `{sessionId}/{companyName}.pdf`
- Private bucket (requires authentication)

### 5. Error Handling
- Three terminal states: completed, failed, not_found
- No automatic retry (manual intervention required)
- Error messages stored in database

## Scalability Limitations

1. **Single worker only** - `MAX_CONCURRENT=1` default
2. **No distributed locking** - Race conditions if multiple workers
3. **Visible browser required** - Can't run in containers/cloud
4. **Local file system** - Uses local directories for cache
5. **No monitoring** - Basic console logs only

## Why This Architecture Works for Development

✅ **Advantages:**
- Simple to understand and debug
- Visible browser shows what's happening
- Direct database access (no queue complexity)
- Fast iteration during development

❌ **Not Production-Ready Because:**
- Requires physical/virtual display
- Single worker = low throughput
- No horizontal scaling
- No monitoring/alerting
- No retry logic
- Tight coupling to local environment

## Summary

RDPRM 2 is a **well-designed local development tool** that demonstrates the complete workflow from company selection to PDF extraction. However, it was never intended for production server deployment.

Key strengths:
- Clean separation of concerns (worker, scraper, database)
- Robust PDF download with 4 fallback strategies
- Automatic job creation via database trigger
- Complete audit trail in database

Key limitations:
- Hardcoded to local execution (headless: false)
- No production infrastructure (monitoring, scaling, retry)
- Not designed for headless server environment

To adapt for production, you must:
1. Change to `headless: true`
2. Replace `networkidle` with `domcontentloaded + explicit waits`
3. **Keep `slowMo: 500`** (critical for website compatibility)
4. Add proper job locking for multi-worker deployment
5. Add monitoring and alerting
6. Implement retry logic

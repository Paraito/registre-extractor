# RDPRM 2 Database Schema - Complete Reference

## Overview

The RDPRM 2 database uses **Supabase (PostgreSQL)** with 8 tables and 2 critical triggers for automation.

**Database:** Supabase project at `https://qyaoevwctxxyrchudquh.supabase.co`

**Key Feature:** Database trigger automatically creates pending RDPRM searches when names are selected.

## Entity Relationship Diagram

```
┌──────────────────────┐
│  search_sessions     │ (Parent entity)
│  ├─ id (PK)          │
│  ├─ status           │
│  ├─ initial_query    │
│  └─ completed_at     │
└──────────┬───────────┘
           │
           ├─────────────────────────────────────┐
           │                                     │
           │ 1:N                                 │ 1:N
┌──────────▼──────────┐              ┌──────────▼──────────────┐
│  req_companies      │              │  selected_names_for_rdprm│
│  ├─ id (PK)         │              │  ├─ id (PK)              │
│  ├─ session_id (FK) │              │  ├─ session_id (FK)      │
│  ├─ company_name    │              │  ├─ name_to_search       │
│  ├─ neq             │              │  └─ is_selected          │
│  ├─ raw_data        │              └──────────┬───────────────┘
│  └─ cleaned_data    │                         │
└──────────┬──────────┘                         │ [TRIGGER]
           │                                     │ on_selected_name_insert
           │ 1:N (each has multiple)            │
           ├───────┐                   ┌────────▼──────────────┐
           │       │                   │  rdprm_searches        │
┌──────────▼─┐  ┌─▼───────────┐      │  ├─ id (PK)            │
│req_fusions │  │req_name_index│      │  ├─ session_id (FK)    │
│            │  │              │      │  ├─ selected_name_id   │
└────────────┘  └──────────────┘      │  ├─ search_name        │
                                      │  ├─ status             │
┌──────────────┐  ┌──────────────┐   │  └─ storage_path       │
│req_admin...  │  │req_associates│   └────────────────────────┘
└──────────────┘  └──────────────┘
```

## Table Schemas

### 1. search_sessions (Parent Entity)

**Purpose:** Top-level tracking for each user workflow

```sql
CREATE TABLE search_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initial_search_query TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_company_selection',
    selected_req_company_id UUID,
    final_pdf_path TEXT,
    error_message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    req_completed BOOLEAN NOT NULL DEFAULT FALSE,
    req_results_count INTEGER
);
```

**Columns Explained:**

| Column | Type | Purpose | Example |
|--------|------|---------|---------|
| `id` | UUID | Primary key | `381db674-df0d-46ca-8c4e-b76faef5d903` |
| `initial_search_query` | TEXT | Original user search | `"AUTOMATISATIONS PARAITO"` |
| `status` | TEXT | Workflow state | `pending_company_selection`, `pending_rdprm_searches`, `completed`, `failed` |
| `selected_req_company_id` | UUID | FK to req_companies (after selection) | `abc-123` |
| `final_pdf_path` | TEXT | Combined PDF path (if created) | `session-id/combined.pdf` |
| `error_message` | TEXT | Error text if failed | `"Company not found"` |
| `error_details` | JSONB | Additional error data | `{"code": 404, "details": "..."}` |
| `created_at` | TIMESTAMPTZ | Session creation time | `2025-01-25 10:00:00+00` |
| `updated_at` | TIMESTAMPTZ | Last update time | `2025-01-25 10:05:00+00` |
| `completed_at` | TIMESTAMPTZ | Completion time (null if pending) | `2025-01-25 10:05:00+00` |
| `req_completed` | BOOLEAN | REQ scraping finished? | `true`/`false` |
| `req_results_count` | INTEGER | Number of REQ results found | `5` |

**Status Flow:**
```
pending_company_selection  (initial)
  ↓ (user selects company from REQ results)
pending_rdprm_searches
  ↓ (all RDPRM searches complete)
completed
```

### 2. req_companies (REQ Search Results)

**Purpose:** Companies found in REQ searches

```sql
CREATE TABLE req_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    neq TEXT,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    result_order INTEGER,
    raw_data JSONB,
    cleaned_data JSONB,
    screenshot_path TEXT,
    names_created BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**JSONB Columns:**

**`raw_data` structure:**
```json
{
  "screenshot_url": "https://...",
  "html_content": "<html>...</html>",
  "page_url": "https://registre...",
  "captured_at": "2025-01-25T10:00:00Z",
  "result_number": 1
}
```

**`cleaned_data` structure:**
```json
{
  "etat_des_informations": {
    "immatriculation": "NEQ: 1234567890",
    "forme_juridique": "Société par actions",
    "statut": "Actif"
  },
  "etablissements": [...],
  "index_documents": [...],
  "index_noms": [...]
}
```

**Key Flags:**
- `is_selected`: User picked this company for RDPRM searches
- `names_created`: Names extracted and added to `selected_names_for_rdprm`

### 3. req_fusions (Company Mergers)

**Purpose:** Merger/fusion records extracted from REQ

```sql
CREATE TABLE req_fusions (
    id UUID PRIMARY KEY,
    req_company_id UUID NOT NULL REFERENCES req_companies(id) ON DELETE CASCADE,
    type_fusion TEXT,
    loi_applicable TEXT,
    date_fusion DATE,
    nom_personne_morale TEXT,
    domicile TEXT,
    neq_composante TEXT,
    neq_resultante TEXT,
    fusion_order INTEGER,
    created_at TIMESTAMPTZ
);
```

**Example Row:**
```sql
{
  type_fusion: "Fusion verticale",
  loi_applicable: "Code civil du Québec",
  date_fusion: "2023-05-15",
  nom_personne_morale: "SOCIÉTÉ ABC INC.",
  neq_composante: "1234567890",
  neq_resultante: "9876543210"
}
```

### 4. req_administrators (Company Directors)

**Purpose:** Company administrators/directors from REQ

```sql
CREATE TABLE req_administrators (
    id UUID PRIMARY KEY,
    req_company_id UUID NOT NULL REFERENCES req_companies(id) ON DELETE CASCADE,
    nom_famille TEXT,
    prenom TEXT,
    nom_complet TEXT,
    date_debut_charge DATE,
    fonctions TEXT[],
    adresse_domicile TEXT,
    admin_order INTEGER,
    created_at TIMESTAMPTZ
);
```

**Example Row:**
```sql
{
  nom_famille: "SMITH",
  prenom: "JOHN",
  nom_complet: "JOHN SMITH",
  date_debut_charge: "2020-01-15",
  fonctions: ["Président", "Administrateur"],
  adresse_domicile: "123 Main St, Montreal, QC"
}
```

**`fonctions` array:** Can have multiple roles (President, Secretary, etc.)

### 5. req_associates (Partners/Associates)

**Purpose:** Company partners/associates from REQ

```sql
CREATE TABLE req_associates (
    id UUID PRIMARY KEY,
    req_company_id UUID NOT NULL REFERENCES req_companies(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    type_associe TEXT,
    adresse_domicile TEXT,
    associate_order INTEGER,
    created_at TIMESTAMPTZ
);
```

**Example Row:**
```sql
{
  nom: "PIERRE TREMBLAY",
  type_associe: "Commanditaire",
  adresse_domicile: "456 Oak Ave, Quebec, QC"
}
```

### 6. req_name_index (Historical Names)

**Purpose:** Current and historical company names from REQ

```sql
CREATE TABLE req_name_index (
    id UUID PRIMARY KEY,
    req_company_id UUID NOT NULL REFERENCES req_companies(id) ON DELETE CASCADE,
    name_type TEXT NOT NULL,
    nom TEXT NOT NULL,
    versions_autre_langue TEXT,
    date_declaration DATE,
    date_retrait DATE,
    situation TEXT,
    name_order INTEGER,
    created_at TIMESTAMPTZ
);
```

**Columns:**

| Column | Purpose | Example |
|--------|---------|---------|
| `name_type` | Type of name | `"nom_declare"`, `"autre_nom"`, `"nom_anterieur"` |
| `nom` | Company name | `"AUTOMATISATIONS PARAITO INC."` |
| `versions_autre_langue` | Other language version | `"PARAITO AUTOMATIONS INC."` |
| `date_declaration` | Date name declared | `2020-01-15` |
| `date_retrait` | Date name retired | `null` (if current) or `2023-05-20` |
| `situation` | Status | `"En vigueur"` (current) or `"Antérieur"` (historical) |

**Example Rows:**
```sql
-- Current name
{
  name_type: "nom_declare",
  nom: "AUTOMATISATIONS PARAITO INC.",
  situation: "En vigueur",
  date_declaration: "2020-01-15",
  date_retrait: null
}

-- Historical name
{
  name_type: "nom_anterieur",
  nom: "PARAITO TECHNOLOGIES INC.",
  situation: "Antérieur",
  date_declaration: "2015-03-10",
  date_retrait: "2020-01-15"
}
```

### 7. selected_names_for_rdprm (CRITICAL - Triggers RDPRM)

**Purpose:** Names selected for RDPRM searches (auto-creates rdprm_searches)

```sql
CREATE TABLE selected_names_for_rdprm (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
    name_to_search TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id UUID,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    presentation_order INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Columns:**

| Column | Purpose | Example |
|--------|---------|---------|
| `name_to_search` | Company name for RDPRM | `"AUTOMATISATIONS PARAITO INC."` |
| `source_type` | Where name came from | `"req_name"`, `"req_fusion"`, `"manual"` |
| `source_id` | FK to source table | UUID of req_name_index row |
| `is_selected` | User explicitly selected? | `true`/`false` |
| `presentation_order` | Display order in UI | `1`, `2`, `3`, ... |

**CRITICAL BEHAVIOR:** When a row is inserted, the `on_selected_name_insert` trigger automatically creates a pending `rdprm_searches` record.

### 8. rdprm_searches (RDPRM Job Queue)

**Purpose:** Individual RDPRM search executions (processed by worker)

```sql
CREATE TABLE rdprm_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_session_id UUID NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
    selected_name_id UUID REFERENCES selected_names_for_rdprm(id) ON DELETE SET NULL,
    search_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    storage_path TEXT,
    error_message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

**Status Values:**

| Status | Meaning | Set By |
|--------|---------|--------|
| `pending` | Waiting to be processed | Trigger (on insert) |
| `in_progress` | Worker currently processing | Worker (on claim) |
| `completed` | Successfully downloaded PDF | Worker (on success) |
| `failed` | Error during processing | Worker (on error) |
| `not_found` | Company not in RDPRM | Worker (CompanyNotFoundError) |

**Lifecycle:**
```
pending
  ↓ (worker claims)
in_progress
  ↓ (scraping)
  ├─> completed (storage_path set)
  ├─> failed (error_message set)
  └─> not_found (error_message set)
```

**Example Completed Row:**
```sql
{
  id: "06bd905a-e8b6-47cb-9b75-7a991be0734e",
  search_session_id: "381db674-df0d-46ca-8c4e-b76faef5d903",
  selected_name_id: "697ea44f-dbf8-4a3a-9e3b-9e501f9f75ce",
  search_name: "AUTOMATISATIONS PARAITO INC.",
  status: "completed",
  storage_path: "381db674-df0d-46ca-8c4e-b76faef5d903/automatisations_paraito_inc.pdf",
  error_message: null,
  created_at: "2025-01-25T10:00:01Z",
  updated_at: "2025-01-25T10:05:00Z",
  completed_at: "2025-01-25T10:05:00Z"
}
```

## Triggers

### Trigger 1: Update updated_at on Modification

```sql
-- Function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers on both tables
CREATE TRIGGER update_search_sessions_updated_at
  BEFORE UPDATE ON search_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rdprm_searches_updated_at
  BEFORE UPDATE ON rdprm_searches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Purpose:** Automatically sets `updated_at = NOW()` on every UPDATE.

**Applies to:**
- `search_sessions`
- `rdprm_searches`

### Trigger 2: Auto-Create RDPRM Search (CRITICAL)

```sql
-- Function
CREATE OR REPLACE FUNCTION public.trigger_rdprm_search_on_name_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.rdprm_searches (
    search_session_id,
    selected_name_id,
    search_name,
    status
  ) VALUES (
    NEW.search_session_id,
    NEW.id,
    NEW.name_to_search,
    'pending'
  );
  RETURN NEW;
END;
$function$;

-- Trigger
CREATE TRIGGER on_selected_name_insert
  AFTER INSERT ON public.selected_names_for_rdprm
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_rdprm_search_on_name_insert();
```

**Purpose:** **AUTOMATIC JOB CREATION**

**Behavior:**
1. User/system inserts row into `selected_names_for_rdprm`
2. Trigger fires **AFTER INSERT**
3. New row created in `rdprm_searches` with `status='pending'`
4. Worker finds and processes the pending search

**Example Flow:**
```sql
-- Step 1: Insert name
INSERT INTO selected_names_for_rdprm (
  search_session_id,
  name_to_search,
  source_type,
  is_selected
) VALUES (
  '381db674-df0d-46ca-8c4e-b76faef5d903',
  'AUTOMATISATIONS PARAITO INC.',
  'req_name',
  true
);

-- Step 2: Trigger automatically creates:
-- INSERT INTO rdprm_searches (
--   search_session_id: '381db674-df0d-46ca-8c4e-b76faef5d903',
--   selected_name_id: <new UUID from step 1>,
--   search_name: 'AUTOMATISATIONS PARAITO INC.',
--   status: 'pending'
-- )

-- Step 3: Worker finds pending search and processes it
```

**This is the automation backbone.** No manual job queuing needed.

## Relationships & Cascade Behavior

### Parent → Child Relationships

```
search_sessions (1)
  ├── req_companies (many) [ON DELETE CASCADE]
  │    ├── req_fusions (many) [ON DELETE CASCADE]
  │    ├── req_administrators (many) [ON DELETE CASCADE]
  │    ├── req_associates (many) [ON DELETE CASCADE]
  │    └── req_name_index (many) [ON DELETE CASCADE]
  │
  ├── selected_names_for_rdprm (many) [ON DELETE CASCADE]
  │    └── rdprm_searches (1 via trigger) [selected_name_id ON DELETE SET NULL]
  │
  └── rdprm_searches (many) [ON DELETE CASCADE]
```

**CASCADE DELETE:**
- Deleting a `search_sessions` row deletes **ALL** related data
- Prevents orphaned records
- Useful for cleanup/testing

**SET NULL:**
- If `selected_names_for_rdprm` row deleted, `rdprm_searches.selected_name_id` set to `null`
- Preserves search record for audit trail

## Indexes (Recommended for Performance)

**Not shown in migrations, but should exist:**

```sql
-- Fast polling queries
CREATE INDEX idx_rdprm_searches_status
  ON rdprm_searches(status, created_at);

-- Session lookups
CREATE INDEX idx_rdprm_searches_session
  ON rdprm_searches(search_session_id);

-- REQ company lookups
CREATE INDEX idx_req_companies_session
  ON req_companies(search_session_id);

-- Selected names lookups
CREATE INDEX idx_selected_names_session
  ON selected_names_for_rdprm(search_session_id);
```

## Query Patterns

### Worker: Poll for Pending Searches

```sql
SELECT *
FROM rdprm_searches
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1;
```

**Index Used:** `idx_rdprm_searches_status`

### Worker: Check Session Completion

```sql
-- Step 1: Get all searches for session
SELECT status
FROM rdprm_searches
WHERE search_session_id = '381db674-...'

-- Step 2: If all are terminal (completed/failed/not_found):
UPDATE search_sessions
SET status = 'completed', completed_at = NOW()
WHERE id = '381db674-...';
```

### User: Get All RDPRM Results for Session

```sql
SELECT
  rs.search_name,
  rs.status,
  rs.storage_path,
  rs.error_message,
  rs.completed_at
FROM rdprm_searches rs
WHERE rs.search_session_id = '381db674-...'
ORDER BY rs.created_at ASC;
```

## Storage Bucket

**Bucket Name:** `rdprm-documents`

**Access:** Private (requires authentication)

**Structure:**
```
rdprm-documents/
├── session-id-1/
│   ├── company_name_1.pdf
│   ├── company_name_2.pdf
│   └── company_name_3.pdf
└── session-id-2/
    └── company_name_4.pdf
```

**Path Format:** `{search_session_id}/{sanitized_company_name}.pdf`

**Cleanup:** Manually delete by session ID or set bucket lifecycle rules.

## Summary

**Key Tables:**
1. `search_sessions` - Top-level workflow tracking
2. `req_companies` - REQ search results
3. `selected_names_for_rdprm` - **Triggers RDPRM searches**
4. `rdprm_searches` - **Worker processes these**

**Key Triggers:**
1. `update_updated_at_column()` - Auto-update timestamps
2. `trigger_rdprm_search_on_name_insert()` - **Auto-create pending jobs**

**Job Flow:**
```
User selects name
  → INSERT into selected_names_for_rdprm
  → TRIGGER creates rdprm_searches (pending)
  → Worker polls and finds pending
  → Worker processes (in_progress → completed/failed/not_found)
  → Worker checks if session complete
```

**This architecture enables fully automated RDPRM searches via database trigger.**

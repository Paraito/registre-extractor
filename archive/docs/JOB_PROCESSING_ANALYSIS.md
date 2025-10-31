# 📋 Job Processing Mechanism Analysis
**System:** registre-extractor  
**Date:** October 31, 2025

---

## 🎯 EXECUTIVE SUMMARY

This document provides a comprehensive analysis of how jobs are picked up, assigned, and processed across all environments and job types in the registre-extractor system.

### Key Findings

1. **Two Worker Implementations Exist:**
   - `src/worker/unified-worker.ts` - Handles ALL job types (extraction, REQ, RDPRM)
   - `src/worker/index.ts` - Handles ONLY extraction jobs (legacy)

2. **Multi-Environment Polling:**
   - Workers poll ALL configured environments (prod, staging, dev)
   - Jobs are processed in environment order: prod → staging → dev

3. **Job Priority System:**
   - Priority 1: Land Registry Extraction (`extraction_queue`)
   - Priority 2: REQ Scraping (`search_sessions`)
   - Priority 3: RDPRM Scraping (`rdprm_searches`)

4. **Optimistic Locking:**
   - Uses database-level atomic updates to prevent race conditions
   - Multiple workers can safely compete for the same job

---

## 1️⃣ HOW JOBS ARE PICKED UP FROM DATABASE

### Polling Mechanism

**Main Loop (Unified Worker):**

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async processContinuously(): Promise<void> {
  while (!this.shouldStop) {
    let currentJob: UnifiedWorkerJob | null = null;
    
    try {
      // Get next job from any source
      const job = await this.getNextJob();
      
      if (!job) {
        // No jobs available, wait 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      // Process the job
      await this.processJob(job);
      
    } catch (error) {
      // Error handling...
    }
  }
}
````
</augment_code_snippet>

**Polling Interval:** 5 seconds when no jobs are found

---

### Environment Polling Order

Workers poll environments in this order:

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async getNextJob(): Promise<UnifiedWorkerJob | null> {
  const environments = supabaseManager.getAvailableEnvironments();
  // Returns: ['prod', 'staging', 'dev']
  
  // Poll all environments for any job type
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    
    // Priority 1: Check for pending extraction jobs
    const extractionJob = await this.getNextExtractionJob(client, env);
    if (extractionJob) return extractionJob;
    
    // Priority 2: Check for pending REQ jobs
    const reqJob = await this.getNextREQJob(client, env);
    if (reqJob) return reqJob;
    
    // Priority 3: Check for pending RDPRM jobs
    const rdprmJob = await this.getNextRDPRMJob(client, env);
    if (rdprmJob) return rdprmJob;
  }
  
  return null; // No jobs found
}
````
</augment_code_snippet>

**Environment Order:** Determined by `supabaseManager.getAvailableEnvironments()`
- Returns environments in the order they're configured in `.env`
- Typically: `prod` → `staging` → `dev`

---

### Job Type Queries

#### 1. Extraction Jobs (Land Registry)

**Table:** `extraction_queue`  
**Status Field:** `status_id`  
**Pending Status:** `EXTRACTION_STATUS.EN_ATTENTE` (value: 1)

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async getNextExtractionJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
  const { data, error } = await client
    .from('extraction_queue')
    .select('*')
    .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)  // status_id = 1
    .order('created_at', { ascending: true })        // FIFO order
    .limit(1);                                       // Get oldest job
  
  if (!data || data.length === 0) return null;
  
  // Attempt to claim the job (see section 2)
  // ...
}
````
</augment_code_snippet>

**Query Logic:**
- Filter: `status_id = 1` (EN_ATTENTE / Waiting)
- Order: `created_at ASC` (oldest first - FIFO)
- Limit: 1 job at a time

---

#### 2. REQ Jobs (Company Scraping)

**Table:** `search_sessions`  
**Status Field:** `status`  
**Pending Status:** `'pending_company_selection'`  
**Additional Filter:** `req_completed = false`

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async getNextREQJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
  const { data, error} = await client
    .from('search_sessions')
    .select('*')
    .eq('status', 'pending_company_selection')
    .eq('req_completed', false)
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!data || data.length === 0) return null;
  
  // Attempt to claim the job (see section 2)
  // ...
}
````
</augment_code_snippet>

**Query Logic:**
- Filter: `status = 'pending_company_selection' AND req_completed = false`
- Order: `created_at ASC` (oldest first - FIFO)
- Limit: 1 job at a time

---

#### 3. RDPRM Jobs (Personal/Movable Rights)

**Table:** `rdprm_searches`  
**Status Field:** `status`  
**Pending Status:** `'pending'`

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async getNextRDPRMJob(client: any, env: EnvironmentName): Promise<UnifiedWorkerJob | null> {
  const { data, error } = await client
    .from('rdprm_searches')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!data || data.length === 0) return null;
  
  // Attempt to claim the job (see section 2)
  // ...
}
````
</augment_code_snippet>

**Query Logic:**
- Filter: `status = 'pending'`
- Order: `created_at ASC` (oldest first - FIFO)
- Limit: 1 job at a time

---

## 2️⃣ HOW JOBS ARE ASSIGNED TO WORKERS

### Optimistic Locking Strategy

The system uses **optimistic locking** with atomic database updates to prevent race conditions when multiple workers compete for the same job.

### Assignment Process

#### Step 1: Query for Available Job
Worker queries for the oldest pending job (as shown in section 1).

#### Step 2: Atomic Claim Operation

**For Extraction Jobs:**

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
// Claim the job atomically
const { data: claimedJob, error: claimError } = await client
  .from('extraction_queue')
  .update({
    status_id: EXTRACTION_STATUS.EN_TRAITEMENT,  // 2 = Processing
    worker_id: this.workerId,                     // Assign to this worker
    processing_started_at: new Date().toISOString(),
  })
  .eq('id', job.id)                               // Target specific job
  .eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)  // ONLY if still pending
  .select()
  .single();

if (claimError || !claimedJob) {
  // Another worker claimed it - race condition
  logger.debug('Failed to claim job (likely race condition)');
  return null;
}

// Successfully claimed!
return claimedJob;
````
</augment_code_snippet>

**Critical `.eq('status_id', EXTRACTION_STATUS.EN_ATTENTE)` clause:**
- This ensures the update ONLY succeeds if the job is still in "EN_ATTENTE" status
- If another worker already claimed it (changed status to EN_TRAITEMENT), this update returns null
- This is the **race condition prevention mechanism**

---

**For REQ Jobs:**

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
const { data: claimedSession, error: claimError } = await client
  .from('search_sessions')
  .update({
    status: 'scraping_company_data',
    updated_at: new Date().toISOString(),
  })
  .eq('id', session.id)
  .eq('status', 'pending_company_selection')  // ONLY if still pending
  .eq('req_completed', false)                 // AND not completed
  .select()
  .single();
````
</augment_code_snippet>

---

**For RDPRM Jobs:**

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
const { data: claimedSearch, error: claimError } = await client
  .from('rdprm_searches')
  .update({
    status: 'in_progress',
  })
  .eq('id', search.id)
  .eq('status', 'pending')  // ONLY if still pending
  .select()
  .single();
````
</augment_code_snippet>

---

### Worker ID Assignment

**Worker ID Format:**
- Unified Worker: `unified-worker-{uuid}` (e.g., `unified-worker-81ffcd09-ea4a-4e34-b5fa-a064a43e0834`)
- Legacy Worker: `worker-{instance}-{worker_num}` (e.g., `worker-1-2`)

**Assignment:**

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
constructor(workerId?: string, workerCount: number = 3) {
  this.workerId = workerId || `unified-worker-${uuidv4()}`;
  this.workerCount = workerCount;
  // ...
}
````
</augment_code_snippet>

---

### Race Condition Handling

**Scenario:** Two workers (A and B) query at the same time and find the same job.

1. **Worker A queries:** Finds job ID `abc123` with `status_id = 1`
2. **Worker B queries:** Finds same job ID `abc123` with `status_id = 1`
3. **Worker A claims:** Updates job `abc123` SET `status_id = 2` WHERE `id = 'abc123' AND status_id = 1` → **SUCCESS**
4. **Worker B claims:** Updates job `abc123` SET `status_id = 2` WHERE `id = 'abc123' AND status_id = 1` → **FAILS** (status is now 2, not 1)
5. **Worker B:** Receives `null` from update, logs "race condition", continues to next job
6. **Worker A:** Processes the job

**Result:** Only one worker successfully claims the job. No duplicate processing.

---

## 3️⃣ HOW WORKERS DETERMINE WHAT JOB TO DO

### Job Type Detection

Jobs are tagged with metadata during the claim process:

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
// Extraction job
return {
  ...claimedJob,
  _job_type: 'extraction',  // ← Job type tag
  _environment: env,         // ← Environment tag
};

// REQ job
return {
  ...claimedSession,
  _job_type: 'req',
  _environment: env,
};

// RDPRM job
return {
  ...claimedSearch,
  _job_type: 'rdprm',
  _environment: env,
  _session_id: search.search_session_id,
};
````
</augment_code_snippet>

---

### Job Routing Logic

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async processJob(job: UnifiedWorkerJob): Promise<void> {
  this.workerStatus.status = 'busy';
  this.workerStatus.current_job_id = job.id;
  
  try {
    if (job._job_type === 'extraction') {
      await this.processExtractionJob(job);
    } else if (job._job_type === 'req') {
      await this.processREQJob(job);
    } else if (job._job_type === 'rdprm') {
      await this.processRDPRMJob(job);
    }
    
    this.workerStatus.jobs_completed++;
  } catch (error) {
    this.workerStatus.jobs_failed++;
    throw error;
  }
}
````
</augment_code_snippet>

**Routing Decision:**
- Check `job._job_type` field
- Route to appropriate handler:
  - `'extraction'` → `processExtractionJob()` → Land registry extraction
  - `'req'` → `processREQJob()` → Company scraping
  - `'rdprm'` → `processRDPRMJob()` → Personal/movable rights scraping

---

### Job Processing Handlers

#### Extraction Job Processing

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async processExtractionJob(job: ExtractionQueueJob & { _environment: EnvironmentName }): Promise<void> {
  // Initialize extractor if needed
  if (!this.extractor) {
    await this.initializeExtractor();
  }
  
  const client = supabaseManager.getServiceClient(job._environment);
  
  try {
    // Convert job to extraction config
    const config = convertToExtractionConfig(job);
    
    // Navigate to search page
    await this.extractor.navigateToSearch(config.document_type);
    
    // Extract document
    const localFilePath = await this.extractor.extractDocument(config);
    
    // Upload to Supabase storage
    // Update status to COMPLETE
    // ...
    
  } catch (error) {
    // Update status to ERREUR
    // ...
  }
}
````
</augment_code_snippet>

**Document Type Routing (within extraction):**

<augment_code_snippet path="src/worker/extractor-ai.ts" mode="EXCERPT">
````typescript
async extractDocument(config: ExtractionConfig): Promise<string> {
  switch (config.document_type) {
    case 'actes':
      return await this.extractActes(config);
    case 'plans_cadastraux':
      return await this.extractPlansCadastraux(config);
    case 'index':
    default:
      return await this.extractIndex(config);
  }
}
````
</augment_code_snippet>

---

#### REQ Job Processing

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async processREQJob(job: SearchSession & { _environment: EnvironmentName }): Promise<void> {
  const client = supabaseManager.getServiceClient(job._environment);
  
  try {
    // Call REQ scraper
    await scrapeRegistreEntreprise(job);
    
    // Update status
    await client
      .from('search_sessions')
      .update({
        status: 'pending_name_selection',
        req_completed: true,
      })
      .eq('id', job.id);
      
  } catch (error) {
    // Update status to 'failed'
    // ...
  }
}
````
</augment_code_snippet>

---

#### RDPRM Job Processing

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async processRDPRMJob(job: RDPRMSearch & { _environment: EnvironmentName; _session_id: string }): Promise<void> {
  const client = supabaseManager.getServiceClient(job._environment);
  
  try {
    // Call RDPRM scraper
    await scrapeRDPRM(job);
    
    // Update status
    await client
      .from('rdprm_searches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
      
  } catch (error) {
    // Update status to 'failed'
    // ...
  }
}
````
</augment_code_snippet>

---

## 🔄 COMPLETE FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                        WORKER STARTS                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTINUOUS LOOP (every 5 seconds if no job)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Poll Environments (prod → staging → dev)              │  │
│  │    For each environment:                                  │  │
│  │    ┌──────────────────────────────────────────────────┐  │  │
│  │    │ Priority 1: Query extraction_queue               │  │  │
│  │    │   WHERE status_id = 1                            │  │  │
│  │    │   ORDER BY created_at ASC                        │  │  │
│  │    │   LIMIT 1                                        │  │  │
│  │    │   ↓                                              │  │  │
│  │    │   Found? → Try to claim (atomic update)         │  │  │
│  │    │   Success? → RETURN JOB                          │  │  │
│  │    │   Failed? → Continue to next priority           │  │  │
│  │    └──────────────────────────────────────────────────┘  │  │
│  │    ┌──────────────────────────────────────────────────┐  │  │
│  │    │ Priority 2: Query search_sessions                │  │  │
│  │    │   WHERE status = 'pending_company_selection'     │  │  │
│  │    │   AND req_completed = false                      │  │  │
│  │    │   ORDER BY created_at ASC                        │  │  │
│  │    │   LIMIT 1                                        │  │  │
│  │    │   ↓                                              │  │  │
│  │    │   Found? → Try to claim (atomic update)         │  │  │
│  │    │   Success? → RETURN JOB                          │  │  │
│  │    │   Failed? → Continue to next priority           │  │  │
│  │    └──────────────────────────────────────────────────┘  │  │
│  │    ┌──────────────────────────────────────────────────┐  │  │
│  │    │ Priority 3: Query rdprm_searches                 │  │  │
│  │    │   WHERE status = 'pending'                       │  │  │
│  │    │   ORDER BY created_at ASC                        │  │  │
│  │    │   LIMIT 1                                        │  │  │
│  │    │   ↓                                              │  │  │
│  │    │   Found? → Try to claim (atomic update)         │  │  │
│  │    │   Success? → RETURN JOB                          │  │  │
│  │    │   Failed? → Continue to next environment        │  │  │
│  │    └──────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │ 2. Job Found?                                             │  │
│  │    YES → Process job (see routing below)                 │  │
│  │    NO  → Wait 5 seconds, loop again                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  JOB ROUTING (based on _job_type)                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ if (_job_type === 'extraction')                          │  │
│  │   → processExtractionJob()                               │  │
│  │      → Initialize extractor                              │  │
│  │      → Navigate to search page                           │  │
│  │      → Extract document (actes/plans/index)              │  │
│  │      → Upload to Supabase storage                        │  │
│  │      → Update status to COMPLETE                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ else if (_job_type === 'req')                            │  │
│  │   → processREQJob()                                      │  │
│  │      → scrapeRegistreEntreprise()                        │  │
│  │      → Update status to 'pending_name_selection'         │  │
│  │      → Set req_completed = true                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ else if (_job_type === 'rdprm')                          │  │
│  │   → processRDPRMJob()                                    │  │
│  │      → scrapeRDPRM()                                     │  │
│  │      → Update status to 'completed'                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 STATUS TRANSITIONS

### Extraction Jobs (`extraction_queue`)

```
EN_ATTENTE (1)
    ↓ [Worker claims job]
EN_TRAITEMENT (2)
    ↓ [Extraction succeeds]
COMPLETE (3)
    ↓ [OCR worker picks up]
OCR_PROCESSING (6)
    ↓ [OCR succeeds]
EXTRACTION_COMPLETE (5)

OR

EN_TRAITEMENT (2)
    ↓ [Extraction fails]
ERREUR (4)
```

### REQ Jobs (`search_sessions`)

```
pending_company_selection
    ↓ [Worker claims job]
scraping_company_data
    ↓ [Scraping succeeds]
pending_name_selection (req_completed = true)

OR

scraping_company_data
    ↓ [Scraping fails]
failed
```

### RDPRM Jobs (`rdprm_searches`)

```
pending
    ↓ [Worker claims job]
in_progress
    ↓ [Scraping succeeds]
completed

OR

in_progress
    ↓ [Scraping fails]
failed
```

---

## 🔧 STUCK JOB RECOVERY

### Stale Job Monitor

Workers automatically reset stuck jobs on startup:

<augment_code_snippet path="src/worker/unified-worker.ts" mode="EXCERPT">
````typescript
private async resetStuckJobsOnStartup(environments: EnvironmentName[]): Promise<void> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  
  for (const env of environments) {
    const { data: stuckJobs } = await client
      .from('extraction_queue')
      .select('*')
      .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
      .lt('processing_started_at', twoMinutesAgo);
    
    if (stuckJobs && stuckJobs.length > 0) {
      await client
        .from('extraction_queue')
        .update({
          status_id: EXTRACTION_STATUS.EN_ATTENTE,
          worker_id: null,
          processing_started_at: null,
        })
        .eq('status_id', EXTRACTION_STATUS.EN_TRAITEMENT)
        .lt('processing_started_at', twoMinutesAgo);
    }
  }
}
````
</augment_code_snippet>

**Threshold:** Jobs stuck in "EN_TRAITEMENT" for >2 minutes are reset to "EN_ATTENTE"

---

## 📝 SUMMARY

| Aspect | Details |
|--------|---------|
| **Polling Interval** | 5 seconds when no jobs found |
| **Environment Order** | prod → staging → dev |
| **Job Priority** | 1. Extraction, 2. REQ, 3. RDPRM |
| **Locking Mechanism** | Optimistic locking with atomic updates |
| **Race Condition Prevention** | `.eq('status_id', PENDING_STATUS)` in UPDATE |
| **Job Ordering** | FIFO (oldest `created_at` first) |
| **Stuck Job Threshold** | 2 minutes on startup, 5 minutes during runtime |
| **Worker ID Format** | `unified-worker-{uuid}` or `worker-{instance}-{num}` |

---

**Generated:** October 31, 2025  
**Worker Implementations:**
- `src/worker/unified-worker.ts` (recommended - handles all job types)
- `src/worker/index.ts` (legacy - extraction only)


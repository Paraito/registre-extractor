# RDPRM Worker Implementation - Complete Details

## Overview

File: `/Users/marco/Documents/Dev/RDPRM 2/rdprm-worker.ts` (296 lines)

The RDPRM worker is a **background polling process** that:
1. Queries database for pending RDPRM searches
2. Executes browser automation for each search
3. Updates database with results
4. Manages session completion

## Complete Code Structure

### Imports and Configuration

```typescript
// Lines 1-18
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { scrapeFicheComplete, CompanyNotFoundError } from "./lib/rdprm.js";

// Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Worker Configuration (Lines 33-34)
const POLL_INTERVAL = parseInt(process.env.RDPRM_WORKER_POLL_INTERVAL || "10") * 1000;
const MAX_CONCURRENT = parseInt(process.env.RDPRM_WORKER_MAX_CONCURRENT || "1");

// State Management (Lines 35-37)
let isRunning = true;
let activeSearches = 0;
```

**Configuration Defaults:**
- `POLL_INTERVAL`: 10 seconds (10,000ms)
- `MAX_CONCURRENT`: 1 search at a time

**Environment Overrides:**
```bash
RDPRM_WORKER_POLL_INTERVAL=5  # Poll every 5 seconds
RDPRM_WORKER_MAX_CONCURRENT=3  # Process 3 searches simultaneously
```

### Type Definitions

```typescript
// Lines 20-31
interface PendingSearch {
  id: string;
  search_session_id: string;
  selected_name_id: string | null;
  search_name: string;
  status: string;
  storage_path: string | null;
  error_message: string | null;
  error_details: any;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
```

Maps directly to `rdprm_searches` table structure.

## Database Query Functions

### 1. Fetch Pending Searches

```typescript
// Lines 42-56
async function fetchPendingSearches(limit: number = MAX_CONCURRENT): Promise<PendingSearch[]> {
  const { data, error } = await supabase
    .from("rdprm_searches")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[WORKER] Error fetching pending searches:", error);
    return [];
  }

  return data || [];
}
```

**Query Breakdown:**
- **Table:** `rdprm_searches`
- **Filter:** `status = 'pending'`
- **Order:** Oldest first (FIFO - First In First Out)
- **Limit:** Respects `MAX_CONCURRENT` setting

**Return:** Array of pending searches (empty array on error)

**Example Result:**
```javascript
[
  {
    id: "06bd905a-e8b6-47cb-9b75-7a991be0734e",
    search_session_id: "381db674-df0d-46ca-8c4e-b76faef5d903",
    selected_name_id: "697ea44f-dbf8-4a3a-9e3b-9e501f9f75ce",
    search_name: "AUTOMATISATIONS PARAITO INC.",
    status: "pending",
    storage_path: null,
    error_message: null,
    created_at: "2025-01-25T10:00:01.123Z",
    updated_at: "2025-01-25T10:00:01.123Z",
    completed_at: null
  }
]
```

### 2. Update Search Status

```typescript
// Lines 58-87
async function updateSearchStatus(
  id: string,
  status: string,
  additionalFields: Record<string, any> = {}
): Promise<void> {
  const { error } = await supabase
    .from("rdprm_searches")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...additionalFields,
    })
    .eq("id", id);

  if (error) {
    console.error(`[WORKER] Error updating search ${id}:`, error);
    throw error;
  }
}
```

**Usage Examples:**

**Claim job (mark as in_progress):**
```typescript
await updateSearchStatus("search-id", "in_progress", {
  started_at: new Date().toISOString(),
});
```

**Mark as completed:**
```typescript
await updateSearchStatus("search-id", "completed", {
  storage_path: "session-id/company_name.pdf",
  completed_at: new Date().toISOString(),
});
```

**Mark as failed:**
```typescript
await updateSearchStatus("search-id", "failed", {
  error_message: "TimeoutError: page.goto timeout",
  completed_at: new Date().toISOString(),
});
```

**Mark as not_found:**
```typescript
await updateSearchStatus("search-id", "not_found", {
  error_message: "Company not found in RDPRM registry",
  completed_at: new Date().toISOString(),
});
```

### 3. Check and Update Session Status

```typescript
// Lines 89-132
async function checkAndUpdateSessionStatus(sessionId: string): Promise<void> {
  // Step 1: Fetch all searches for this session
  const { data: searches, error: fetchError } = await supabase
    .from("rdprm_searches")
    .select("status")
    .eq("search_session_id", sessionId);

  if (fetchError) {
    console.error(`[WORKER] Error fetching searches for session ${sessionId}:`, fetchError);
    return;
  }

  if (!searches || searches.length === 0) {
    console.log(`[WORKER] No searches found for session ${sessionId}`);
    return;
  }

  // Step 2: Check if all searches are in terminal state
  const allCompleted = searches.every(
    (search) =>
      search.status === "completed" ||
      search.status === "failed" ||
      search.status === "not_found"
  );

  // Step 3: If all done, mark session as completed
  if (allCompleted) {
    const { error: updateError } = await supabase
      .from("search_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (updateError) {
      console.error(`[WORKER] Error updating session ${sessionId}:`, updateError);
    } else {
      console.log(`[WORKER] ✓ Session ${sessionId} marked as completed`);
    }
  } else {
    console.log(`[WORKER] Session ${sessionId} still has pending searches`);
  }
}
```

**Terminal States:**
- `completed` - Successfully downloaded PDF
- `failed` - Error during processing
- `not_found` - Company not in RDPRM registry

**Logic:**
1. Fetch ALL searches for the session
2. Check if every single one has a terminal status
3. If yes: update `search_sessions.status = 'completed'`
4. If no: do nothing (session still in progress)

**Important:** This is called AFTER each search completes, ensuring sessions are marked complete as soon as possible.

## Job Processing

### Process Single Search

```typescript
// Lines 137-190
async function processSearch(search: PendingSearch): Promise<void> {
  const { id, search_name, search_session_id } = search;

  try {
    console.log(`[WORKER] Starting search ${id}: ${search_name}`);

    // Step 1: Mark as in_progress
    await updateSearchStatus(id, "in_progress", {
      started_at: new Date().toISOString(),
    });

    // Step 2: Execute scraping
    console.log(`[WORKER] Calling scraper for: ${search_name}`);
    const storagePath = await scrapeFicheComplete(search_name, search_session_id);

    // Step 3: Mark as completed
    await updateSearchStatus(id, "completed", {
      storage_path: storagePath,
      completed_at: new Date().toISOString(),
    });

    console.log(`[WORKER] ✓ Search ${id} completed successfully`);

    // Step 4: Check if session is now complete
    await checkAndUpdateSessionStatus(search_session_id);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific error type: CompanyNotFoundError
    if (error instanceof CompanyNotFoundError) {
      console.log(`[WORKER] ⚠ Company not found: ${search_name}`);
      await updateSearchStatus(id, "not_found", {
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });
    } else {
      // Generic error handling
      console.error(`[WORKER] ✗ Error processing search ${id}:`, error);
      await updateSearchStatus(id, "failed", {
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });
    }

    // Always check session status, even on failure
    await checkAndUpdateSessionStatus(search_session_id);
  }
}
```

**Flow Diagram:**
```
START processSearch(search)
  │
  ├─> Update status: in_progress (with started_at)
  │
  ├─> Call scrapeFicheComplete()
  │   │
  │   ├─> SUCCESS: Returns storage_path
  │   │   └─> Update status: completed (with storage_path, completed_at)
  │   │
  │   └─> ERROR: Throws exception
  │       │
  │       ├─> CompanyNotFoundError?
  │       │   └─> Update status: not_found (with error_message, completed_at)
  │       │
  │       └─> Other error?
  │           └─> Update status: failed (with error_message, completed_at)
  │
  └─> Check if all session searches are done
      └─> If yes: Mark search_sessions as completed
```

**Error Handling Strategy:**

1. **CompanyNotFoundError** - Specific exception from scraper
   - Status: `not_found`
   - Meaning: Company doesn't exist in RDPRM
   - Not considered a failure (legitimate outcome)

2. **All Other Errors** - Network, timeout, browser crashes, etc.
   - Status: `failed`
   - Meaning: Something went wrong during automation
   - May be retryable (manual intervention required)

3. **Always Update Session** - Even on error
   - Ensures parent session knows all children are done
   - Session can be marked complete even if some searches failed/not found

## Main Worker Loop

### Worker Loop Function

```typescript
// Lines 195-250
async function workerLoop(): Promise<void> {
  console.log("[WORKER] Starting RDPRM worker");
  console.log(`[WORKER] Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log(`[WORKER] Max concurrent: ${MAX_CONCURRENT}`);

  while (isRunning) {
    try {
      const now = Date.now();

      // Calculate available processing slots
      const availableSlots = MAX_CONCURRENT - activeSearches;

      if (availableSlots > 0) {
        // Fetch pending searches (up to available slots)
        const pendingSearches = await fetchPendingSearches(availableSlots);

        if (pendingSearches.length > 0) {
          console.log(`[WORKER] Found ${pendingSearches.length} pending RDPRM search(es)`);

          // Process each search
          const promises = pendingSearches.map(async (search) => {
            activeSearches++;
            try {
              await processSearch(search);
            } finally {
              activeSearches--;
            }
          });

          // Wait for completion if only 1 concurrent
          if (MAX_CONCURRENT === 1) {
            await Promise.all(promises);
          }
          // Otherwise, let them run in background
        } else {
          // No pending searches - log once per minute only
          if (!workerLoop.lastLogTime || now - workerLoop.lastLogTime > 60000) {
            console.log(`[WORKER] No pending searches. Waiting...`);
            workerLoop.lastLogTime = now;
          }
        }
      }

      // Sleep before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

    } catch (error) {
      console.error("[WORKER] Error in worker loop:", error);
      // Sleep and continue (don't crash the worker)
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  console.log("[WORKER] Worker stopped");
}

// Static property for last log time tracking
workerLoop.lastLogTime = 0;
```

**Concurrency Behavior:**

**When `MAX_CONCURRENT = 1` (default):**
```
Poll → Fetch 1 search → Process (wait) → Complete → Poll again
```
Searches processed sequentially, one at a time.

**When `MAX_CONCURRENT = 3`:**
```
Poll → Fetch 3 searches → Process all 3 in parallel (don't wait) → Poll again
```
Up to 3 searches can run simultaneously.

**Important:** With `MAX_CONCURRENT > 1`, there's no database-level locking, so multiple worker instances would have race conditions.

**Log Throttling:**

```typescript
if (!workerLoop.lastLogTime || now - workerLoop.lastLogTime > 60000) {
  console.log(`[WORKER] No pending searches. Waiting...`);
  workerLoop.lastLogTime = now;
}
```

Only logs "No pending searches" once per minute to avoid log spam.

### Shutdown Handlers

```typescript
// Lines 253-271
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log(`\n[WORKER] Received ${signal}, shutting down gracefully...`);
    isRunning = false;

    // Wait for active searches to complete (max 30 seconds)
    const maxWait = 30000;
    const start = Date.now();

    while (activeSearches > 0 && Date.now() - start < maxWait) {
      console.log(`[WORKER] Waiting for ${activeSearches} active search(es) to complete...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (activeSearches > 0) {
      console.log(`[WORKER] Force shutdown: ${activeSearches} search(es) still active`);
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
```

**Graceful Shutdown Logic:**

1. **Signal received** (Ctrl+C or `kill` command)
2. **Set `isRunning = false`** (stops polling loop)
3. **Wait up to 30 seconds** for active searches to finish
4. **Force exit** if searches still running after 30s

**Prevents:**
- Orphaned browser processes
- Incomplete database updates
- Corrupted search states

### Main Entry Point

```typescript
// Lines 286-295
async function main() {
  setupShutdownHandlers();
  await workerLoop();
}

main().catch((error) => {
  console.error("[WORKER] Fatal error:", error);
  process.exit(1);
});
```

**Startup Sequence:**
1. Register SIGINT/SIGTERM handlers
2. Enter infinite polling loop
3. If fatal error: log and exit with code 1

## Worker Behavior Examples

### Example 1: Single Search Processing

```
T+0:00 - Worker starts
T+0:00 - Poll database → 1 pending search found
T+0:00 - Mark search as in_progress
T+0:01 - Launch browser
T+5:00 - Scraping complete, PDF uploaded
T+5:00 - Mark search as completed
T+5:00 - Check session status → all done, mark session complete
T+5:01 - Sleep 10 seconds
T+5:11 - Poll database → no pending searches
T+5:11 - Sleep 10 seconds
...continues polling every 10s
```

### Example 2: Multiple Searches in Session

```
Session has 3 names selected:
  - Name A (search-1)
  - Name B (search-2)
  - Name C (search-3)

T+0:00 - Worker polls → finds search-1
T+0:00 - Process search-1 (5 minutes)
T+5:00 - Complete search-1
T+5:00 - Check session → NOT all done (2 and 3 still pending)
T+5:10 - Worker polls → finds search-2
T+5:10 - Process search-2 (5 minutes)
T+10:10 - Complete search-2
T+10:10 - Check session → NOT all done (3 still pending)
T+10:20 - Worker polls → finds search-3
T+10:20 - Process search-3 (5 minutes)
T+15:20 - Complete search-3
T+15:20 - Check session → ALL DONE! Mark session as completed
```

### Example 3: Company Not Found

```
T+0:00 - Worker polls → 1 pending search
T+0:00 - Mark search as in_progress
T+0:01 - Launch browser, login, search
T+2:00 - Scraper scrolls for "Imprimer" link (3-minute timeout)
T+5:00 - Link not found → throws CompanyNotFoundError
T+5:00 - Catch error → mark search as not_found
T+5:00 - Check session → mark complete
```

### Example 4: Timeout Error

```
T+0:00 - Worker polls → 1 pending search
T+0:00 - Mark search as in_progress
T+0:01 - Launch browser
T+1:00 - page.goto() times out after 60 seconds
T+1:00 - Catch error → mark search as failed
T+1:00 - Error message: "TimeoutError: page.goto: Timeout 60000ms exceeded"
T+1:00 - Check session → mark complete
```

## State Transitions

```
Pending Search Lifecycle:
  pending
    ↓
  in_progress
    ↓
  ├─> completed (PDF successfully uploaded)
  ├─> failed (error during automation)
  └─> not_found (company doesn't exist in RDPRM)

Session Lifecycle:
  pending_rdprm_searches
    ↓ (when all searches reach terminal state)
  completed
```

## Concurrency & Race Conditions

### Current Limitations (MAX_CONCURRENT=1)

✅ **Safe:**
- Single worker instance
- Processes one search at a time
- No race conditions

❌ **Not Safe:**
- Multiple worker instances
- No database-level job claiming
- Possible duplicate processing

### What Would Be Needed for Multiple Workers

To safely run multiple worker instances:

1. **Optimistic Locking:**
```typescript
const { data: claimedSearch } = await supabase
  .from("rdprm_searches")
  .update({ status: "in_progress", worker_id: WORKER_ID })
  .eq("id", search.id)
  .eq("status", "pending")  // Only update if still pending
  .select()
  .single();

if (!claimedSearch) {
  // Another worker claimed it, skip
  return;
}
```

2. **Heartbeat/Timeout:**
- Worker updates `last_heartbeat` timestamp
- Stale jobs (no heartbeat for 5 minutes) can be reclaimed

3. **Distributed Locking:**
- Use Redis or database advisory locks
- Ensures only one worker processes each job

## Performance Characteristics

**Throughput (MAX_CONCURRENT=1):**
- ~5 minutes per search (typical)
- ~12 searches per hour
- ~288 searches per 24 hours

**Throughput (MAX_CONCURRENT=3, hypothetical):**
- 3× throughput
- ~36 searches per hour
- Requires proper locking

**Bottlenecks:**
1. Government server PDF generation (2 minutes)
2. Authentication process (30 seconds)
3. Scrolling to find print link (45 seconds)

## Summary

The RDPRM worker is a **simple, reliable polling-based processor** that:

✅ **Strengths:**
- Easy to understand and debug
- Reliable error handling
- Graceful shutdown
- Automatic session completion tracking

❌ **Limitations:**
- Single worker only (by design)
- No job claiming mechanism
- No automatic retry
- No monitoring/metrics

**Perfect for:** Local development, small-scale automation
**Not suitable for:** Production scale, distributed deployment, high throughput

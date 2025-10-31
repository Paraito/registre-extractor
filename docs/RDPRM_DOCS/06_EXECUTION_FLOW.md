# RDPRM 2 Complete Execution Flow with Timestamps

## Overview

This document traces a complete RDPRM search from job creation to completion, with realistic timestamps and durations.

## Complete Flow: Real Example

### Phase 1: Job Creation (User/API Triggered)

**T+0:00 (10:00:00)** - Create search session
```typescript
const { data: sessionData } = await supabase
  .from("search_sessions")
  .insert({
    initial_search_query: "AUTOMATISATIONS PARAITO INC.",
    status: "pending_rdprm_searches",
  })
  .select()
  .single();
```
**Database State:**
```sql
search_sessions:
  id: abc-123
  initial_search_query: "AUTOMATISATIONS PARAITO INC."
  status: pending_rdprm_searches
  created_at: 2025-01-25 10:00:00
```

### Phase 2: Name Selection (T+0:01)

**T+0:01 (10:00:01)** - Insert name for RDPRM search
```typescript
const { data: nameData } = await supabase
  .from("selected_names_for_rdprm")
  .insert({
    search_session_id: "abc-123",
    name_to_search: "AUTOMATISATIONS PARAITO INC.",
    source_type: "manual",
    is_selected: true,
  })
  .select()
  .single();
```

**T+0:01.100 (10:00:01.100)** - **DATABASE TRIGGER FIRES**

The `trigger_rdprm_search_on_name_insert()` trigger automatically executes:
```sql
INSERT INTO rdprm_searches (
  search_session_id,
  selected_name_id,
  search_name,
  status
) VALUES (
  'abc-123',
  'name-456',
  'AUTOMATISATIONS PARAITO INC.',
  'pending'
);
```

**Database State:**
```sql
rdprm_searches:
  id: search-789
  search_session_id: abc-123
  selected_name_id: name-456
  search_name: "AUTOMATISATIONS PARAITO INC."
  status: pending
  created_at: 2025-01-25 10:00:01
```

### Phase 3: Worker Polling Loop

**T+0:10 (10:00:10)** - Worker polls database (10-second default interval)

```typescript
// rdprm-worker.ts workerLoop()
const pendingSearches = await fetchPendingSearches(1); // MAX_CONCURRENT=1

// Executes:
// SELECT * FROM rdprm_searches
// WHERE status = 'pending'
// ORDER BY created_at ASC
// LIMIT 1
```

**Found:** `search-789` (status: pending)

**T+0:10.050 (10:00:10.050)** - Worker claims job

```typescript
await updateSearchStatus("search-789", "in_progress", {
  started_at: new Date().toISOString(),
});
```

**Database State:**
```sql
rdprm_searches:
  id: search-789
  status: in_progress  ← Changed
  started_at: 2025-01-25 10:00:10  ← Added
```

**Worker Log:**
```
[WORKER] Found 1 pending RDPRM search(es)
[WORKER] Processing search search-789: AUTOMATISATIONS PARAITO INC.
```

### Phase 4: Browser Launch (T+0:10.5)

**T+0:10.500 (10:00:10.500)** - Launch Playwright browser

```typescript
// lib/rdprm.ts:526-531
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: false,
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
  slowMo: 500,  // 500ms delay between actions
});
const page = await context.newPage();
```

**Duration:** ~500ms (Chromium startup)

**Worker Log:**
```
[RDPRM] Launching browser for: AUTOMATISATIONS PARAITO INC.
[RDPRM] Session directory: /data/rdprm/.pw-session
```

### Phase 5: Navigation & Login (T+0:11 - T+0:45)

**T+0:11.000 (10:00:11)** - Navigate to RDPRM homepage

```typescript
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "networkidle",
});
```

**Duration:** ~8 seconds (page load + network idle)

**T+0:19.000 (10:00:19)** - Homepage loaded

**Worker Log:**
```
[RDPRM] Navigating to homepage...
[RDPRM] Homepage loaded (screenshot: 01_homepage.png)
```

**T+0:19.500 (10:00:19.500)** - Handle cookie banner

```typescript
const cookieBtn = page.getByText("Fermer", { exact: true });
if (await cookieBtn.isVisible()) {
  await cookieBtn.click();
}
```

**Duration:** ~500ms

**T+0:20.000 (10:00:20)** - Check for existing session

```typescript
await page.goto("https://servicesclients.rdprm.gouv.qc.ca/MesServices/", {
  waitUntil: "domcontentloaded",
});
// Not logged in, so continue with login
```

**Duration:** ~2 seconds

**T+0:22.000 (10:00:22)** - Fill credentials

```typescript
await page.waitForTimeout(3000);  // Explicit 3-second wait
const usernameField = page.locator('input[type="text"]').first();
await usernameField.fill("DVA3");
const passwordField = page.locator('input[type="password"]').first();
await passwordField.fill("Rdprm123!!!");
```

**Duration:** 3s wait + ~2s typing (with slowMo) = 5 seconds total

**Worker Log:**
```
[RDPRM] Proceeding to login form...
[RDPRM] Entering credentials...
```

**T+0:27.000 (10:00:27)** - Click login button

```typescript
await page.getByRole("button", { name: /Entrer/i }).click();
```

**Duration:** ~500ms (slowMo)

**T+0:27.500 (10:00:27.500)** - Wait for authentication

```typescript
await page.waitForLoadState("networkidle", { timeout: 60000 });
```

**Duration:** ~15 seconds (authentication processing + page load)

**T+0:42.500 (10:00:42.500)** - Login complete

**Worker Log:**
```
[RDPRM] Clicking "Entrer" button...
[RDPRM] Waiting for page after login...
[RDPRM] Login complete (screenshot: 05_after_login.png)
```

**T+0:42.500 (10:00:42.500)** - Check for security question

```typescript
const pageContent = await page.content();
if (pageContent.includes("Confirmer votre identité")) {
  // Security question detected
  const answerField = page.locator('input[type="text"]').first();
  await answerField.waitFor({ state: "visible", timeout: 5000 });
  await answerField.fill("RDPRM");
  await page.getByRole("button", { name: /Poursuivre/i }).click();
  await page.waitForLoadState("networkidle");
}
```

**Duration:** IF PRESENT: ~10 seconds total

**Assuming NO security question this time:**

**Worker Log:**
```
[RDPRM] Checking for security question...
[RDPRM] No security question detected, continuing...
```

**T+0:43.000 (10:00:43)** - Login phase complete

### Phase 6: Navigate to Consultation (T+0:43 - T+0:55)

**T+0:43.000 (10:00:43)** - Go to consultation page

```typescript
await page.waitForLoadState("networkidle");
await page.locator('a[href="/Consultation/"]').click();
await page.waitForLoadState("domcontentloaded");
```

**Duration:**
- Wait for network idle: ~5 seconds
- Click: ~500ms
- Page load: ~5 seconds
- **Total:** ~11 seconds

**Worker Log:**
```
[RDPRM] Clicking "Consulter le registre" link...
[RDPRM] Successfully navigated to consultation page (screenshot: 09_consultation_page.png)
```

**T+0:54.000 (10:00:54)** - Consultation page ready

### Phase 7: Search Company (T+0:54 - T+1:30)

**T+0:54.000 (10:00:54)** - Fill search form

```typescript
await page.waitForTimeout(2000);  // Explicit 2-second wait
const searchField = page.getByLabel(/Nom de l['']organisme/i);
await searchField.fill("AUTOMATISATIONS PARAITO INC.");
```

**Duration:** 2s wait + ~3s typing = 5 seconds

**Worker Log:**
```
[RDPRM] Searching for: AUTOMATISATIONS PARAITO INC.
```

**T+0:59.000 (10:00:59)** - Click search button

```typescript
await page.getByRole("button", { name: /Rechercher|Soumettre/i }).click();
```

**Duration:** ~500ms

**T+0:59.500 (10:00:59.500)** - Wait for confirmation dialogs

**Dialog 1: Amount confirmation (12,00 $)**

```typescript
const amountConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
await amountConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
await amountConfirmBtn.click();
await page.waitForTimeout(1000);  // 1-second pause
```

**Duration:** ~5 seconds (dialog appears + click + pause)

**Worker Log:**
```
[RDPRM] Waiting for amount confirmation dialog (12,00 $)...
[RDPRM] Amount confirmed (screenshot: 12_confirm_amount.png)
```

**T+1:04.500 (10:01:04.500)** - Second confirmation dialog

```typescript
const secondConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
await secondConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
await secondConfirmBtn.click();
```

**Duration:** ~3 seconds

**Worker Log:**
```
[RDPRM] Waiting for second confirmation dialog...
[RDPRM] Second confirmation completed (screenshot: 12c_second_confirm.png)
```

**T+1:07.500 (10:01:07.500)** - Wait for results to load

```typescript
await page.waitForLoadState("networkidle");
```

**Duration:** ~22 seconds (search processing on government servers)

**Worker Log:**
```
[RDPRM] Waiting for results to load...
[RDPRM] Results loaded (screenshot: 13_results_loaded.png)
```

**T+1:29.500 (10:01:29.500)** - Search results ready

### Phase 8: Download Fiche Complète (T+1:30 - T+4:30)

**T+1:29.500 (10:01:29.500)** - Scroll to find print link

```typescript
const timeoutMs = 180000; // 3-minute timeout
const start = Date.now();
while (Date.now() - start < timeoutMs) {
  const printLink = page.locator("a", {
    hasText: "Imprimer la fiche complète",
  });
  if (await printLink.isVisible().catch(() => false)) {
    await printLink.click();
    break;
  }
  await page.mouse.wheel(0, 1200);  // Scroll down
  await page.waitForTimeout(600);   // Wait 600ms
}
```

**Duration:** ~45 seconds (scrolling through long results page)

**Iterations:** ~75 scrolls × 600ms = 45 seconds

**Worker Log:**
```
[RDPRM] Scrolling to find "Imprimer la fiche complète" (timeout: 3 minutes)...
```

**T+2:14.500 (10:02:14.500)** - Print link found and clicked

**Worker Log:**
```
[RDPRM] Found print link (screenshot: 14_print_link_visible.png)
[RDPRM] Clicked "Imprimer la fiche complète"
```

**T+2:14.500 (10:02:14.500)** - Wait for warning modal

```typescript
const warningText = page
  .locator('div[role="dialog"]')
  .getByText(/Avertissement d['']impression volumineuse/);
await warningText.waitFor({ timeout: 30000 });
await page.getByRole("button", { name: /Imprimer/i }).click();
```

**Duration:** ~5 seconds

**Worker Log:**
```
[RDPRM] Waiting for large print warning modal...
[RDPRM] Warning modal detected (screenshot: 15_warning_modal.png)
[RDPRM] Clicked Imprimer button
```

**T+2:19.500 (10:02:19.500)** - PDF generation started

**T+2:19.500 (10:02:19.500)** - Wait for preparation to finish

```typescript
await page
  .getByText(/Préparation de l['']impression/)
  .waitFor({ state: "detached", timeout: 120000 });
```

**Duration:** ~120 seconds (2 minutes - slow government servers generating large PDF)

**Worker Log:**
```
[RDPRM] Waiting for preparation to finish and download link to appear...
```

**T+4:19.500 (10:04:19.500)** - Preparation complete

**T+4:19.500 (10:04:19.500)** - Wait for download link

```typescript
const downloadSelector = page.locator("a", {
  hasText: /Télécharger la fiche complète|Fiche complète disponible/,
});
await downloadSelector.waitFor({ timeout: 180000 });
```

**Duration:** ~5 seconds (link appears quickly after preparation)

**Worker Log:**
```
[RDPRM] Download link appeared (screenshot: 17_download_link_visible.png)
```

**T+4:24.500 (10:04:24.500)** - Click download link (opens PDF viewer)

```typescript
const [newPage] = await Promise.all([
  page.context().waitForEvent("page"),
  downloadSelector.click(),
]);
await newPage.waitForLoadState("domcontentloaded", { timeout: 120000 });
```

**Duration:** ~10 seconds (PDF viewer loads)

**Worker Log:**
```
[RDPRM] Opening PDF in new tab...
[RDPRM] PDF viewer URL: https://servicesclients.rdprm.gouv.qc.ca/...
```

**T+4:34.500 (10:04:34.500)** - PDF viewer loaded

**T+4:34.500 (10:04:34.500)** - Download PDF (Strategy 1: Download button)

```typescript
await newPage.waitForTimeout(2000);
const downloadControls = newPage.locator('viewer-download-controls#downloads cr-icon-button#save');
await downloadControls.click();
const downloadPromise = newPage.waitForEvent('download', { timeout: 30000 });
const download = await downloadPromise;
const downloadPath = await download.path();
pdfBuffer = fs.readFileSync(downloadPath);
```

**Duration:** ~5 seconds (file download)

**File Size:** 240 KB (typical)

**Worker Log:**
```
[RDPRM] Attempting to click download button in PDF viewer...
[RDPRM] Found download button via viewer-download-controls
[RDPRM] Download button clicked, waiting for download...
[RDPRM] Download started (filename: fiche_complete_12345.pdf)
[RDPRM] PDF downloaded via download button (size: 245,760 bytes)
```

**T+4:39.500 (10:04:39.500)** - PDF buffer in memory

### Phase 9: Upload to Supabase Storage (T+4:40 - T+4:50)

**T+4:39.500 (10:04:39.500)** - Close PDF viewer page

```typescript
await newPage.close().catch(() => {});
```

**T+4:40.000 (10:04:40)** - Close browser context

```typescript
await context.close();
```

**Worker Log:**
```
[RDPRM] Browser context closed
```

**T+4:40.000 (10:04:40)** - Upload PDF to Supabase Storage

```typescript
const fileName = "automatisations_paraito_inc.pdf";
const storagePath = `abc-123/${fileName}`;

const { error } = await supabase.storage
  .from('rdprm-documents')
  .upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
```

**Duration:** ~10 seconds (upload 240 KB to Supabase)

**Worker Log:**
```
[RDPRM] PDF uploaded to Supabase Storage (path: abc-123/automatisations_paraito_inc.pdf)
[RDPRM] Scraping completed successfully
```

**T+4:50.000 (10:04:50)** - Upload complete

### Phase 10: Update Database (T+4:50 - T+4:51)

**T+4:50.000 (10:04:50)** - Mark search as completed

```typescript
await updateSearchStatus("search-789", "completed", {
  storage_path: "abc-123/automatisations_paraito_inc.pdf",
  completed_at: new Date().toISOString(),
});
```

**Database State:**
```sql
rdprm_searches:
  id: search-789
  status: completed  ← Changed
  storage_path: abc-123/automatisations_paraito_inc.pdf  ← Added
  completed_at: 2025-01-25 10:04:50  ← Added
```

**Worker Log:**
```
[WORKER] ✓ Search search-789 completed successfully
```

**T+4:50.500 (10:04:50.500)** - Check session status

```typescript
await checkAndUpdateSessionStatus("abc-123");

// Queries all rdprm_searches for session abc-123
// If ALL have terminal status (completed/failed/not_found):
await supabase
  .from("search_sessions")
  .update({
    status: "completed",
    completed_at: new Date().toISOString(),
  })
  .eq("id", "abc-123");
```

**Database State:**
```sql
search_sessions:
  id: abc-123
  status: completed  ← Changed
  completed_at: 2025-01-25 10:04:50  ← Added
```

**Worker Log:**
```
[WORKER] All searches for session abc-123 completed
[WORKER] Session abc-123 marked as completed
```

**T+4:51.000 (10:04:51)** - **DONE**

## Summary Timeline

| Phase | Duration | Timestamp | Activity |
|-------|----------|-----------|----------|
| 1. Job Creation | 1s | T+0:00 - T+0:01 | Create session & name |
| 2. Trigger Fires | <1s | T+0:01 | Auto-create pending search |
| 3. Worker Polls | 10s | T+0:01 - T+0:10 | Wait for next poll cycle |
| 4. Browser Launch | 1s | T+0:10 - T+0:11 | Start Chromium |
| 5. Login | 32s | T+0:11 - T+0:43 | Homepage + credentials + auth |
| 6. Consultation | 11s | T+0:43 - T+0:54 | Navigate to search page |
| 7. Search | 36s | T+0:54 - T+1:30 | Fill form + 2 dialogs + results |
| 8. Download PDF | 180s | T+1:30 - T+4:30 | Scroll + print + prepare + download |
| 9. Upload | 10s | T+4:30 - T+4:40 | Upload to Supabase |
| 10. Update DB | 1s | T+4:40 - T+4:51 | Mark completed |
| **TOTAL** | **~5 minutes** | T+0:00 - T+4:51 | End-to-end |

## Bottlenecks

1. **Worker polling** - 10-second interval adds latency (job sits pending for up to 10s)
2. **Authentication** - 32 seconds (unavoidable, government servers)
3. **PDF preparation** - 120 seconds (slowest step, government PDF generation)
4. **Scroll polling** - 45 seconds (could optimize with faster scrolling or better selectors)

## Optimization Opportunities

1. **Reduce poll interval** to 5 seconds (trade-off: more DB queries)
2. **Session reuse** - Don't clear cache, reuse auth (risk: stale sessions)
3. **Parallel searches** - Increase MAX_CONCURRENT (needs proper locking)
4. **Smarter scrolling** - Jump to sections instead of smooth scroll
5. **Direct PDF URL** - Skip scrolling entirely if URL pattern known

## Real-World Variability

Actual times vary based on:
- Government server load (peak hours vs off-hours)
- PDF size (simple company vs complex with many records)
- Security question presence (adds 10s if present)
- Network conditions (local internet vs data center)
- Scroll distance (company near top vs near bottom of results)

**Typical range:** 3-8 minutes per search

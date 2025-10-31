# RDPRM Scraper - Complete Browser Automation Flow

## Overview

File: `/Users/marco/Documents/Dev/RDPRM 2/lib/rdprm.ts` (573 lines)

The RDPRM scraper is a **Playwright browser automation** that:
1. Logs into the RDPRM government website
2. Searches for a company
3. Downloads the "Fiche complète" PDF
4. Uploads to Supabase Storage

**Key characteristic:** Uses `headless: false` and `slowMo: 500` for **local debugging visibility**.

## Entry Point

```typescript
// Lines 505-573
export async function scrapeFicheComplete(
  company: string,      // Company name to search
  sessionId: string     // Session ID for storage path
): Promise<string>      // Returns storage path
```

**Called by:** Worker's `processSearch()` function

**Returns:** Storage path like `"session-id/company_name.pdf"`

**Throws:**
- `CompanyNotFoundError` - Company not in RDPRM registry
- `Error` - Any other failure (timeout, browser crash, etc.)

## Function Breakdown

### 1. Setup & Browser Launch (Lines 505-532)

```typescript
export async function scrapeFicheComplete(
  company: string,
  sessionId: string
): Promise<string> {
  // Step 1: Prepare directories
  const dataDir = ensureDataDir();  // Returns "./data" or env override
  const stem = fileStemFromCompany(company);  // "Company Name" → "company_name"
  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";

  console.log(`[RDPRM] Starting automation for: ${company}`);
  console.log(`[RDPRM] Debug mode: ${DEBUG_MODE ? "ENABLED" : "DISABLED"}`);
  console.log(`[RDPRM] Data directory: ${dataDir}`);
  console.log(`[RDPRM] Session ID: ${sessionId}`);

  // Step 2: Clear Playwright session cache
  const sessionDir = path.join(dataDir, ".pw-session");
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.log("[RDPRM] Cleared Playwright session cache");
  } catch {}

  // Step 3: Launch persistent browser context
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,              // VISIBLE BROWSER (requires display)
    acceptDownloads: true,        // Handle downloads
    viewport: { width: 1366, height: 900 },
    slowMo: 500,                  // 500ms delay between actions
  });
  const page = await context.newPage();
```

**Critical Settings:**

| Setting | Value | Purpose |
|---------|-------|---------|
| `headless` | `false` | Shows browser window (debugging) |
| `acceptDownloads` | `true` | Enables download event handling |
| `viewport` | 1366×900 | Standard desktop resolution |
| `slowMo` | 500ms | **CRITICAL: Slows all actions for site compatibility** |

**Session Cache Clearing:**
- Deletes `.pw-session` directory before each run
- Forces fresh login every time
- Prevents stale authentication issues

### 2. Login Function (Lines 39-131)

The login function handles the complete authentication flow with multiple scenarios.

#### 2A. Homepage Navigation

```typescript
// Lines 44-48
console.log("[RDPRM] Navigating to homepage...");
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "networkidle",  // Wait for all network activity
});
await debugScreenshot(page, "01_homepage", dataDir);
```

**Wait Strategy:** `networkidle`
- Waits until no more than 2 network connections for 500ms
- Ensures page fully loaded including all JavaScript
- **Works locally but may timeout on servers**

#### 2B. Cookie Banner

```typescript
// Lines 51-58
try {
  const cookieBtn = page.getByText("Fermer", { exact: true });
  if (await cookieBtn.isVisible()) {
    await cookieBtn.click();
    console.log("[RDPRM] Cookie banner closed");
    await debugScreenshot(page, "01b_cookie_closed", dataDir);
  }
} catch {}
```

**Selector:** `getByText("Fermer", { exact: true })`
- Finds button with exact text "Fermer" (Close)
- Try/catch ignores if banner not present

#### 2C. Check Existing Session

```typescript
// Lines 61-70
try {
  await page.goto("https://servicesclients.rdprm.gouv.qc.ca/MesServices/", {
    waitUntil: "domcontentloaded",
  });
  if (await page.getByText("Bienvenue", { exact: false }).isVisible()) {
    console.log("[RDPRM] Existing session detected, skipping login");
    await debugScreenshot(page, "01c_dashboard_detected", dataDir);
    return;  // Skip rest of login
  }
} catch {}
```

**Optimization:** If already authenticated, skip credential entry.

**Detection:** Looks for "Bienvenue" (Welcome) text on dashboard.

#### 2D. Enter Credentials

```typescript
// Lines 72-89
console.log("[RDPRM] Proceeding to login form...");
await debugScreenshot(page, "02_login_page", dataDir);

console.log("[RDPRM] Entering credentials...");
await page.waitForTimeout(3000);  // ← EXPLICIT 3-second wait

// Fill username
const usernameField = page.locator('input[type="text"]').first();
await usernameField.fill(RDPRM_USER);

// Fill password
const passwordField = page.locator('input[type="password"]').first();
await passwordField.fill(RDPRM_PASS);

await debugScreenshot(page, "03_credentials_filled", dataDir);
```

**Why 3-second wait?**
- Login form may have JavaScript initialization
- Fields may not be immediately ready
- Ensures stable form state before typing

**Selectors:**
- `input[type="text"]` - Generic text input (username)
- `input[type="password"]` - Password input
- `.first()` - Takes first matching element

**Not robust:** Generic selectors could match wrong fields if page structure changes.

#### 2E. Submit Login

```typescript
// Lines 92-98
console.log('[RDPRM] Clicking "Entrer" button...');
await page.getByRole("button", { name: /Entrer/i }).click();
await debugScreenshot(page, "04_after_login_click", dataDir);

console.log("[RDPRM] Waiting for page after login...");
await page.waitForLoadState("networkidle", { timeout: 60000 });
await debugScreenshot(page, "05_after_login", dataDir);
```

**Button Selector:** `getByRole("button", { name: /Entrer/i })`
- Role: button
- Name regex: `/Entrer/i` (case-insensitive)
- More robust than generic selectors

**Wait Strategy:** `networkidle` with 60-second timeout
- Critical: Login triggers backend authentication APIs
- Must wait for authentication to complete
- **60s timeout protects against infinite wait**

#### 2F. Security Question (Lines 102-127)

```typescript
console.log("[RDPRM] Checking for security question...");

const pageContent = await page.content();
if (
  pageContent.includes("Confirmer votre identité") ||
  pageContent.includes("Dans quelle ville")
) {
  console.log("[RDPRM] Security question detected! Answering with RDPRM...");
  await debugScreenshot(page, "06_security_question", dataDir);

  // Fill answer field
  const answerField = page.locator('input[type="text"]').first();
  await answerField.waitFor({ state: "visible", timeout: 5000 });
  await answerField.fill(RDPRM_SEC);
  await debugScreenshot(page, "06b_security_filled", dataDir);

  // Click "Poursuivre"
  console.log('[RDPRM] Clicking "Poursuivre" button...');
  await page.getByRole("button", { name: /Poursuivre/i }).click();
  await page.waitForLoadState("networkidle");
  await debugScreenshot(page, "06c_after_security_answer", dataDir);
  console.log("[RDPRM] Security question answered!");
} else {
  console.log("[RDPRM] No security question detected, continuing...");
}
```

**Detection Method:** Search full page HTML for specific text
- "Confirmer votre identité" (Confirm your identity)
- "Dans quelle ville" (In which city)

**Answer:** Environment variable `RDPRM_SEC` (value: "RDPRM")

**Wait:** `answerField.waitFor({ state: "visible", timeout: 5000 })`
- Ensures field is visible before typing
- 5-second timeout (field should appear quickly)

### 3. Navigate to Consultation (Lines 133-146)

```typescript
async function goToConsultation(page: Page, dataDir: string) {
  console.log('[RDPRM] Clicking "Consulter le registre" link...');
  await debugScreenshot(page, "08_before_consultation_click", dataDir);

  // Wait for page to be ready
  await page.waitForLoadState("networkidle");

  // Click the consultation link
  await page.locator('a[href="/Consultation/"]').click();

  await page.waitForLoadState("domcontentloaded");
  await debugScreenshot(page, "09_consultation_page", dataDir);
  console.log("[RDPRM] Successfully navigated to consultation page");
}
```

**Two-stage wait:**
1. **Before click:** `networkidle` - Ensure dashboard fully loaded
2. **After click:** `domcontentloaded` - Lighter wait for new page

**Link Selector:** `a[href="/Consultation/"]`
- Direct href match (simple and reliable)
- Assumes consistent URL structure

### 4. Search Company (Lines 148-202)

#### 4A. Fill Search Form

```typescript
console.log(`[RDPRM] Searching for: ${company}`);
await debugScreenshot(page, "10_before_search", dataDir);

// Wait for form to be ready
await page.waitForTimeout(2000);  // ← EXPLICIT 2-second wait

// Find search field by label
const searchField = page.getByLabel(/Nom de l['']organisme/i);
await searchField.fill(company);
await debugScreenshot(page, "10_search_filled", dataDir);
```

**Why 2-second wait?**
- Search form may have JavaScript initialization
- AutoComplete/validation may be loading
- Ensures stable form state

**Selector:** `getByLabel(/Nom de l['']organisme/i)`
- Finds input by its associated label text
- Regex handles both straight apostrophe (') and curly apostrophe (')
- Robust against layout changes

#### 4B. Submit Search

```typescript
// Click search button
await page.getByRole("button", { name: /Rechercher|Soumettre/i }).click();
await debugScreenshot(page, "11_after_search_click", dataDir);
```

**Button Selector:** Matches either "Rechercher" (Search) or "Soumettre" (Submit)

#### 4C. Handle Confirmation Dialogs

**First Dialog: Amount ($12.00)**

```typescript
// Lines 173-187
console.log("[RDPRM] Waiting for amount confirmation dialog (12,00 $)...");
const amountConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
await amountConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
await debugScreenshot(page, "12_confirm_amount", dataDir);

// Verify it's the amount dialog
const dialogContent = await page.locator('[role="dialog"]').textContent().catch(() => "") || "";
if (dialogContent.includes("12,00") || dialogContent.includes("12.00") || dialogContent.includes("$")) {
  console.log("[RDPRM] Amount confirmation dialog detected");
}

await amountConfirmBtn.click();
console.log("[RDPRM] Amount confirmed");
await page.waitForTimeout(1000);  // ← EXPLICIT 1-second pause
await debugScreenshot(page, "12b_after_amount_confirm", dataDir);
```

**Wait Strategy:** `amountConfirmBtn.waitFor({ state: "visible", timeout: 30000 })`
- Waits up to 30 seconds for dialog to appear
- Throws error if not found

**Verification:** Checks dialog contains amount text ($12.00)
- Multiple formats: "12,00", "12.00", "$"
- Ensures correct dialog detected

**Second Dialog**

```typescript
// Lines 190-196
console.log("[RDPRM] Waiting for second confirmation dialog...");
const secondConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
await secondConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
await debugScreenshot(page, "12c_second_confirm", dataDir);
await secondConfirmBtn.click();
console.log("[RDPRM] Second confirmation completed");
```

**Why 1-second pause between dialogs?**
- First dialog must fully close
- Second dialog needs time to appear
- Prevents race condition

#### 4D. Wait for Results

```typescript
// Lines 199-202
console.log("[RDPRM] Waiting for results to load...");
await page.waitForLoadState("networkidle");
await debugScreenshot(page, "13_results_loaded", dataDir);
```

**Wait Strategy:** `networkidle`
- Results page may have dynamic loading
- Ensures all content rendered before proceeding

### 5. Download Fiche Complète (Lines 204-503)

This is the most complex part with 4 fallback strategies.

#### 5A. Find Print Link with Scrolling

```typescript
// Lines 208-237
console.log('[RDPRM] Scrolling to find "Imprimer la fiche complète" (timeout: 3 minutes)...');
const timeoutMs = 180000;  // 3 minutes
const start = Date.now();
let foundPrint = false;

while (Date.now() - start < timeoutMs) {
  const printLink = page.locator("a", {
    hasText: "Imprimer la fiche complète",
  });

  if (await printLink.isVisible().catch(() => false)) {
    await debugScreenshot(page, "14_print_link_visible", dataDir);
    await printLink.click();
    console.log('[RDPRM] Clicked "Imprimer la fiche complète"');
    foundPrint = true;
    break;
  }

  // Check for "no results"
  const noResult = await page
    .getByText(/Aucun r?sultat|Aucun r e9sultat/i)
    .isVisible()
    .catch(() => false);
  if (noResult) break;

  // Scroll down and retry
  await page.mouse.wheel(0, 1200);  // Scroll 1200 pixels
  await page.waitForTimeout(600);   // Wait 600ms
}

if (!foundPrint) {
  throw new CompanyNotFoundError();
}
```

**Scrolling Strategy:**
- Scroll 1200 pixels at a time
- Wait 600ms between scrolls (for rendering)
- Continue until link found or 3-minute timeout
- **Typical:** 45 seconds for average results page

**Company Not Found Detection:**
- Text: "Aucun résultat" (No results)
- Handles encoding variants: `r?sultat`, `r e9sultat`
- Throws `CompanyNotFoundError` (special handling)

#### 5B. Handle Warning Modal

```typescript
// Lines 239-263
console.log("[RDPRM] Waiting for large print warning modal...");
const warningText = page
  .locator('div[role="dialog"]')
  .getByText(/Avertissement d['']impression volumineuse/);
await warningText.waitFor({ timeout: 30000 });
await debugScreenshot(page, "15_warning_modal", dataDir);

// Try to click "Imprimer" button
let printed = false;
try {
  await page.getByRole("button", { name: /Imprimer/i }).click();
  printed = true;
} catch {}

// Fallback: Try input element
if (!printed) {
  const inputImprimer = page.locator('input[value="Imprimer"]');
  if (await inputImprimer.isVisible().catch(() => false)) {
    await inputImprimer.click();
    printed = true;
  }
}

if (!printed) {
  throw new Error("Could not find the Imprimer button in the warning modal");
}
```

**Warning Text:** "Avertissement d'impression volumineuse"
- Warns about large file size
- Must click "Imprimer" (Print) to proceed

**Two Click Strategies:**
1. **Button role:** `getByRole("button", { name: /Imprimer/i })`
2. **Input element:** `input[value="Imprimer"]`

**Why fallback?** Modal may use different HTML structures.

#### 5C. Wait for Download Link

```typescript
// Lines 265-280
console.log("[RDPRM] Waiting for preparation to finish and download link to appear...");

// Wait for "Préparation..." text to disappear
await page
  .getByText(/Préparation de l['']impression/)
  .waitFor({ state: "detached", timeout: 120000 })
  .catch(() => {});

// Wait for download link to appear
const downloadSelector = page.locator("a", {
  hasText: /Télécharger la fiche complète|Fiche complète disponible/,
});
await downloadSelector.waitFor({ timeout: 180000 });  // 3 minutes!
await debugScreenshot(page, "17_download_link_visible", dataDir);
```

**Two-stage wait:**

1. **Preparation text disappears** (120s = 2 minutes)
   - "Préparation de l'impression"
   - Server generating PDF
   - `.catch(() => {})` - Ignore if already gone

2. **Download link appears** (180s = 3 minutes)
   - "Télécharger la fiche complète" or "Fiche complète disponible"
   - PDF generation complete
   - **Long timeout:** Government servers are slow

#### 5D. Download PDF - 4 Fallback Strategies

**Strategy 1: Download Button Click (Lines 282-358)**

```typescript
const [newPage] = await Promise.all([
  page.context().waitForEvent("page"),  // Wait for new tab
  downloadSelector.click(),              // Click download link
]);
await newPage.waitForLoadState("domcontentloaded", { timeout: 120000 });

// Try multiple selector strategies
let clicked = false;

// 1. viewer-download-controls component
const downloadControls = newPage.locator('viewer-download-controls#downloads cr-icon-button#save');
if (await downloadControls.isVisible().catch(() => false)) {
  await downloadControls.click();
  clicked = true;
}

// 2. iron-icon attribute
if (!clicked) {
  const iconButton = newPage.locator('cr-icon-button[iron-icon="cr:file-download"]');
  if (await iconButton.isVisible().catch(() => false)) {
    await iconButton.click();
    clicked = true;
  }
}

// 3. aria-label or title
if (!clicked) {
  const ariaButton = newPage.locator('cr-icon-button[aria-label="Download"], cr-icon-button[title="Download"]');
  if (await ariaButton.isVisible().catch(() => false)) {
    await ariaButton.click();
    clicked = true;
  }
}

// 4. toolbar end section
if (!clicked) {
  const toolbarButton = newPage.locator('#toolbar #end cr-icon-button').first();
  if (await toolbarButton.isVisible().catch(() => false)) {
    await toolbarButton.click();
    clicked = true;
  }
}

// Wait for download event
const downloadPromise = newPage.waitForEvent('download', { timeout: 30000 });
const download = await downloadPromise;

// Get file from download
const downloadPath = await download.path();
if (downloadPath) {
  pdfBuffer = fs.readFileSync(downloadPath);
  fs.unlinkSync(downloadPath);  // Clean up temp file
}
```

**Why 4 different selectors?**
- PDF viewer HTML structure varies by browser/version
- Each selector targets same download button differently
- First successful click wins

**Strategy 2: In-Page Viewer Fetch (Lines 377-399)**

```typescript
if (!pdfBuffer) {
  const viewerUrl = newPage.url();
  const b64 = await newPage.evaluate(async u => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) throw new Error(`viewer fetch failed ${r.status}`);
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++)
      bin += String.fromCharCode(bytes[i]);
    return btoa(bin);  // Return base64
  }, viewerUrl);
  pdfBuffer = Buffer.from(b64, "base64");
}
```

**Executes fetch() inside browser context**
- Maintains all cookies/auth state
- Fetches viewer URL as blob
- Converts to base64 for transfer
- Node.js decodes to Buffer

**Strategy 3: Embed/iframe Fetch (Lines 401-459)**

```typescript
if (!pdfBuffer) {
  const pdfSrc = await newPage
    .locator("embed[src], iframe[src]")
    .first()
    .getAttribute("src");

  if (pdfSrc) {
    const absolutePdfUrl = pdfSrc.startsWith("http")
      ? pdfSrc
      : new URL(pdfSrc, newPage.url()).toString();

    // Get cookies from browser
    const urlObj = new URL(absolutePdfUrl);
    const cookiesArr = await newPage.context().cookies(urlObj.origin);
    const cookieHeader = cookiesArr
      .map(c => `${c.name}=${c.value}`)
      .join("; ");

    // Fetch with cookies
    const resp = await newPage.context().request.get(absolutePdfUrl, {
      headers: {
        Accept: "application/pdf",
        Referer: newPage.url(),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    if (resp.ok()) {
      const buffer = await resp.body();
      pdfBuffer = Buffer.from(new Uint8Array(buffer));
    }
  }
}
```

**Finds PDF in embed/iframe:**
- Extracts `src` attribute
- Converts to absolute URL if relative
- Fetches with authentication cookies
- **Fallback:** If fetch fails, tries in-page fetch

**Strategy 4: Direct Viewer URL Fetch (Lines 461-492)**

```typescript
if (!pdfBuffer) {
  const viewerUrl = newPage.url();
  const cookiesArr2 = await newPage.context().cookies(new URL(viewerUrl).origin);
  const cookieHeader2 = cookiesArr2
    .map(c => `${c.name}=${c.value}`)
    .join("; ");

  const resp2 = await newPage.context().request.get(viewerUrl, {
    headers: {
      Accept: "application/pdf",
      Referer: page.url(),
      ...(cookieHeader2 ? { Cookie: cookieHeader2 } : {}),
    },
  });

  if (!resp2.ok())
    throw new Error(`${resp2.status()} ${resp2.statusText()}`);

  const buffer2 = await resp2.body();
  pdfBuffer = Buffer.from(new Uint8Array(buffer2));
}
```

**Last resort:** Fetch viewer URL directly as PDF
- Some viewers serve PDF directly at viewer URL
- Includes all authentication cookies
- Throws error if this also fails

**If all 4 strategies fail:**
```typescript
if (!pdfBuffer) {
  throw new Error("Failed to download PDF from RDPRM viewer");
}
```

### 6. Upload to Supabase Storage (Lines 540-555)

```typescript
// Ensure .pdf extension
const fileName = stem.endsWith('.pdf') ? stem : `${stem}.pdf`;
const storagePath = `${sessionId}/${fileName}`;

console.log("[RDPRM] Uploading PDF to Supabase Storage:", storagePath);

const { error } = await supabase.storage
  .from('rdprm-documents')
  .upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,  // Replace if exists
  });

if (error) {
  console.error("[RDPRM] Error uploading to Supabase Storage:", error);
  throw new Error(`Failed to upload PDF to storage: ${error.message}`);
}

console.log("[RDPRM] PDF uploaded successfully:", storagePath);
return storagePath;
```

**Storage Path Format:** `{sessionId}/{fileName}.pdf`
- Example: `381db674-df0d-46ca-8c4e-b76faef5d903/automatisations_paraito_inc.pdf`

**Bucket:** `rdprm-documents` (private bucket)

**Upload Options:**
- `contentType: 'application/pdf'` - Proper MIME type
- `upsert: true` - Overwrite if file already exists

### 7. Cleanup and Error Handling (Lines 534-572)

```typescript
try {
  await login(page, dataDir);
  await goToConsultation(page, dataDir);
  await searchOrganisme(page, company, dataDir);
  const pdfBuffer = await downloadFicheComplete(page, dataDir);

  // Upload and return path
  const fileName = stem.endsWith('.pdf') ? stem : `${stem}.pdf`;
  const storagePath = `${sessionId}/${fileName}`;
  await supabase.storage.from('rdprm-documents').upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  return storagePath;

} catch (error) {
  console.error("[RDPRM] Error during automation:", error);
  await debugScreenshot(page, "ERROR", dataDir);
  throw error;  // Re-throw for worker to catch

} finally {
  await context.close();  // ALWAYS close browser
  console.log("[RDPRM] Browser closed");
}
```

**Error Handling:**
1. Catch any error
2. Take "ERROR" screenshot for debugging
3. Re-throw error (worker will handle)

**Cleanup:**
- `finally` block ensures browser always closes
- Prevents orphaned Chromium processes
- Releases system resources

## Helper Functions

### Debug Screenshot

```typescript
// Lines 27-37
async function debugScreenshot(page: Page, name: string, dataDir: string) {
  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";
  if (DEBUG_MODE) {
    const screenshotPath = path.join(
      dataDir,
      `debug_${name}_${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[DEBUG] Screenshot saved: ${screenshotPath}`);
  }
}
```

**Enabled by:** `DEBUG_PLAYWRIGHT=true`

**File format:** `debug_{name}_{timestamp}.png`

**Example:** `debug_01_homepage_1706198400000.png`

### File Stem Generator

```typescript
// Lines 488-493 (in storage.ts)
function fileStemFromCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
```

**Transformation:**
- `"Automatisations Paraito Inc."` → `"automatisations_paraito_inc"`
- Removes special characters
- Replaces spaces with underscores
- Lowercase

## Summary of Wait Strategies

| Location | Strategy | Timeout | Why |
|----------|----------|---------|-----|
| Homepage | `networkidle` | 30s | Full page load |
| After login | `networkidle` | 60s | Authentication APIs |
| Consultation | `networkidle` | 30s | Dashboard ready |
| After search | `networkidle` | 30s | Results loaded |
| Form ready | `waitForTimeout` | 2-3s | JavaScript init |
| Dialog appear | `.waitFor({ visible })` | 30s | Modal animation |
| PDF preparation | `.waitFor({ detached })` | 120s | Server processing |
| Download link | `.waitFor({ visible })` | 180s | PDF generation |

## Key Takeaways

1. **slowMo: 500 is essential** - Gives website time to respond
2. **Multiple fallback strategies** - Ensures high success rate
3. **Explicit waits supplement networkidle** - Forms need initialization time
4. **Always close browser** - Prevents resource leaks
5. **Works locally only** - Requires display for headless: false

**For server deployment:**
- Change `headless: true`
- Replace `networkidle` with `domcontentloaded + explicit waits`
- **Keep `slowMo: 500`** (critical!)

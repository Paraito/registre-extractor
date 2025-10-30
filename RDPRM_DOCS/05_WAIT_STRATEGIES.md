# RDPRM 2 Wait Strategies - Complete Analysis

## Overview

RDPRM 2 uses a **mixed strategy** combining `networkidle`, `domcontentloaded`, and explicit `waitForTimeout()` calls.

## All Wait Strategies Used

### 1. `networkidle` - Wait for ALL Network Activity

**When Used:**
- Homepage navigation (line 46)
- After login button click (line 97)
- After security question (line 122)
- Before consultation click (line 138)
- After search submission (line 200)

**Timeout:** 60 seconds (explicit on line 97), otherwise default 30s

**Why Used:** Critical authentication and data-loading points where JavaScript needs to fully execute and backend APIs need to respond.

**Code Examples:**
```typescript
// Homepage
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "networkidle",
});

// After login
await page.waitForLoadState("networkidle", { timeout: 60000 });

// After security question
await page.waitForLoadState("networkidle");

// Before consultation
await page.waitForLoadState("networkidle");

// After search
await page.waitForLoadState("networkidle");
```

### 2. `domcontentloaded` - Wait for HTML Parsing Only

**When Used:**
- Checking for existing session (line 63)
- After clicking consultation link (line 143)
- PDF viewer page load (line 288)

**Why Used:** Lighter check when full network idle not needed, just need DOM ready.

**Code Examples:**
```typescript
// Check existing session
await page.goto("https://servicesclients.rdprm.gouv.qc.ca/MesServices/", {
  waitUntil: "domcontentloaded",
});

// After consultation click
await page.waitForLoadState("domcontentloaded");
```

### 3. `waitForTimeout(ms)` - Explicit Fixed Delays

**All Occurrences:**

| Line | Duration | Purpose | Context |
|------|----------|---------|---------|
| 79 | 3000ms | Wait for login form to be ready | Before entering credentials |
| 153 | 2000ms | Wait for search form to load | Before filling search field |
| 187 | 1000ms | Brief pause between dialogs | Between 1st and 2nd confirmation |
| 233 | 600ms | Between scroll attempts | While looking for print link |
| 300 | 2000ms | Before download button click | After PDF viewer opens |

**Pattern:** Longer waits (2-3s) for forms, shorter waits (600ms-1s) for UI transitions

### 4. `.waitFor({ state: "visible" })` - Element Visibility

**When Used:**
- Security question answer field (line 115): `await answerField.waitFor({ state: "visible", timeout: 5000 });`
- First confirmation dialog (line 176): `await amountConfirmBtn.waitFor({ state: "visible", timeout: 30000 });`
- Second confirmation dialog (line 193): `await secondConfirmBtn.waitFor({ state: "visible", timeout: 30000 });`
- Warning modal text (line 242): `await warningText.waitFor({ timeout: 30000 });`
- Download link (line 275): `await downloadSelector.waitFor({ timeout: 180000 });`

**Timeouts:**
- Short (5s): Elements that should appear immediately (answer field)
- Medium (30s): Dialog boxes that appear after button clicks
- Long (180s = 3 minutes): Download preparation (slow server operation)

### 5. `.waitFor({ state: "detached" })` - Element Removal

**When Used:**
- Waiting for "Préparation..." text to disappear (line 266-269)

```typescript
await page
  .getByText(/Préparation de l['']impression/)
  .waitFor({ state: "detached", timeout: 120000 })
  .catch(() => {});
```

**Timeout:** 120 seconds (2 minutes)
**Purpose:** PDF generation can take time on government servers

### 6. `waitForLoadState()` - Specific Load States

**When Used:**
- After login click: `await page.waitForLoadState("networkidle", { timeout: 60000 });`
- After security: `await page.waitForLoadState("networkidle");`
- After consultation: `await page.waitForLoadState("domcontentloaded");`
- PDF viewer: `await newPage.waitForLoadState("domcontentloaded", { timeout: 120000 });`

### 7. `.waitForEvent()` - Browser Events

**When Used:**
- New tab/page opening (line 283-286):
  ```typescript
  const [newPage] = await Promise.all([
    page.context().waitForEvent("page"),
    downloadSelector.click(),
  ]);
  ```
- Download event (line 349):
  ```typescript
  const downloadPromise = newPage.waitForEvent('download', { timeout: 30000 });
  const download = await downloadPromise;
  ```

## Wait Strategy Decision Tree

```
Navigation Event
├─ Is it initial page load?
│  └─ YES → networkidle (homepage, login)
│
├─ Is it authentication/data submission?
│  └─ YES → networkidle (login, security, search)
│
├─ Is it a dialog/modal appearing?
│  └─ YES → .waitFor({ state: "visible" })
│
├─ Is it a slow server operation?
│  └─ YES → Long timeout .waitFor() (180s for download)
│
├─ Is it a form that needs time?
│  └─ YES → waitForTimeout(2000-3000ms)
│
└─ Is it a simple navigation?
   └─ YES → domcontentloaded
```

## Critical Pattern

**"Authenticate and Load" Pattern:**
1. Navigate with `networkidle` (wait for everything)
2. Explicit `waitForTimeout()` (give forms time to initialize)
3. Fill form fields
4. Click button
5. Wait with `networkidle` (wait for authentication/processing)

This pattern repeats at:
- Homepage → Login
- Login → Security Question
- Search → Results

## Why This Works on Local Mac

The `networkidle` strategy works because:
1. **Fast local network** - Network activity settles quickly
2. **No rate limiting** - Direct connection to government site
3. **Visible browser** - Full rendering with `headless: false`
4. **slowMo: 500** - Actions naturally paced, gives site time to respond

## Why This Fails on Server

On registre-extractor's headless server:
1. **Different network conditions** - May have persistent connections that never idle
2. **Rate limiting** - Government may treat server differently
3. **Headless mode** - Some JavaScript may behave differently
4. **No slowMo originally** - Actions happened too fast (`slowMo: 0`)

## Recommendation for Server

**Use `domcontentloaded` + explicit waits + `slowMo: 500`:**

```typescript
// Homepage
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(3000); // Explicit wait

// After login
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(3000); // Explicit wait

// Browser launch
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: true,  // MUST be true on server
  slowMo: 500,     // CRITICAL: Keep this from RDPRM 2
  // ...
});
```

The `slowMo: 500` is the **most important** setting to copy - it ensures 500ms delay between every action (clicks, typing, navigation), giving the website time to respond properly.

# Critical Differences: RDPRM 2 vs registre-extractor

## Executive Summary

RDPRM 2 works **perfectly** because it runs **locally on a Mac with a display**. registre-extractor fails because it runs on a **headless server** and was missing the critical `slowMo: 500` setting.

## The Root Cause

**RDPRM 2 is NOT designed for production servers.** It's a local development/testing tool that happens to work reliably. Copying it directly to a server environment requires adaptations.

## Environment Comparison

| Aspect | RDPRM 2 (Local Mac) | registre-extractor (Server) |
|--------|---------------------|------------------------------|
| **Display** | Has display (monitor) | No display (headless) |
| **Browser Mode** | `headless: false` ✅ | Must use `headless: true` |
| **Network** | Fast residential internet | Data center network |
| **Wait Strategy** | `networkidle` everywhere | `networkidle` NEVER completes |
| **slowMo** | 500ms (always) | Was 0ms in production ❌ |
| **Playwright** | 1.48.0 | 1.56.1 |
| **Purpose** | Development/testing | Production automation |
| **Concurrency** | 1 (MAX_CONCURRENT=1) | Needs higher for scale |

## Configuration Differences

### Browser Launch - The Critical Settings

**RDPRM 2 (lib/rdprm.ts:526-531):**
```typescript
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: false,              // ❌ REQUIRES DISPLAY
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
  slowMo: 500,                  // ✅ CRITICAL: 500ms delays
});
```

**registre-extractor BEFORE fixes (src/rdprm/scraper.ts):**
```typescript
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: process.env.NODE_ENV === 'production',  // ❌ true in production
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
  slowMo: process.env.NODE_ENV === 'production' ? 0 : 500,  // ❌ 0ms in production!
});
```

**registre-extractor AFTER fixes:**
```typescript
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: true,               // ✅ Must be true on server
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
  slowMo: 500,                  // ✅ FIXED: Always 500ms now
});
```

## Wait Strategy Differences

### Why `networkidle` Works Locally but Not on Server

**On Local Mac (RDPRM 2):**
- Fast network connection
- No rate limiting
- JavaScript execution completes quickly
- Site reaches "network idle" within 10-30 seconds

**On Server (registre-extractor):**
- Different network routing
- Possible rate limiting from Quebec government
- Persistent background connections that never idle
- Site **NEVER** reaches "network idle" (60+ second timeouts)

**Evidence:**
```
With networkidle: Times out on homepage (never gets past it)
With domcontentloaded: Gets past homepage, past login, fails later
```

### The Adapted Strategy

Replace `networkidle` with `domcontentloaded + explicit waits`:

**RDPRM 2 approach:**
```typescript
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "networkidle",
});
```

**Adapted for server:**
```typescript
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(3000); // Explicit wait for JS to execute
```

## The Most Critical Finding: slowMo

### Why slowMo: 500 is Essential

The Quebec government RDPRM website was **NOT designed for automation**. It expects:
1. Human-speed interactions (typing, clicking)
2. Time for JavaScript to execute between actions
3. Time for backend APIs to process authentication

**Without slowMo (value: 0):**
- Actions happen **instantly**
- Website's JavaScript can't keep up
- Authentication fails
- Pages timeout

**With slowMo: 500:**
- 500ms pause **before every action** (click, type, navigate)
- Website has time to process
- JavaScript executes properly
- Authentication succeeds

**This is the single most important difference.**

## Package Version Differences

### Playwright Version

| Version | Used By | Notes |
|---------|---------|-------|
| 1.48.0 | RDPRM 2 | Locked exact version, tested |
| 1.56.1 | registre-extractor | Newer, different behavior? |

**However:** Downgrading caused dependency conflicts with `agentql` (used for Land Registry extraction), so registre-extractor stays on 1.56.1.

## Architectural Differences

### Job Processing

**RDPRM 2:**
- Single worker process
- Polls every 10 seconds
- Processes 1 job at a time
- No distributed locking
- Simple in-memory tracking

**registre-extractor:**
- Unified worker (handles multiple job types)
- More complex
- Needs to scale horizontally
- Requires proper job claiming with database locking

### Database Schema

**RDPRM 2:**
- Has `updated_at` column in `rdprm_searches`
- Used in UPDATE queries

**registre-extractor (PROD):**
- **Missing** `updated_at` column in `rdprm_searches`
- Was causing UPDATE failures (fixed by removing from queries)

## File Organization

**RDPRM 2:**
```
rdprm-worker.ts       # Dedicated RDPRM worker
lib/rdprm.ts          # RDPRM scraper
```

**registre-extractor:**
```
worker/unified-worker.ts    # Handles ALL job types
src/rdprm/scraper.ts        # RDPRM scraper
src/req/scraper.ts          # REQ scraper
```

## Testing Approach

**RDPRM 2:**
- Development tool
- Runs locally with visible browser
- Easy to debug (can watch it work)
- Debug screenshots enabled

**registre-extractor:**
- Production system
- Headless server
- No visual debugging
- Must rely on logs

## Lessons Learned

### What to Copy from RDPRM 2

✅ **DO COPY:**
1. `slowMo: 500` - **CRITICAL**
2. Explicit `waitForTimeout()` calls (2-3 seconds)
3. 4-layer PDF download fallback strategy
4. Database trigger pattern for job automation
5. Fresh session approach (clear cache each time)

❌ **DO NOT COPY:**
1. `headless: false` - Won't work on server
2. `networkidle` everywhere - Doesn't work on server
3. Single concurrent job limit - Doesn't scale
4. No job locking - Race conditions with multiple workers

### Adaptations Required for Production

1. **Browser mode:** `headless: true` (server requirement)
2. **Wait strategy:** `domcontentloaded + explicit waits` (server network reality)
3. **Keep slowMo:** `slowMo: 500` (critical for website compatibility)
4. **Job locking:** Proper database-level claiming (horizontal scaling)
5. **Error handling:** More robust retry logic
6. **Monitoring:** Better logging and alerting

## The Winning Combination for Server

```typescript
// Browser launch
const context = await chromium.launchPersistentContext(sessionDir, {
  headless: true,       // Server requirement
  slowMo: 500,          // Critical from RDPRM 2
  acceptDownloads: true,
  viewport: { width: 1366, height: 900 },
});

// Navigation
await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
  waitUntil: "domcontentloaded",  // Works on server
  timeout: 60000,
});
await page.waitForTimeout(3000);  // Explicit wait from RDPRM 2 concept

// After key actions
await page.getByRole("button", { name: /Entrer/i }).click();
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(3000);  // Give time for auth processing
```

## Why RDPRM 2 is Not Production-Ready

1. **Display requirement** - Needs physical or virtual display
2. **No horizontal scaling** - Single worker, no locking
3. **Development tool** - Built for testing, not 24/7 operation
4. **No monitoring** - Basic console logs only
5. **No retry logic** - Failures are permanent

## Conclusion

RDPRM 2 is an **excellent reference implementation** but was never designed for production server deployment. The key insight is that **slowMo: 500 is critical** - without it, the Quebec government website can't keep up with automation speed.

The working production solution must:
- Use `headless: true` (server requirement)
- Use `slowMo: 500` (website compatibility)
- Use `domcontentloaded + explicit waits` (server network reality)
- Add proper error handling and retries
- Implement database-level job locking

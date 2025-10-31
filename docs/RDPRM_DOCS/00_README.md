# RDPRM 2 Complete Documentation

This folder contains comprehensive documentation of how RDPRM 2 (the working implementation) operates.

## Documents

1. **01_OVERVIEW.md** - High-level architecture and file structure
2. **02_WORKER.md** - Complete worker implementation details
3. **03_SCRAPER.md** - Browser automation flow, step-by-step
4. **04_DATABASE.md** - Schema, tables, triggers, relationships
5. **05_WAIT_STRATEGIES.md** - All wait strategies and timeouts used
6. **06_EXECUTION_FLOW.md** - Complete timeline from job creation to completion
7. **07_ENVIRONMENT.md** - Required environment variables and configuration
8. **08_CRITICAL_DIFFERENCES.md** - Key differences vs registre-extractor

## Purpose

These documents explain **EXACTLY** how the working RDPRM 2 implementation operates, so we can understand why it works and apply those lessons to registre-extractor.

## Key Findings

The working implementation uses:
- **Local execution** (not server) - `headless: false` works because there's a display
- **Playwright 1.48.0** - Specific version
- **`networkidle` at critical points** - Homepage, login, consultation, search results
- **`slowMo: 500`** - 500ms delays between ALL actions
- **Fresh session each time** - Clears `.pw-session` directory before each run
- **4-layer PDF download fallback** - Ensures high success rate
- **Automatic job creation via database trigger** - No manual job queuing

## Environment Difference

| Aspect | RDPRM 2 (Working) | registre-extractor (Failing) |
|--------|-------------------|------------------------------|
| **Environment** | Local Mac with display | Headless server |
| **headless** | false (requires display) | Must be true (no display) |
| **Wait strategy** | networkidle everywhere | Mixed (causing issues) |
| **slowMo** | 500 (always) | Was 0 in production |
| **Playwright** | 1.48.0 | 1.56.1 |

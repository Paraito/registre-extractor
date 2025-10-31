# Archive Directory

This directory contains files that were removed from the main codebase during the cleanup on **October 31, 2025**.

## Why These Files Were Archived

The registre-extractor system was simplified to use **PM2-only deployment** for better robustness and maintainability on a single droplet server.

## What's Archived

### 1. Docker Configuration (`docker/`)
- **Reason**: PM2 is better suited for single-server deployments (lower overhead, faster deployments, simpler debugging)
- **Critical Bug**: Docker was using legacy worker (`index.js`) instead of unified worker
- **Files**: Dockerfile, docker-compose.yml, .dockerignore, test scripts

### 2. Legacy Worker (`legacy-worker/`)
- **Reason**: Unified worker (`unified-worker.ts`) handles ALL job types (extraction, REQ, RDPRM)
- **Limitation**: Legacy worker (`index.ts`) only handles extraction jobs
- **Status**: Replaced by unified-worker.ts

### 3. Redundant Documentation (`docs/`)
- **Reason**: Multiple overlapping deployment guides caused confusion
- **Action**: Consolidated into single authoritative deployment guide

### 4. Test Files (`test-files/`)
- **Reason**: Old test scripts that are no longer used
- **Note**: Unit tests in `src/**/__tests__/` are kept

### 5. Unused Scripts (`scripts/`)
- **Reason**: Docker-specific deployment scripts no longer needed

## Current Production Setup

**Deployment Method**: PM2  
**Worker**: `dist/worker/unified-worker.js`  
**Configuration**: `ecosystem.config.js`  
**Services**:
- unified-worker (9 workers) - Handles extraction, REQ, RDPRM
- registre-ocr (5 workers) - OCR processing
- registre-monitor (1 worker) - Health monitoring
- registre-api (1 worker) - REST API

## Restoration

If you need to restore any archived files:

```bash
# Restore Docker configuration
cp archive/docker/* .

# Restore legacy worker
cp archive/legacy-worker/index.ts src/worker/

# Restore documentation
cp archive/docs/* docs/
```

## Archive Date

**Created**: October 31, 2025  
**Reason**: Cleanup for robust PM2-only deployment  
**Decision**: Use PM2 for single droplet server deployment


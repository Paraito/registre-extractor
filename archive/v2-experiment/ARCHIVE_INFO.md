# V2 Experiment Archive

**Archive Date:** 2025-10-09  
**Reason:** V2 was a failed experiment. Archiving to preserve history while keeping v1 codebase clean.

## What Was Archived

This archive contains all files related to the "v2" experiment, which included:
1. A v2 worker and API implementation for the registre extractor
2. A complete municipal data extractor v2 system (AI-powered)

### Archived Files

#### Source Code
- `src/worker/worker-v2.ts` - V2 worker implementation
- `src/api/api-v2.ts` - V2 API implementation
- `src/api/dashboard-v2.html` - V2 dashboard UI
- `src/queue/queue-manager-v2.ts` - V2 queue manager
- `src/municipal-extractor-v2/` - Complete municipal extractor v2 system
  - `analysis/` - AI analysis components
  - `api/` - Municipal API endpoints
  - `config/` - V2 configuration
  - `core/` - Core extraction engine
  - `database/` - V2 database client
  - `mcp-clients/` - MCP integration clients
  - `patterns/` - Municipal site patterns
  - `types/` - V2 type definitions
  - `worker/` - AI worker implementation

#### Test & Utility Files
- `create-test-job-v2-acte.ts` - V2 acte job creator
- `create-test-job-v2-index.ts` - V2 index job creator
- `create-test-job-v2-plan.ts` - V2 plan job creator

#### Documentation
- `README-V2.md` - V2 implementation documentation
- `MUNICIPAL_EXTRACTOR_V2_PLAN.md` - Municipal extractor v2 master plan
- `TESTING_MUNICIPAL_V2.md` - V2 testing guide

#### Database
- `supabase/migrations/100_municipal_extractor_v2_schema.sql` - V2 database schema

#### Package.json Scripts (removed)
The following npm scripts were removed from package.json:
- `dev:v2` - Run v2 worker in development
- `start:v2` - Run v2 worker in production
- `api:dev:v2` - Run v2 API in development
- `api:start:v2` - Run v2 API in production
- `municipal:dev` - Run municipal worker in development
- `municipal:api:dev` - Run municipal API in development
- `municipal:start` - Run municipal worker in production
- `municipal:api:start` - Run municipal API in production
- `build:municipal` - Build municipal extractor
- `test:municipal` - Test municipal extractor
- `typecheck:municipal` - Type check municipal extractor

## What Was Kept (V1 Dependencies)

All v1 functionality remains intact and operational:

### Core V1 System
- `src/worker/index.ts` - Main v1 worker
- `src/worker/extractor-ai.ts` - AI-powered extractor (used by v1)
- `src/worker/extractor-index-fallback.ts` - Fallback handler (used by v1)
- `src/worker/extractor-simple.ts` - Simple extractor variant
- `src/worker/stale-job-monitor.ts` - Job monitoring
- `src/api/index.ts` - Main v1 API
- `src/api/dashboard.html` - V1 dashboard
- `src/queue/manager.ts` - Queue manager (used by v1)
- `src/monitor/` - All monitoring services

### Shared Dependencies
- `src/utils/` - All utility modules (logger, supabase, fuzzy-matcher, vision-analyzer, smart-element-finder)
- `src/types/` - All type definitions
- `src/config/` - All configuration

### Infrastructure
- All Dockerfiles and docker-compose.yml
- All non-v2 test files
- All non-v2 job creation utilities

## Verification

V1 system was verified to have NO dependencies on v2 files:
- ✅ V1 worker imports only: extractor-ai, supabase, logger, config, types, queue/manager
- ✅ V1 API imports only: queue/manager, logger, config, supabase
- ✅ Docker production setup uses only v1 entry points
- ✅ No v1 code references municipal-extractor-v2 or any v2-specific files

## Restoration

If you need to restore any v2 files:
1. Copy the desired files from this archive back to their original locations
2. Restore the relevant npm scripts to package.json
3. Run `npm install` if dependencies changed
4. Run `npm run build` to rebuild

## Notes

- The v2 experiment included an ambitious AI-powered municipal data extraction system
- It featured process caching for 90% cost reduction and AI screenshot analysis
- The system was designed to be completely separate from v1
- V2 used a separate database schema and configuration
- The experiment was not completed and v1 remains the production system


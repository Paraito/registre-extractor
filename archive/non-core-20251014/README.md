# Non-Core Components Archive - October 14, 2025

## Archived Components

This directory contains all non-core components removed from the main codebase to simplify the project.

### Contents

#### Documentation
- **`augment_work_docs/`** - All OCR-related documentation and implementation guides
- **`docs/`** - Additional documentation files
- **`COMPLETE_WORKER_SYSTEM.md`** - Worker system documentation

#### Testing & Development
- **`tests/`** - All test files (OCR tests, integration tests, diagnostics)
- **`scripts/`** - Utility scripts and cleanup tools
- **Test files from root**: `test-*.ts`, `create-test-*.ts`, `check-*.ts`, etc.
- **Test files from src**: All test and check utilities

#### Deployment & Infrastructure
- **`deploy-*.sh`** - Deployment scripts
- **`update-deployment.sh`** - Deployment update script
- **`verify-ocr-setup.sh`** - OCR verification script
- **`Dockerfile*`** - Docker configuration files
- **`docker-compose*.yml`** - Docker Compose configurations
- **`systemd/`** - Systemd service files
- **`n8n/`** - n8n workflow automation

#### OCR & Worker Management
- **`src/shared/`** - Shared capacity manager, rate limiter, worker pool manager
- **`src/start-all-workers.ts`** - Unified worker startup (OCR-related)

#### Configuration
- **`ecosystem.config.new.js`** - Alternative PM2 configuration

#### Shell Scripts
- **`run-all-acte-tests.sh`** - Test runner script

### What Remains in Main Codebase

The core registre extractor functionality:
- **`src/worker/`** - Document extraction workers
- **`src/api/`** - API server
- **`src/monitor/`** - Health monitoring
- **`src/queue/`** - Queue management
- **`src/config/`** - Configuration
- **`src/types/`** - TypeScript types
- **`src/utils/`** - Core utilities
- **`ecosystem.config.js`** - Simple PM2 configuration (worker, monitor, API only)
- **`package.json`** - Dependencies
- **`tsconfig.json`** - TypeScript configuration
- **`README.md`** - Main documentation

### Reason for Archival

Simplifying the codebase by removing:
- Complex OCR system and all related code
- Test files and development utilities
- Deployment automation
- Documentation for removed features
- Infrastructure files not needed for core functionality

### Notes

- All `.env` files have been removed from this archive for security
- This archive is for reference only
- The main codebase now focuses solely on document extraction from Quebec registry

---

**Archived**: October 14, 2025
**Reason**: Codebase simplification - removing OCR and non-core components


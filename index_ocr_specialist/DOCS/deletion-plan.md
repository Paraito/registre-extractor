# Deletion Plan - OCR King Repository Cleanup

## Overview
This document lists files and directories to be removed to create a lean, focused repository. Each item includes a rationale for deletion.

**⚠️ SAFETY PROTOCOL**: This is a DRY-RUN plan. No files will be deleted until explicit confirmation with `CONFIRM_DELETE: yes`.

## Root Level Deletions

### Generated Artifacts
- `output_page3_full.txt` - Generated test output, should be in artifacts/
- `PAGE5_COMPLETE_OUTPUT.json` - Generated test output, should be in artifacts/
- `tmp/` - Entire directory with generated PNG files from tests

### Redundant Documentation (Keep Essential, Remove Duplicates)
- `COMPLETION_DETECTION.md` - Merge into main docs, specific to old implementation
- `COUNTING_FIX_SUMMARY.md` - Outdated implementation notes
- `DEVELOPMENT.md` - Redundant with README content
- `EXEMPLE_AVANT_APRES.md` - Example output, move to docs/examples if needed
- `FORMAT_V3_STRING_SUMMARY.md` - Version-specific docs, superseded
- `FULL_EXTRACTION_COMPLETE.md` - Implementation notes, outdated
- `GUIDE_TEST_MAX_TOKENS.md` - Specific testing guide, merge into main docs
- `LOGGING_QUICKSTART.md` - Will be replaced by new logging system
- `PAGE3_DIAGNOSTIC_REPORT.md` - Specific test report, move to test artifacts
- `QUICK_REFERENCE.md` - Redundant with main README
- `QWEN_ARCHITECTURE_CLARIFICATION.md` - Implementation notes, merge into arch docs
- `V3_IMPLEMENTATION_COMPLETE.md` - Version-specific notes, outdated
- `V3_READY_FOR_PRODUCTION.md` - Version-specific notes, outdated
- `V3_TEST_RESULTS.md` - Test results, should be in reports/

### Keep at Root Level
- `README.md` - Main project documentation
- `README_QWEN.md` - Qwen-specific setup (consolidate later)
- `PROMPT_ARCHITECTURE.md` - Core architecture documentation
- `QWEN_SETUP_SUMMARY.md` - Setup instructions (consolidate later)
- `package.json` - Root package file
- `package-lock.json` - Lock file

## Backend Directory Deletions

### Duplicate/Redundant Test Scripts
- `test-5runs.js` - Redundant with test-accuracy-5runs.js
- `test-accuracy-5runs.js` - Specific test, replace with unified E2E test
- `test-backend.js` - Basic API test, keep for now but consolidate later
- `test-count-parser.js` - Specific utility test, not needed
- `test-debug-raw.js` - Debug script, not needed in production
- `test-page3-count.js` - Page-specific test, replace with unified test
- `test-page3-full.js` - Page-specific test, replace with unified test
- `test-page4-3runs.js` - Page-specific test, replace with unified test
- `test-page5-complete.js` - Page-specific test, replace with unified test
- `test-page5-detailed.js` - Page-specific test, replace with unified test
- `test-page5.js` - Page-specific test, replace with unified test
- `test-pdf-split-diagnostic.js` - Diagnostic script, not needed
- `test-save-images.js` - Utility test, not needed
- `test-url.js` - Basic URL test, superseded by test-url-pages.js
- `test-v2-extraction.js` - Version-specific test, superseded
- `test-v3-spatial.js` - Version-specific test, superseded

### Keep Essential Test Scripts (Temporarily)
- `test-multi-model-consensus.js` - Contains multi-model logic to integrate
- `test-url-pages.js` - Most complete test, use as basis for E2E test

### Superseded Prompt Files
- `prompts-v2.js` - Superseded by unified prompt system
- `prompts-v3-spatial.js` - Superseded by unified prompt system
- `prompts_v2_json_BACKUP.js` - Backup file, not needed
- `prompts_v3_string.js` - Superseded version

### Keep Core Prompt Files
- `prompts-unified.js` - Core unified prompt system
- `prompts.js` - Backward compatibility layer
- `prompts-multi-model.js` - Multi-model prompts (integrate into unified)

### Generated Artifacts and Temporary Files
- `tmp/` - Entire directory with generated PNG files and test artifacts
- `output_page3_full.txt` - Generated output file
- `Users/` - Appears to be accidental inclusion

### Redundant Documentation
- `COUNTING_AND_SPLITTING_IMPLEMENTATION.md` - Implementation notes, outdated
- `COUNTING_PROCESS_EXPLAINED.md` - Process docs, merge into main docs
- `COUNTING_QUICK_START.md` - Quick start guide, merge into main docs
- `COUNTING_TROUBLESHOOTING.md` - Troubleshooting, merge into main docs
- `FLOW_DIAGRAM.md` - Flow documentation, update and consolidate
- `IMPROVEMENTS_SUMMARY.md` - Implementation notes, outdated
- `README_LOGGING.md` - Logging docs, will be replaced
- `README_URL_TESTING.md` - Testing docs, consolidate

### Keep Core Backend Files
- `server.js` - Main Gemini server
- `qwen-server.js` - Qwen3-VL server
- `qwen-client.js` - Qwen client implementation
- `package.json` - Backend dependencies
- `package-lock.json` - Lock file
- `docker-compose.qwen.yml` - Docker setup for Qwen
- `process-all-pages.sh` - Batch processing script (evaluate for integration)
- `test-with-log.sh` - Logging wrapper (evaluate for integration)

### Logs Directory
- `logs/` - Keep directory structure, clean old log files
  - Keep recent logs for reference
  - Remove logs older than 30 days

## Summary Statistics

### Files to Delete
- **Root level**: 13 documentation files, 2 generated files, 1 tmp directory
- **Backend level**: 16 test scripts, 4 prompt files, 1 backup file, 1 tmp directory, 8 documentation files, 1 accidental directory

### Total Deletions
- **~45 files** to be removed
- **~2 directories** with generated content
- **Estimated space saved**: 50-100MB (mostly PNG files)

### Files to Keep
- **Core servers**: 2 files (server.js, qwen-server.js)
- **Core clients**: 1 file (qwen-client.js)
- **Core prompts**: 3 files (prompts-unified.js, prompts.js, prompts-multi-model.js)
- **Essential docs**: 4 files (README.md, README_QWEN.md, PROMPT_ARCHITECTURE.md, QWEN_SETUP_SUMMARY.md)
- **Package files**: 4 files (package.json files and lock files)
- **Docker config**: 1 file (docker-compose.qwen.yml)
- **Utility scripts**: 2 files (process-all-pages.sh, test-with-log.sh)
- **Test scripts**: 2 files (test-multi-model-consensus.js, test-url-pages.js)

## Post-Deletion Verification

After deletion, verify:
1. `npm install` works in backend directory
2. `npm start` launches Gemini server successfully
3. `npm run start:qwen` launches Qwen server successfully
4. Essential test scripts still run
5. No broken imports or missing dependencies

## Rationale Summary

**Why these deletions improve the codebase:**
1. **Reduces confusion** - Eliminates duplicate implementations
2. **Improves maintainability** - Single source of truth for each function
3. **Speeds up development** - Less code to navigate and understand
4. **Reduces storage** - Removes generated artifacts and redundant files
5. **Clarifies architecture** - Focuses on essential components only

**Safety measures:**
- Keep all core functionality intact
- Preserve essential documentation
- Maintain backward compatibility where needed
- Test after deletion to ensure nothing breaks

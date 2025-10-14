# OCR System Archive - October 14, 2025

## Archived Components

This directory contains the OCR system that was removed from the main codebase.

### Contents

- **`ocr/`** - Main OCR processing system
  - Generic OCR worker
  - Index OCR processor
  - Acte OCR processor
  - Claude fallback client
  - Gemini client
  - PDF converter
  - Sanitizer
  - Various prompts and utilities

- **`index_ocr_specialist/`** - Specialized index OCR system
  - Parallel processing implementation
  - Qwen model integration
  - Pipeline architecture
  - Worker management

### Reason for Archival

The OCR system was overly complex with:
- Too much capacity management overhead
- Complex worker pool allocation
- Insufficient CPU issues despite low actual usage
- Multiple layers of abstraction
- Difficult to debug and maintain

### What Remains

The core extraction functionality continues to work:
- Document extraction from Quebec registry
- PDF download and storage
- Health monitoring
- API server

### Notes

- All `.env` files have been removed from this archive for security
- This archive is for reference only
- Do not restore without significant simplification

---

**Archived**: October 14, 2025
**Reason**: System complexity and reliability issues


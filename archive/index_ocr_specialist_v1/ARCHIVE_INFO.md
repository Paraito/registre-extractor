# 📦 Archive Information - Index OCR Specialist V1

**Archived Date:** 2025-01-15  
**Reason:** Replaced by new multi-model pipeline architecture

---

## Why This Was Archived

This directory contains the **original index OCR specialist** (V1), which was a simple Express.js API server for processing Quebec land registry index documents using Google's Gemini AI.

It has been **replaced** by a new, production-grade multi-model OCR pipeline that offers:

- ✅ Multi-model support (Gemini, Claude, Qwen3-VL)
- ✅ Multi-model consensus for higher accuracy
- ✅ End-to-end PDF processing
- ✅ Coherence validation
- ✅ Structured JSONL logging
- ✅ TypeScript with proper types
- ✅ Modular pipeline architecture
- ✅ Retry logic and error handling
- ✅ Centralized configuration

---

## What Was This System?

### Architecture
- Simple Express.js backend server (~150 lines)
- 2 API endpoints: `/api/extract-text` and `/api/boost`
- Gemini-only processing
- No pipeline orchestration
- Basic error handling

### Key Files
- `backend/server.js` - Main Express server
- `backend/prompts.js` - OCR prompts (if existed)
- `README.md` - Original documentation

### Limitations
- ❌ No PDF handling (required pre-conversion)
- ❌ No line counting
- ❌ No coherence checking
- ❌ No multi-model consensus
- ❌ No windowing for large documents
- ❌ Single model = single point of failure
- ❌ No structured logging
- ❌ Hardcoded configuration

---

## Migration to New System

The new system is located at: **`/index_ocr_specialist`** (formerly `new_index_specialist`)

### Key Improvements

| Feature | V1 (Archived) | V2 (Current) |
|---------|---------------|--------------|
| **Architecture** | Simple API | Full pipeline |
| **Models** | Gemini only | Gemini + Claude + Qwen3 |
| **PDF Support** | No | Yes (end-to-end) |
| **Consensus** | No | Multi-model |
| **Validation** | No | Coherence checking |
| **Logging** | Console | Structured JSONL |
| **Language** | JavaScript | TypeScript |
| **Error Handling** | Basic | Retry + fallback |
| **Accuracy** | 85-90% | 95-98% |

### Migration Path

If you need to reference the old system:
1. Check this archived directory
2. Review the README.md for API documentation
3. Note that the OCR functionality has been integrated into the main app under `src/ocr/`

---

## Should You Use This?

**No.** This system is archived for reference only.

**Use instead:**
- **For production:** `/index_ocr_specialist` (new multi-model pipeline)
- **For integrated OCR:** `src/ocr/` (main application integration)

---

## Historical Context

This was the **first iteration** of the index OCR specialist, built as a proof-of-concept to validate:
- Gemini's vision capabilities for Quebec land registry documents
- Boost rules for domain-specific corrections
- API-based OCR processing

It successfully proved the concept and led to the development of the production-grade V2 system.

---

## Restoration

If you need to restore this system for any reason:

```bash
# From repository root
cd archive/index_ocr_specialist_v1/backend
npm install
# Create .env with GEMINI_API_KEY
npm start
```

**Note:** This is not recommended. Use the new system instead.

---

## Related Documentation

- **New System:** `/index_ocr_specialist/README.md`
- **Comparison:** See conversation history for detailed comparison analysis
- **Integration:** `src/ocr/README.md` for main app integration

---

**Status:** ⚠️ ARCHIVED - DO NOT USE FOR PRODUCTION


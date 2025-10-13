# Claude OCR Fallback Implementation Summary

## Overview

Implemented automatic fallback from Gemini to Claude for OCR processing. The system now supports both providers and automatically switches when one fails.

## Key Features

✅ **Automatic Fallback**: Tries Gemini first, falls back to Claude on failure  
✅ **Bidirectional Support**: Can prefer either Gemini or Claude  
✅ **Image-Based Processing**: Both providers use images (PDFs converted automatically)  
✅ **Unified Interface**: Single processor handles both providers  
✅ **Backward Compatible**: Works with Gemini-only if Claude key not provided  
✅ **Best Models**: Uses Claude Sonnet 4.5 (latest as of Oct 2025)  

## Files Created

### 1. `src/ocr/claude-ocr-client.ts`
- Claude API client for vision-based OCR
- Supports image extraction and boost operations
- Uses Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Retry logic with exponential backoff
- Detailed logging for debugging

### 2. `src/ocr/unified-ocr-processor.ts`
- Orchestrates OCR with automatic fallback
- Converts PDFs to images (required by both providers)
- Tries preferred provider first
- Falls back to alternative on failure
- Merges results from multiple pages
- Applies boost with same fallback logic

### 3. `docs/CLAUDE_FALLBACK.md`
- Complete documentation of the fallback system
- Architecture diagrams
- Configuration guide
- Migration instructions
- Troubleshooting tips

### 4. `test-claude-fallback.ts`
- Test suite for Claude integration
- Validates configuration
- Tests Claude API connectivity
- Verifies unified processor setup
- Provides detailed test results

## Files Modified

### 1. `.env`
**Added:**
- `CLAUDE_API_KEY` - Claude API key
- `OCR_PREFERRED_PROVIDER` - Which provider to try first (gemini/claude)
- `OCR_EXTRACT_MODEL_GEMINI` - Gemini extraction model
- `OCR_EXTRACT_MODEL_CLAUDE` - Claude extraction model (claude-sonnet-4-5-20250929)
- `OCR_BOOST_MODEL_GEMINI` - Gemini boost model
- `OCR_BOOST_MODEL_CLAUDE` - Claude boost model (claude-sonnet-4-5-20250929)

**Changed:**
- Temperature defaults from 0.1/0.2 to 0.0 (deterministic output)

### 2. `src/config/index.ts`
**Updated schema:**
- Added `CLAUDE_API_KEY` validation
- Added `OCR_PREFERRED_PROVIDER` enum
- Split model configs into provider-specific objects
- Updated OCR config structure to support both providers

### 3. `src/ocr/monitor.ts`
**Major changes:**
- Added `UnifiedOCRProcessor` support
- Updated `OCRMonitorConfig` interface
- Added provider selection logic
- Updated initialization to use unified processor when Claude key is available
- Falls back to legacy processors if Claude key not provided
- Updated document processing to use unified processor
- Added detailed logging for provider selection

### 4. `package.json`
**Added:**
- `@anthropic-ai/sdk` dependency (v0.x.x)
- `test:claude-fallback` script

## Configuration Changes

### Before (Gemini Only)
```bash
GEMINI_API_KEY=xxx
OCR_EXTRACT_MODEL=gemini-2.0-flash-exp
OCR_BOOST_MODEL=gemini-2.5-pro
OCR_EXTRACT_TEMPERATURE=0.1
OCR_BOOST_TEMPERATURE=0.2
```

### After (With Fallback)
```bash
GEMINI_API_KEY=xxx
CLAUDE_API_KEY=xxx
OCR_PREFERRED_PROVIDER=gemini
OCR_EXTRACT_MODEL_GEMINI=gemini-2.0-flash-exp
OCR_EXTRACT_MODEL_CLAUDE=claude-sonnet-4-5-20250929
OCR_BOOST_MODEL_GEMINI=gemini-2.5-pro
OCR_BOOST_MODEL_CLAUDE=claude-sonnet-4-5-20250929
OCR_EXTRACT_TEMPERATURE=0.0
OCR_BOOST_TEMPERATURE=0.0
```

## How It Works

### 1. PDF Processing Flow

```
1. PDF Document arrives
2. Convert PDF to images (required for both Gemini and Claude)
3. Try extraction with preferred provider (e.g., Gemini)
   ├─ Success → Continue to step 4
   └─ Failure → Fallback to Claude, retry extraction
4. Merge results from all pages
5. Try boost with same provider used for extraction
   ├─ Success → Complete
   └─ Failure → Fallback to alternative provider
6. Return final OCR result
```

### 2. Fallback Triggers

The system automatically falls back when:
- API rate limits are exceeded
- Network errors occur
- Provider returns errors
- Extraction/boost operations fail
- Timeouts occur

### 3. Provider Selection

**Gemini (Default Preferred)**
- Faster response times
- Lower cost
- Good for structured documents
- May have stricter rate limits

**Claude (Fallback)**
- Exceptional vision capabilities
- Better for complex layouts
- More reliable for edge cases
- Higher cost
- Slightly slower

## Testing

### Run the test suite:
```bash
npm run test:claude-fallback
```

### Expected output:
```
╔══════════════════════════════════════════════════════════════════════════════╗
║                    CLAUDE OCR FALLBACK TEST SUITE                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

================================================================================
TEST 1: Configuration Validation
================================================================================
✅ Gemini API Key          [REQUIRED] = AIzaSy...
✅ Claude API Key          [OPTIONAL] = sk-ant...
✅ Preferred Provider      [REQUIRED] = gemini
...

================================================================================
TEST SUMMARY
================================================================================
Configuration:       ✅ PASS
Claude Client:       ✅ PASS
Unified Processor:   ✅ PASS

================================================================================
✅ ALL TESTS PASSED

🔄 Automatic fallback is ENABLED
   Preferred provider: GEMINI
   Fallback provider: CLAUDE
================================================================================
```

## Migration Steps

### For Existing Deployments

1. **Add Claude API Key** to `.env`:
   ```bash
   CLAUDE_API_KEY=your-claude-api-key-here
   ```

2. **Update Environment Variables**:
   ```bash
   # Rename existing variables
   OCR_EXTRACT_MODEL → OCR_EXTRACT_MODEL_GEMINI
   OCR_BOOST_MODEL → OCR_BOOST_MODEL_GEMINI
   
   # Add new variables
   OCR_EXTRACT_MODEL_CLAUDE=claude-sonnet-4-5-20250929
   OCR_BOOST_MODEL_CLAUDE=claude-sonnet-4-5-20250929
   OCR_PREFERRED_PROVIDER=gemini
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Test Configuration**:
   ```bash
   npm run test:claude-fallback
   ```

5. **Restart OCR Workers**:
   ```bash
   npm run ocr:dev
   ```

### Backward Compatibility

✅ **No breaking changes**  
✅ Works with Gemini-only if `CLAUDE_API_KEY` not set  
✅ Legacy processors still available  
✅ Existing documents continue processing normally  

## Monitoring

### Check which provider is being used:
```bash
# View provider usage
grep "OCR complete using" logs/ocr.log | sort | uniq -c

# View fallback events
grep "falling back" logs/ocr.log

# View provider selection
grep "Attempting extraction with" logs/ocr.log
```

### Expected log output:
```
🔵 Attempting extraction with Gemini (preferred)
✅ OCR complete using GEMINI
```

### Fallback log output:
```
🔵 Attempting extraction with Gemini (preferred)
⚠️  Gemini extraction failed, falling back to Claude
🟣 Falling back to Claude for extraction
✅ OCR complete using CLAUDE
```

## Cost Considerations

### Gemini (Preferred)
- Lower cost per request
- Faster processing
- Good for high-volume processing

### Claude (Fallback)
- Higher cost per request
- Better quality for complex documents
- Use as safety net

### Optimization Tips
1. Keep Gemini as preferred provider for cost efficiency
2. Monitor fallback frequency
3. If Claude is used frequently, investigate Gemini issues
4. Consider switching preferred provider based on document type

## Next Steps

1. **Add Claude API Key** to production environment
2. **Run test suite** to verify configuration
3. **Monitor logs** for fallback events
4. **Track costs** per provider
5. **Optimize provider selection** based on document types

## Support

- **Documentation**: `docs/CLAUDE_FALLBACK.md`
- **Test Suite**: `npm run test:claude-fallback`
- **Logs**: Check `logs/ocr.log` for detailed information
- **Provider Status**:
  - Anthropic: https://status.anthropic.com/
  - Google AI: https://status.cloud.google.com/

## Summary

✅ **Implemented**: Automatic Gemini → Claude fallback  
✅ **Tested**: Configuration and API connectivity  
✅ **Documented**: Complete guide and migration steps  
✅ **Backward Compatible**: Works with existing setup  
✅ **Production Ready**: Can be deployed immediately  

The system is now more resilient and can handle provider failures gracefully!


# Claude OCR Fallback System

## Overview

The OCR system now supports **automatic fallback from Gemini to Claude** for both extraction and boost operations. This provides redundancy and ensures OCR processing continues even if one provider fails.

## Architecture

### Unified OCR Processor

The `UnifiedOCRProcessor` class orchestrates OCR processing with automatic fallback:

1. **PDF to Images Conversion**: Both Gemini and Claude require images (not PDFs), so all documents are converted to images first
2. **Extraction with Fallback**: Tries preferred provider first, falls back to alternative on failure
3. **Boost with Fallback**: Applies corrections using the same provider as extraction, with fallback support
4. **Result Merging**: Combines results from all pages into a single output

### Flow Diagram

```
PDF Document
    ↓
Convert to Images (required for both providers)
    ↓
Try Extraction (Preferred Provider: Gemini or Claude)
    ↓
    ├─ Success → Continue
    └─ Failure → Fallback to Alternative Provider
         ↓
    Merge Page Results
         ↓
    Try Boost (Same Provider as Extraction)
         ↓
         ├─ Success → Complete
         └─ Failure → Fallback to Alternative Provider
              ↓
         Return Final Result
```

## Models Used (October 2025)

### Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- **Best for**: Vision tasks, complex reasoning, coding
- **Used for**: Both extraction and boost
- **Context**: 200K tokens (1M beta available)
- **Max Output**: 64,000 tokens
- **Knowledge Cutoff**: January 2025

### Gemini Models
- **Extraction**: `gemini-2.0-flash-exp` (fast, efficient)
- **Boost**: `gemini-2.5-pro` (high quality corrections)

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Claude API Configuration
CLAUDE_API_KEY=your-claude-api-key-here

# OCR Provider Configuration
OCR_PREFERRED_PROVIDER=gemini  # or 'claude'

# Model Configuration
OCR_EXTRACT_MODEL_GEMINI=gemini-2.0-flash-exp
OCR_EXTRACT_MODEL_CLAUDE=claude-sonnet-4-5-20250929
OCR_BOOST_MODEL_GEMINI=gemini-2.5-pro
OCR_BOOST_MODEL_CLAUDE=claude-sonnet-4-5-20250929

# Temperature Settings (0.0 for deterministic output)
OCR_EXTRACT_TEMPERATURE=0.0
OCR_BOOST_TEMPERATURE=0.0
```

### Config Structure

The config now supports provider-specific models:

```typescript
{
  ocr: {
    geminiApiKey: string;
    claudeApiKey?: string;
    preferredProvider: 'gemini' | 'claude';
    extractModel: {
      gemini: string;
      claude: string;
    };
    boostModel: {
      gemini: string;
      claude: string;
    };
    extractTemperature: number;
    boostTemperature: number;
  }
}
```

## Usage

### Automatic Fallback (Recommended)

The system automatically falls back when:
- API rate limits are hit
- Network errors occur
- Provider-specific errors happen
- Extraction or boost fails for any reason

No code changes needed - just configure both API keys.

### Manual Provider Selection

Set `OCR_PREFERRED_PROVIDER` to choose which provider to try first:

```bash
# Try Gemini first (default)
OCR_PREFERRED_PROVIDER=gemini

# Try Claude first
OCR_PREFERRED_PROVIDER=claude
```

## Logging

The system provides detailed logging for fallback operations:

```
🔵 Attempting extraction with Gemini (preferred)
⚠️  Gemini extraction failed, falling back to Claude
🟣 Falling back to Claude for extraction
✅ OCR complete using CLAUDE
```

### Log Levels

- **INFO**: Provider selection, completion status
- **WARNING**: Fallback events, provider failures
- **DEBUG**: Detailed API calls, response sizes, timing

## Benefits

1. **Redundancy**: If one provider fails, the other takes over
2. **Cost Optimization**: Use cheaper provider first, fallback to premium
3. **Rate Limit Handling**: Automatically switch when limits are hit
4. **Quality Assurance**: Can compare results between providers
5. **Zero Downtime**: OCR continues even if one provider is down

## Performance Considerations

### Gemini (Preferred Default)
- ✅ Faster response times
- ✅ Lower cost per request
- ✅ Good quality for structured documents
- ⚠️ May have stricter rate limits

### Claude (Fallback)
- ✅ Exceptional vision capabilities
- ✅ Better at complex layouts
- ✅ More reliable for edge cases
- ⚠️ Higher cost per request
- ⚠️ Slightly slower response times

## Migration Guide

### From Gemini-Only to Unified System

1. **Add Claude API Key**:
   ```bash
   CLAUDE_API_KEY=your-key-here
   ```

2. **Update Environment Variables**:
   - Rename `OCR_EXTRACT_MODEL` → `OCR_EXTRACT_MODEL_GEMINI`
   - Rename `OCR_BOOST_MODEL` → `OCR_BOOST_MODEL_GEMINI`
   - Add `OCR_EXTRACT_MODEL_CLAUDE=claude-sonnet-4-5-20250929`
   - Add `OCR_BOOST_MODEL_CLAUDE=claude-sonnet-4-5-20250929`

3. **Set Preferred Provider** (optional):
   ```bash
   OCR_PREFERRED_PROVIDER=gemini
   ```

4. **Restart OCR Workers**:
   ```bash
   npm run ocr:dev
   ```

### Backward Compatibility

If `CLAUDE_API_KEY` is not set, the system automatically uses legacy Gemini-only processors. No breaking changes.

## Troubleshooting

### Both Providers Failing

If both Gemini and Claude fail:
1. Check API keys are valid
2. Verify network connectivity
3. Check rate limits on both providers
4. Review error logs for specific issues

### Unexpected Provider Usage

Check logs for fallback events:
```bash
grep "falling back" logs/ocr.log
```

### Cost Concerns

Monitor which provider is being used:
```bash
grep "OCR complete using" logs/ocr.log | sort | uniq -c
```

## Future Enhancements

- [ ] Provider health monitoring
- [ ] Automatic provider selection based on document type
- [ ] Cost tracking per provider
- [ ] Quality comparison metrics
- [ ] A/B testing framework

## Related Files

- `src/ocr/claude-ocr-client.ts` - Claude API client
- `src/ocr/unified-ocr-processor.ts` - Unified processor with fallback
- `src/ocr/monitor.ts` - OCR monitor integration
- `src/config/index.ts` - Configuration schema
- `.env` - Environment variables

## Support

For issues or questions:
1. Check logs in `logs/ocr.log`
2. Review this documentation
3. Check provider status pages:
   - [Anthropic Status](https://status.anthropic.com/)
   - [Google AI Status](https://status.cloud.google.com/)


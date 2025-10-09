# 🔄 Completion Detection & Auto-Retry System

## 🎯 Problem Solved

When processing large land registry documents, the Gemini API may truncate responses due to token limits. This system ensures complete extraction by:

1. **Detecting incomplete responses**
2. **Automatically retrying** with higher token limits
3. **Warning users** if completion cannot be achieved

## ✨ How It Works

### Completion Markers

The system requires Gemini to end responses with specific markers:

**For Extraction:**
```
✅ EXTRACTION_COMPLETE: [X] lignes traitées sur [X] lignes visibles.
```

**For Boost:**
```
✅ BOOST_COMPLETE: [X] lignes traitées, [Y] corrections appliquées.
```

### Auto-Retry Logic

```
┌─────────────────┐
│  Send Request   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Check Response  │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Has     │
    │ Marker? │
    └────┬────┘
         │
    ┌────┴────┐
    │   Yes   │   No
    │         │
    ▼         ▼
┌────────┐  ┌──────────┐
│ Done ✓ │  │ Retry    │
└────────┘  │ (max 3x) │
            └──────────┘
```

## 🔧 Implementation Details

### Frontend Changes

**1. Updated Prompts** (`App.jsx`)
- Added completion marker requirements to `EXTRACT_PROMPT`
- Added completion marker requirements to `BOOST_PROMPT`

**2. Retry Logic** (`extractText` and `boostText` functions)
```javascript
let attemptCount = 0;
const maxAttempts = 3;

while (!isComplete && attemptCount < maxAttempts) {
  attemptCount++;
  
  // Make API call
  const response = await fetch(...);
  
  // Check for completion marker
  if (data.text.includes('✅ EXTRACTION_COMPLETE:')) {
    isComplete = true;
  } else {
    // Retry with warning
    setError(`⚠️ Response truncated (attempt ${attemptCount}/${maxAttempts})`);
  }
}
```

### Backend Changes

**1. Dynamic Token Limits** (`server.js`)
```javascript
// Determine max tokens based on model
let maxTokens = 8192;  // Flash models
if (model.includes('pro')) {
  maxTokens = 32768;   // Pro models
}
```

**2. Continuation Support**
- Accepts `previousText` parameter
- Adds continuation instruction if retrying

## 📊 Token Limits by Model

| Model | Max Output Tokens |
|-------|-------------------|
| gemini-2.0-flash-exp | 8,192 |
| gemini-1.5-flash | 8,192 |
| gemini-1.5-flash-8b | 8,192 |
| gemini-1.5-pro | 32,768 |
| gemini-2.5-flash | 8,192 |
| gemini-2.5-pro | 32,768 |

## 🎯 Best Practices

### For Large Documents

1. **Use Pro Models**
   - Select `gemini-1.5-pro` or `gemini-2.5-pro`
   - 4x more output tokens (32,768 vs 8,192)

2. **Enable Image Upscaling**
   - Better OCR accuracy
   - May reduce need for retries

3. **Monitor Warnings**
   - Watch for truncation warnings
   - Consider splitting very large documents

### For Maximum Reliability

```javascript
// Recommended settings for large documents:
Model: gemini-1.5-pro
Upscaling: Enabled (2x)
Extract Temperature: 0.1
Boost Temperature: 0.2
```

## 🔍 Detecting Incomplete Responses

### Visual Indicators

**Complete Response:**
```
✅ EXTRACTION_COMPLETE: 45 lignes traitées sur 45 lignes visibles.
```
- No error message
- Completion marker present
- All lines extracted

**Incomplete Response:**
```
⚠️ Response truncated (attempt 1/3). Retrying with higher token limit...
```
- Yellow warning message
- System automatically retrying
- May succeed on retry

**Failed After Retries:**
```
⚠️ Extraction may be incomplete after 3 attempts. Consider using a Pro model or splitting the image.
```
- Red error message
- Max retries reached
- Action required from user

## 🛠️ Troubleshooting

### Issue: Constant Truncation

**Solutions:**
1. Switch to a Pro model (gemini-1.5-pro or gemini-2.5-pro)
2. Split the document into smaller sections
3. Reduce image size (fewer lines per image)

### Issue: Retries Not Working

**Check:**
1. Backend is updated with new code
2. Frontend is updated with new code
3. Both servers restarted after changes
4. Browser cache cleared (Ctrl+Shift+R)

### Issue: False Positives

If the system thinks it's complete but data is missing:

1. Check the completion marker in the response
2. Verify the line count matches expected
3. Review the raw output for truncation
4. Try a different model

## 📈 Performance Impact

### Retry Overhead

- **First attempt**: Normal processing time
- **Retry 1**: +100% time (2x total)
- **Retry 2**: +150% time (3x total)
- **Retry 3**: +200% time (4x total)

### Optimization Tips

1. **Use appropriate model for document size**
   - Small docs (< 20 lines): Flash models
   - Medium docs (20-50 lines): Flash models
   - Large docs (50+ lines): Pro models

2. **Monitor completion rates**
   - If > 50% need retries → switch to Pro model
   - If < 10% need retries → Flash model is fine

## 🔐 Error Handling

### Network Errors
```javascript
try {
  // API call
} catch (err) {
  setError(err.message || 'Failed to extract text');
}
```

### API Errors
```javascript
if (data.error) {
  throw new Error(data.error);
}
```

### Timeout Handling
- Default: 3 retries
- Each retry: Full API call
- Total max time: ~3-5 minutes for large docs

## 📝 Code Examples

### Check Completion Status

```javascript
// In your component
const isComplete = rawResult.includes('✅ EXTRACTION_COMPLETE:');

if (isComplete) {
  console.log('✓ Extraction complete');
} else {
  console.warn('⚠ Extraction may be incomplete');
}
```

### Extract Line Count

```javascript
const match = rawResult.match(/✅ EXTRACTION_COMPLETE: (\d+) lignes/);
if (match) {
  const lineCount = parseInt(match[1]);
  console.log(`Extracted ${lineCount} lines`);
}
```

### Manual Retry

If automatic retry fails, you can manually retry by:
1. Switching to a Pro model
2. Clicking "Extract Text" again
3. The system will attempt extraction with higher token limit

## 🎓 Understanding the Flow

### Successful Extraction (No Retry)
```
User uploads image
    ↓
Extract Text clicked
    ↓
API call (attempt 1)
    ↓
Response includes ✅ EXTRACTION_COMPLETE
    ↓
Display results
    ↓
Done ✓
```

### Extraction with Retry
```
User uploads image
    ↓
Extract Text clicked
    ↓
API call (attempt 1)
    ↓
Response truncated (no marker)
    ↓
Show warning: "⚠️ Response truncated (attempt 1/3)"
    ↓
API call (attempt 2)
    ↓
Response includes ✅ EXTRACTION_COMPLETE
    ↓
Clear warning
    ↓
Display results
    ↓
Done ✓
```

### Failed Extraction (Max Retries)
```
User uploads image
    ↓
Extract Text clicked
    ↓
API call (attempt 1) → Truncated
    ↓
API call (attempt 2) → Truncated
    ↓
API call (attempt 3) → Truncated
    ↓
Show error: "⚠️ Extraction may be incomplete after 3 attempts"
    ↓
Display partial results
    ↓
User action required (switch model or split document)
```

## 🚀 Future Enhancements

Potential improvements:

1. **Adaptive Token Limits**
   - Start with low tokens
   - Increase on each retry

2. **Chunked Processing**
   - Split large documents automatically
   - Process in parallel
   - Merge results

3. **Progress Indicators**
   - Show retry count
   - Estimated time remaining
   - Lines processed so far

4. **Smart Model Selection**
   - Auto-detect document size
   - Suggest appropriate model
   - Warn before processing large docs

---

**Note**: This system significantly improves reliability for large documents while maintaining fast processing for smaller ones.


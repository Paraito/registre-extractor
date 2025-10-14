# OCR Logging Guide

## Overview

The OCR logging uses a **structured, formatted output** similar to MCP server logs, with clear sections, separators, and organized information. Each major operation is presented in a clean, scannable format with emoji indicators and detailed breakdowns.

## Features

- ✅ **Structured sections** with clear separators
- ✅ **Message numbering** for tracking operations
- ✅ **Emoji indicators** for quick visual scanning
- ✅ **Detailed breakdowns** of each processing stage
- ✅ **Performance metrics** (duration, character counts)
- ✅ **Progress tracking** for multi-page documents

## What You'll See

### 1. Monitor Startup
```
================================================================================
🚀 OCR Monitor Started - Message #1
================================================================================

⚙️  Configuration
   Enabled Environments: staging, prod
   Poll Interval: 10s

================================================================================
```

### 2. Document Processing Start
```
================================================================================
📄 OCR Processing Started - Message #2
================================================================================

📋 Document Details
   Document Number: 1425100
   Environment: staging
   Document ID: 71194ba7-...
   Status: Downloading PDF...

================================================================================
```

### 3. PDF Conversion
```
--------------------------------------------------------------------------------
📸 PDF Conversion Complete
--------------------------------------------------------------------------------
   Total Pages: 3
   File Size: 157 KB
   Status: Extracting text from 3 page(s)...
--------------------------------------------------------------------------------
```

### 4. Page Extraction Progress
```
   [1/3] Page 1 extracted → 4,231 chars
   [2/3] Page 2 extracted → 4,156 chars
   [3/3] Page 3 extracted → 4,156 chars
```

### 5. Extraction Complete
```
--------------------------------------------------------------------------------
📝 Text Extraction Complete
--------------------------------------------------------------------------------
   Pages Processed: 3
   Total Characters: 12,543
   Status: Applying boost corrections...
--------------------------------------------------------------------------------
```

### 6. Boost Complete
```
--------------------------------------------------------------------------------
✨ Boost Corrections Applied
--------------------------------------------------------------------------------
   Output Characters: 12,789
   Processing Time: 8.3s
--------------------------------------------------------------------------------
```

### 7. Document Complete
```
================================================================================
✅ OCR Processing Complete - Message #3
================================================================================

📊 Processing Summary
   Document Number: 1425100
   Environment: staging
   Total Pages: 3
   Raw Text: 12,543 chars
   Boosted Text: 12,789 chars
   Total Duration: 15.7s
   Status: ✅ Saved to database

================================================================================
```

### 8. Errors
```
================================================================================
❌ OCR Processing Failed - Message #4
================================================================================

📋 Document Details
   Document Number: 1425100
   Environment: staging
   Document ID: 71194ba7-...

⚠️  Error Details
   Error: Failed to download PDF from bucket
   Status: ❌ Failed (will retry on next poll)

================================================================================
```

### 9. Warnings
```
--------------------------------------------------------------------------------
⚠️  Warning: boosted_file_content column not found
--------------------------------------------------------------------------------
   Migration: 004 not applied
   Action: Saving only file_content
--------------------------------------------------------------------------------
```

## Example Terminal Output

### Complete Processing Flow

```
================================================================================
🚀 OCR Monitor Started - Message #1
================================================================================

⚙️  Configuration
   Enabled Environments: staging, prod
   Poll Interval: 10s

================================================================================

================================================================================
📄 OCR Processing Started - Message #2
================================================================================

📋 Document Details
   Document Number: 1425100
   Environment: staging
   Document ID: 71194ba7-a2b3-4c5d-8e9f-0123456789ab
   Status: Downloading PDF...

================================================================================

--------------------------------------------------------------------------------
📸 PDF Conversion Complete
--------------------------------------------------------------------------------
   Total Pages: 3
   File Size: 157 KB
   Status: Extracting text from 3 page(s)...
--------------------------------------------------------------------------------

   [1/3] Page 1 extracted → 4,231 chars
   [2/3] Page 2 extracted → 4,156 chars
   [3/3] Page 3 extracted → 4,156 chars

--------------------------------------------------------------------------------
📝 Text Extraction Complete
--------------------------------------------------------------------------------
   Pages Processed: 3
   Total Characters: 12,543
   Status: Applying boost corrections...
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
✨ Boost Corrections Applied
--------------------------------------------------------------------------------
   Output Characters: 12,789
   Processing Time: 8.3s
--------------------------------------------------------------------------------

================================================================================
✅ OCR Processing Complete - Message #3
================================================================================

📊 Processing Summary
   Document Number: 1425100
   Environment: staging
   Total Pages: 3
   Raw Text: 12,543 chars
   Boosted Text: 12,789 chars
   Total Duration: 15.7s
   Status: ✅ Saved to database

================================================================================

================================================================================
📄 OCR Processing Started - Message #4
================================================================================

📋 Document Details
   Document Number: 1425101
   Environment: staging
   Document ID: 82305cb8-b3c4-5d6e-9f0a-1234567890bc
   Status: Downloading PDF...

================================================================================

... (continues for next document)
```

## Key Information Displayed

### Document Processing Summary
- **Document Number**: Unique identifier for the document
- **Environment**: Which Supabase environment (dev/staging/prod)
- **Document ID**: Full UUID for tracking
- **Total Pages**: Number of pages in the PDF
- **Raw Text**: Character count of extracted text
- **Boosted Text**: Character count after corrections
- **Processing Time**: Duration for boost operation
- **Total Duration**: End-to-end processing time

### Progress Indicators
- **Message Counter**: Sequential numbering for tracking operations
- **Page Progress**: `[1/3]`, `[2/3]`, `[3/3]` format
- **Status Updates**: Current operation being performed
- **Character Counts**: Text length at each stage

## Visual Elements

### Separators
- **Main Separator** (`=` × 80): Major sections (start/complete/error)
- **Sub Separator** (`-` × 80): Processing stages (conversion/extraction/boost)

### Emoji Indicators
- 🚀 **Monitor Started**
- 📄 **Processing Started**
- 📸 **PDF Conversion**
- 📝 **Text Extraction**
- ✨ **Boost Applied**
- ✅ **Success**
- ❌ **Error**
- ⚠️  **Warning**
- 📊 **Summary**
- 📋 **Details**
- ⚙️  **Configuration**

## Advantages of This Format

### 1. **Easy to Scan**
- Clear visual hierarchy with separators
- Emoji indicators for quick identification
- Consistent formatting across all messages

### 2. **Complete Information**
- All relevant details in one place
- No need to correlate multiple log lines
- Message numbering for tracking flow

### 3. **Professional Appearance**
- Similar to MCP server logs
- Clean, structured output
- Easy to screenshot and share

### 4. **Progress Tracking**
- Real-time page extraction progress
- Clear status updates at each stage
- Duration metrics for performance monitoring

### 5. **Error Clarity**
- Errors are prominently displayed
- Full context included in error messages
- Clear indication of retry status

## Implementation Details

### Files Modified

1. **`src/ocr/ocr-logger.ts`** (NEW)
   - Custom structured logger for OCR operations
   - Handles all formatted output
   - Message counter for tracking

2. **`src/ocr/processor.ts`**
   - Uses OCRLogger for structured output
   - Reports page extraction progress
   - Shows conversion and boost stages

3. **`src/ocr/monitor.ts`**
   - Uses OCRLogger for document lifecycle
   - Tracks total processing duration
   - Structured error reporting

4. **`src/ocr/gemini-client.ts`**
   - Uses OCRLogger for retry attempts
   - Cleaner warning messages

### Usage

The structured logger is automatically used by the OCR system. No configuration needed - just run the OCR monitor and enjoy the clean output!

```bash
# Start the OCR monitor
tsx src/ocr/monitor.ts
```


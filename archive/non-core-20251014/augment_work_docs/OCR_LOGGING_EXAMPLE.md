# OCR Logging - Visual Example

## Complete Processing Flow

This is what you'll see in your terminal when the OCR monitor processes a document:

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

--------------------------------------------------------------------------------
📸 PDF Conversion Complete
--------------------------------------------------------------------------------
   Total Pages: 1
   File Size: 89 KB
   Status: Extracting text from 1 page(s)...
--------------------------------------------------------------------------------

   [1/1] Page 1 extracted → 4,102 chars

--------------------------------------------------------------------------------
📝 Text Extraction Complete
--------------------------------------------------------------------------------
   Pages Processed: 1
   Total Characters: 4,102
   Status: Applying boost corrections...
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
✨ Boost Corrections Applied
--------------------------------------------------------------------------------
   Output Characters: 4,456
   Processing Time: 3.2s
--------------------------------------------------------------------------------

================================================================================
✅ OCR Processing Complete - Message #5
================================================================================

📊 Processing Summary
   Document Number: 1425101
   Environment: staging
   Total Pages: 1
   Raw Text: 4,102 chars
   Boosted Text: 4,456 chars
   Total Duration: 7.8s
   Status: ✅ Saved to database

================================================================================
```

## Error Example

When an error occurs:

```
================================================================================
📄 OCR Processing Started - Message #6
================================================================================

📋 Document Details
   Document Number: 1425102
   Environment: staging
   Document ID: 93416dc9-c4d5-6e7f-0a1b-2345678901cd
   Status: Downloading PDF...

================================================================================

================================================================================
❌ OCR Processing Failed - Message #7
================================================================================

📋 Document Details
   Document Number: 1425102
   Environment: staging
   Document ID: 93416dc9-c4d5-6e7f-0a1b-2345678901cd

⚠️  Error Details
   Error: Failed to download PDF from bucket: File not found
   Status: ❌ Failed (will retry on next poll)

================================================================================
```

## Warning Example

When a warning occurs (e.g., missing database column):

```
--------------------------------------------------------------------------------
⚠️  Warning: boosted_file_content column not found
--------------------------------------------------------------------------------
   Migration: 004 not applied
   Action: Saving only file_content
--------------------------------------------------------------------------------
```

## Retry Example

When extraction or boost needs to retry:

```
   [1/3] Page 1 extracted → 4,231 chars
   ⚠️  Extraction truncated, retrying (1/3)...
   [2/3] Page 2 extracted → 4,156 chars
   [3/3] Page 3 extracted → 4,156 chars
```

## Key Features

### 1. **Message Numbering**
Each major operation gets a sequential message number for easy tracking:
- Message #1: Monitor started
- Message #2: Document processing started
- Message #3: Document processing complete
- Message #4: Next document started
- etc.

### 2. **Clear Separators**
- `=` (80 chars): Major sections (start, complete, error)
- `-` (80 chars): Processing stages (conversion, extraction, boost)

### 3. **Progress Tracking**
- Page extraction shows `[1/3]`, `[2/3]`, `[3/3]` format
- Character counts at each stage
- Duration metrics for performance

### 4. **Status Updates**
Each section shows what's happening next:
- "Downloading PDF..."
- "Extracting text from 3 page(s)..."
- "Applying boost corrections..."
- "✅ Saved to database"

### 5. **Complete Context**
Every message includes all relevant information:
- Document number
- Environment
- Document ID
- Page counts
- Character counts
- Processing times

## Comparison

### Before (JSON-heavy logs)
```
[12:35:01] INFO: Starting OCR processing for document
    documentId: "71194ba7-..."
    documentNumber: "1425100"
    supabasePath: "index/..."
    environment: "staging"
[12:35:02] INFO: Downloading PDF from private bucket
    documentId: "71194ba7-..."
    bucketName: "index"
    storagePath: "..."
... (20+ more lines of JSON logs)
```

### After (Structured format)
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

## Benefits

✅ **Easy to scan** - Visual hierarchy with separators and emoji  
✅ **Complete information** - All details in one place  
✅ **Professional** - Similar to MCP server logs  
✅ **Progress tracking** - Real-time updates  
✅ **Error clarity** - Prominent error display  
✅ **Performance metrics** - Duration and character counts  
✅ **Message tracking** - Sequential numbering  


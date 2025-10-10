# Extraction Queue Cleanup Script

## Purpose

This script cleans up the `extraction_queue` table in the **NotaFlow - Dev** database by:

1. Fetching all rows from the table
2. Normalizing and fixing `supabase_path` URLs
3. Verifying that URLs are accessible
4. Updating valid URLs or deleting invalid rows

## URL Handling Cases

### Case 1: Already Correct URL
```
https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/public/index/file.pdf
```
- ✅ Correct project ID (tmidwbceewlgqyfmuboq)
- ✅ Full URL format
- **Action**: Verify accessibility, keep if valid

### Case 2: Path Only
```
index/file.pdf
```
- **Action**: Convert to full URL with correct project ID, verify, update or delete

### Case 3: Wrong Project ID (from Prod)
```
https://sqzqvxqcybghcgrpubsy.supabase.co/storage/v1/object/actes/file.pdf
```
- ❌ Wrong project ID (sqzqvxqcybghcgrpubsy = prod)
- **Action**: Replace with dev project ID, verify, update or delete

## Prerequisites

- Node.js installed
- Supabase service key for the dev database

## Setup

1. Set the environment variable with your Supabase service key:
   ```bash
   export SUPABASE_SERVICE_KEY="your-service-key-here"
   ```

2. Make sure you have the required dependencies installed:
   ```bash
   npm install @supabase/supabase-js
   ```

## Running the Script

```bash
npx tsx scripts/cleanup-extraction-queue.ts
```

Or if you prefer to compile first:
```bash
npx tsc scripts/cleanup-extraction-queue.ts
node scripts/cleanup-extraction-queue.js
```

## Output

The script provides detailed logging:
- Progress counter for each row
- Actions taken (update, delete, skip)
- Summary statistics at the end

Example output:
```
================================================================================
🧹 EXTRACTION QUEUE CLEANUP SCRIPT
================================================================================

📥 Fetching all rows from extraction_queue...
📊 Found 150 rows to process

[1/150] ✅ Row abc-123: URL already correct and valid
[2/150] 🔄 Row def-456: Updating URL
   Old: https://sqzqvxqcybghcgrpubsy.supabase.co/storage/v1/object/actes/file.pdf
   New: https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/public/actes/file.pdf
[3/150] ❌ Row ghi-789: URL not accessible, deleting
   URL: https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/public/index/missing.pdf

================================================================================
📊 CLEANUP SUMMARY
================================================================================
   Total rows processed: 150
   ✅ Already valid:      50
   🔄 Updated:            80
   ❌ Deleted:            15
   ⏭️  Skipped (no path): 5
================================================================================
```

## Safety Notes

⚠️ **This script will DELETE rows** where the URL cannot be verified as accessible.

- Make sure you're running this on the **DEV database only** (tmidwbceewlgqyfmuboq)
- Consider backing up the table before running if needed
- The script processes rows one at a time to avoid overwhelming the database

## What Gets Deleted

A row is deleted if:
- The URL cannot be normalized
- The normalized URL is not accessible (returns non-200 status)

## What Gets Updated

A row is updated if:
- The URL can be normalized to a different format
- The normalized URL is accessible
- The original path differs from the normalized path


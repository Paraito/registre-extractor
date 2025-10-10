import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Dev database configuration
const SUPABASE_URL = 'https://tmidwbceewlgqyfmuboq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_KEY;

const DEV_PROJECT_ID = 'tmidwbceewlgqyfmuboq';
const PROD_PROJECT_ID = 'sqzqvxqcybghcgrpubsy';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ DEV_SUPABASE_SERVICE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ExtractionQueueRow {
  id: string;
  supabase_path: string | null;
}

/**
 * Normalize the supabase_path to a full URL with the correct project ID
 * Note: Most buckets (index, actes, plans-cadastraux) are PRIVATE, so no /public/ in URL
 */
function normalizeSupabasePath(path: string | null): string | null {
  if (!path) return null;

  // Case 1: Already a full URL with correct project ID
  if (path.startsWith(`https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/`)) {
    return path;
  }

  // Case 2: Path only (e.g., "index/file.pdf" or "actes/file.pdf")
  // These are PRIVATE buckets, so NO /public/ in the URL
  if (!path.startsWith('http')) {
    return `https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/${path}`;
  }

  // Case 3: Full URL but with wrong project ID (prod)
  if (path.includes(PROD_PROJECT_ID)) {
    return path.replace(PROD_PROJECT_ID, DEV_PROJECT_ID);
  }

  // Case 3 variant: URL with different structure
  const urlMatch = path.match(/https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/(.+)/);
  if (urlMatch) {
    const pathPart = urlMatch[1];
    return `https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/${pathPart}`;
  }

  return path;
}

/**
 * Verify if a file exists in Supabase storage
 * Extracts bucket and path from URL and checks using Supabase client
 */
async function verifyUrl(url: string): Promise<boolean> {
  try {
    // Extract bucket and file path from URL
    // Format: https://{project}.supabase.co/storage/v1/object/{bucket}/{path}
    const match = url.match(/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)/);
    if (!match) {
      console.error(`   ⚠️  Could not parse URL: ${url}`);
      return false;
    }

    const bucket = match[1];
    const filePath = match[2];

    // Try to get the file's public URL or download it (this checks existence)
    // For private buckets, we use createSignedUrl which will fail if file doesn't exist
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 60); // 60 second expiry, just for verification

    if (error) {
      // File doesn't exist or other error
      return false;
    }

    // If we got a signed URL, the file exists
    return !!data?.signedUrl;
  } catch (error) {
    return false;
  }
}

/**
 * Main cleanup function
 */
async function cleanupExtractionQueue() {
  console.log('='.repeat(80));
  console.log('🧹 EXTRACTION QUEUE CLEANUP SCRIPT');
  console.log('='.repeat(80));
  console.log();

  // Get offset from command line argument (e.g., npm run script 1000)
  const startOffset = parseInt(process.argv[2] || '0', 10);

  // Fetch all rows (using range to bypass 1000 row limit)
  console.log('📥 Fetching all rows from extraction_queue...');

  // First get the total count
  const { count } = await supabase
    .from('extraction_queue')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total rows in table: ${count}`);

  if (startOffset > 0) {
    console.log(`⏩ Starting from offset: ${startOffset}`);
  }

  // Fetch rows in batches to avoid memory issues
  const BATCH_SIZE = 500;
  let allRows: ExtractionQueueRow[] = [];

  for (let offset = startOffset; offset < (count || 0); offset += BATCH_SIZE) {
    const end = Math.min(offset + BATCH_SIZE - 1, (count || 0) - 1);
    console.log(`📥 Fetching rows ${offset} to ${end}...`);

    const { data: batchRows, error: fetchError } = await supabase
      .from('extraction_queue')
      .select('id, supabase_path')
      .range(offset, end);

    if (fetchError) {
      console.error('❌ Error fetching rows:', fetchError);
      process.exit(1);
    }

    if (batchRows && batchRows.length > 0) {
      allRows = allRows.concat(batchRows as ExtractionQueueRow[]);
    }
  }

  const rows = allRows;

  if (!rows || rows.length === 0) {
    console.log('✅ No rows found in extraction_queue to process');
    return;
  }

  console.log(`📊 Fetched ${rows.length} rows to process`);
  console.log();

  let updatedCount = 0;
  let deletedCount = 0;
  let validCount = 0;
  let deletedNoPathCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as ExtractionQueueRow;
    const progress = `[${i + 1}/${rows.length}]`;

    if (!row.supabase_path) {
      console.log(`${progress} 🗑️  Row ${row.id}: No supabase_path, deleting`);

      const { error: deleteError } = await supabase
        .from('extraction_queue')
        .delete()
        .eq('id', row.id);

      if (deleteError) {
        console.error(`${progress} ❌ Error deleting row ${row.id}:`, deleteError.message);
      } else {
        deletedNoPathCount++;
      }
      continue;
    }

    const originalPath = row.supabase_path;
    const normalizedPath = normalizeSupabasePath(originalPath);

    if (!normalizedPath) {
      console.log(`${progress} ⚠️  Row ${row.id}: Could not normalize path, deleting`);
      const { error: deleteError } = await supabase
        .from('extraction_queue')
        .delete()
        .eq('id', row.id);

      if (deleteError) {
        console.error(`${progress} ❌ Error deleting row ${row.id}:`, deleteError.message);
      } else {
        deletedCount++;
      }
      continue;
    }

    // Check if URL is accessible
    const isValid = await verifyUrl(normalizedPath);

    if (!isValid) {
      console.log(`${progress} ❌ Row ${row.id}: URL not accessible, deleting`);
      console.log(`   URL: ${normalizedPath}`);
      
      const { error: deleteError } = await supabase
        .from('extraction_queue')
        .delete()
        .eq('id', row.id);

      if (deleteError) {
        console.error(`${progress} ❌ Error deleting row ${row.id}:`, deleteError.message);
      } else {
        deletedCount++;
      }
      continue;
    }

    // URL is valid
    if (originalPath !== normalizedPath) {
      // Need to update
      console.log(`${progress} 🔄 Row ${row.id}: Updating URL`);
      console.log(`   Old: ${originalPath}`);
      console.log(`   New: ${normalizedPath}`);

      const { error: updateError } = await supabase
        .from('extraction_queue')
        .update({ supabase_path: normalizedPath })
        .eq('id', row.id);

      if (updateError) {
        console.error(`${progress} ❌ Error updating row ${row.id}:`, updateError.message);
      } else {
        updatedCount++;
      }
    } else {
      // Already correct
      console.log(`${progress} ✅ Row ${row.id}: URL already correct and valid`);
      validCount++;
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('📊 CLEANUP SUMMARY');
  console.log('='.repeat(80));
  console.log(`   Total rows processed:     ${rows.length}`);
  console.log(`   ✅ Already valid:          ${validCount}`);
  console.log(`   🔄 Updated:                ${updatedCount}`);
  console.log(`   ❌ Deleted (invalid URL):  ${deletedCount}`);
  console.log(`   🗑️  Deleted (no path):     ${deletedNoPathCount}`);
  console.log('='.repeat(80));
}

// Run the cleanup
cleanupExtractionQueue()
  .then(() => {
    console.log('✅ Cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  });


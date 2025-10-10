import { createClient } from '@supabase/supabase-js';

// Dev database configuration
const SUPABASE_URL = 'https://tmidwbceewlgqyfmuboq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const DEV_PROJECT_ID = 'tmidwbceewlgqyfmuboq';
const PROD_PROJECT_ID = 'sqzqvxqcybghcgrpubsy';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ExtractionQueueRow {
  id: string;
  supabase_path: string | null;
}

/**
 * Normalize the supabase_path to a full URL with the correct project ID
 */
function normalizeSupabasePath(path: string | null): string | null {
  if (!path) return null;

  // Case 1: Already a full URL with correct project ID
  if (path.startsWith(`https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/`)) {
    return path;
  }

  // Case 2: Path only (e.g., "index/file.pdf")
  if (!path.startsWith('http')) {
    return `https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/public/${path}`;
  }

  // Case 3: Full URL but with wrong project ID (prod)
  if (path.includes(PROD_PROJECT_ID)) {
    return path.replace(PROD_PROJECT_ID, DEV_PROJECT_ID);
  }

  // Case 3 variant: URL with different structure
  const urlMatch = path.match(/https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/(.+)/);
  if (urlMatch) {
    const pathPart = urlMatch[1];
    // Remove 'public/' if it exists at the start
    const cleanPath = pathPart.startsWith('public/') ? pathPart.substring(7) : pathPart;
    return `https://${DEV_PROJECT_ID}.supabase.co/storage/v1/object/public/${cleanPath}`;
  }

  return path;
}

/**
 * Verify if a URL is accessible
 */
async function verifyUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
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

  // Fetch all rows
  console.log('📥 Fetching all rows from extraction_queue...');
  const { data: rows, error: fetchError } = await supabase
    .from('extraction_queue')
    .select('id, supabase_path');

  if (fetchError) {
    console.error('❌ Error fetching rows:', fetchError);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('✅ No rows found in extraction_queue');
    return;
  }

  console.log(`📊 Found ${rows.length} rows to process`);
  console.log();

  let updatedCount = 0;
  let deletedCount = 0;
  let validCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as ExtractionQueueRow;
    const progress = `[${i + 1}/${rows.length}]`;

    if (!row.supabase_path) {
      console.log(`${progress} ⏭️  Row ${row.id}: No supabase_path, skipping`);
      skippedCount++;
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
  console.log(`   Total rows processed: ${rows.length}`);
  console.log(`   ✅ Already valid:      ${validCount}`);
  console.log(`   🔄 Updated:            ${updatedCount}`);
  console.log(`   ❌ Deleted:            ${deletedCount}`);
  console.log(`   ⏭️  Skipped (no path): ${skippedCount}`);
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


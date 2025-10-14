import { supabaseManager } from './src/utils/supabase';
import { logger } from './src/utils/logger';
import { createClient } from '@supabase/supabase-js';

/**
 * Script to apply the boosted_file_content migration to production
 * This adds the missing column that separates raw OCR from enhanced OCR
 */

const MIGRATION_SQL = `
-- Add boosted_file_content column for storing enhanced OCR results
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS boosted_file_content TEXT;

-- Add index for searching boosted content
CREATE INDEX IF NOT EXISTS idx_extraction_queue_boosted_content_search 
ON extraction_queue USING gin(to_tsvector('french', boosted_file_content))
WHERE boosted_file_content IS NOT NULL;

-- Update column comments to clarify the distinction
COMMENT ON COLUMN extraction_queue.file_content IS 'Raw OCR extracted text content from the PDF document (for index documents only) - unprocessed output from Gemini Vision AI';
COMMENT ON COLUMN extraction_queue.boosted_file_content IS 'Enhanced OCR text with 60+ domain-specific correction rules applied (for index documents only) - final processed version';
`;

async function applyMigration() {
  console.log('\n🔧 Applying Boosted Content Migration');
  console.log('=====================================\n');

  const environment = process.argv[2] || 'prod';
  console.log(`Target Environment: ${environment}\n`);

  // Get the service client
  const client = supabaseManager.getServiceClient(environment as any);
  if (!client) {
    console.error(`❌ No client available for environment: ${environment}`);
    console.error('Available environments:', supabaseManager.getAvailableEnvironments());
    process.exit(1);
  }

  // Confirm before proceeding
  console.log('⚠️  This will modify the database schema.');
  console.log('Migration SQL:');
  console.log('─'.repeat(50));
  console.log(MIGRATION_SQL);
  console.log('─'.repeat(50));
  console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    console.log('🚀 Executing migration...\n');

    // Execute the migration using the Supabase client
    // Note: We need to use the REST API or direct SQL execution
    // For now, we'll provide instructions for manual execution

    console.log('📋 Migration Instructions:');
    console.log('==========================\n');
    console.log('1. Go to your Supabase Dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Run the following SQL:\n');
    console.log(MIGRATION_SQL);
    console.log('\nOr use the Supabase CLI:');
    console.log('  supabase db push\n');

    // Verify if column exists
    console.log('🔍 Checking current schema...\n');
    const { data: testRow, error: testError } = await client
      .from('extraction_queue')
      .select('*')
      .limit(1)
      .single();

    if (testError && testError.code !== 'PGRST116') {
      console.error('❌ Error checking schema:', testError);
      process.exit(1);
    }

    if (testRow) {
      const hasBoostColumn = 'boosted_file_content' in testRow;
      console.log(`Column 'boosted_file_content': ${hasBoostColumn ? '✅ EXISTS' : '❌ MISSING'}`);
      
      if (hasBoostColumn) {
        console.log('\n✅ Migration already applied!');
        
        // Show statistics
        const { data: stats } = await client
          .from('extraction_queue')
          .select('id, file_content, boosted_file_content')
          .eq('document_source', 'index')
          .not('file_content', 'is', null);

        if (stats) {
          const withBoost = stats.filter(r => r.boosted_file_content).length;
          const withoutBoost = stats.filter(r => !r.boosted_file_content).length;
          
          console.log('\n📊 OCR Content Statistics:');
          console.log(`   Total index documents with OCR: ${stats.length}`);
          console.log(`   With boosted content: ${withBoost}`);
          console.log(`   Without boosted content: ${withoutBoost}`);
          
          if (withoutBoost > 0) {
            console.log('\n💡 Tip: You may want to backfill boosted content for existing rows.');
            console.log('   These rows have raw OCR but no enhanced version.');
          }
        }
      } else {
        console.log('\n❌ Migration NOT yet applied.');
        console.log('   Please run the SQL above in your Supabase Dashboard.');
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
applyMigration()
  .then(() => {
    console.log('\n✅ Script completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });


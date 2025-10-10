#!/usr/bin/env tsx
/**
 * Generate instructions for applying migration 005 (OCR tracking columns)
 * to prod and staging environments via Supabase SQL Editor
 */

import { supabaseManager } from './src/utils/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from './src/config';

const MIGRATION_SQL = readFileSync(
  join(__dirname, 'supabase/migrations/005_add_ocr_tracking.sql'),
  'utf-8'
);

async function generateInstructions() {
  console.log('\n' + '='.repeat(70));
  console.log('📋 OCR TRACKING MIGRATION INSTRUCTIONS');
  console.log('='.repeat(70));
  console.log('\n⚠️  The following environments are missing OCR tracking columns:\n');

  const environments = supabaseManager.getAvailableEnvironments();
  const targetEnvs = environments.filter(env => env === 'prod' || env === 'staging');

  if (targetEnvs.length === 0) {
    console.log('✅ No environments need migration (or none configured)\n');
    return;
  }

  for (const env of targetEnvs) {
    const envConfig = config.environments[env];
    if (!envConfig) continue;

    console.log(`   • ${env.toUpperCase()}`);
    console.log(`     URL: ${envConfig.url}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📝 STEPS TO APPLY MIGRATION');
  console.log('─'.repeat(70));
  console.log('\nFor EACH environment listed above:\n');
  console.log('1. Open Supabase Dashboard: https://supabase.com/dashboard');
  console.log('2. Select the project');
  console.log('3. Go to: SQL Editor (left sidebar)');
  console.log('4. Click "New Query"');
  console.log('5. Copy and paste the SQL below');
  console.log('6. Click "Run" or press Cmd/Ctrl + Enter');
  console.log('7. Verify success (should see "Success. No rows returned")');

  console.log('\n' + '─'.repeat(70));
  console.log('📄 SQL TO RUN IN SUPABASE SQL EDITOR');
  console.log('─'.repeat(70));
  console.log('\n');
  console.log(MIGRATION_SQL);
  console.log('\n' + '─'.repeat(70));

  console.log('\n💡 WHAT THIS MIGRATION DOES:\n');
  console.log('   • Adds status ID 6 "OCR en traitement" to extraction_status table');
  console.log('   • Adds 7 OCR tracking columns to extraction_queue table:');
  console.log('     - ocr_worker_id (TEXT)');
  console.log('     - ocr_started_at (TIMESTAMPTZ)');
  console.log('     - ocr_completed_at (TIMESTAMPTZ)');
  console.log('     - ocr_attempts (INTEGER)');
  console.log('     - ocr_max_attempts (INTEGER)');
  console.log('     - ocr_error (TEXT)');
  console.log('     - ocr_last_error_at (TIMESTAMPTZ)');
  console.log('   • Creates indexes for OCR job monitoring');
  console.log('   • Adds column comments for documentation');

  console.log('\n' + '─'.repeat(70));
  console.log('✅ VERIFICATION');
  console.log('─'.repeat(70));
  console.log('\nAfter running the migration, verify with:\n');
  console.log('   npx tsx check-ocr-columns.ts');

  console.log('\n' + '='.repeat(70));
  console.log('');
}

// Run
generateInstructions()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });


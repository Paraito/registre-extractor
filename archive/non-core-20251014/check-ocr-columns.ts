#!/usr/bin/env tsx
/**
 * Check which environments have OCR tracking columns
 * This helps diagnose the "column does not exist" errors
 */

import { supabaseManager } from './src/utils/supabase';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

async function checkOCRColumns() {
  console.log('\n=== Checking OCR Tracking Columns ===\n');
  
  const environments = supabaseManager.getAvailableEnvironments();
  
  if (environments.length === 0) {
    console.log('❌ No environments configured');
    return;
  }
  
  console.log(`📊 Checking ${environments.length} environment(s): ${environments.join(', ')}\n`);
  
  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.log(`⚠️  ${env.toUpperCase()}: No client available\n`);
      continue;
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 Environment: ${env.toUpperCase()}`);
    console.log('='.repeat(60));
    
    try {
      // Query information_schema to check for OCR columns
      const { data: columns, error } = await client
        .rpc('exec_sql', {
          sql: `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'extraction_queue'
            AND column_name LIKE '%ocr%'
            ORDER BY column_name;
          `
        });
      
      if (error) {
        // If RPC doesn't exist, try direct query
        console.log('   ℹ️  RPC method not available, trying direct column check...\n');
        
        // Try to select OCR columns to see which exist
        const ocrColumns = [
          'ocr_worker_id',
          'ocr_started_at',
          'ocr_completed_at',
          'ocr_attempts',
          'ocr_max_attempts',
          'ocr_error',
          'ocr_last_error_at'
        ];
        
        const existingColumns: string[] = [];
        const missingColumns: string[] = [];
        
        for (const col of ocrColumns) {
          const { error: colError } = await client
            .from('extraction_queue')
            .select(col)
            .limit(1);
          
          if (colError) {
            if (colError.code === '42703') {
              missingColumns.push(col);
            } else {
              console.log(`   ⚠️  Error checking ${col}: ${colError.message}`);
            }
          } else {
            existingColumns.push(col);
          }
        }
        
        if (existingColumns.length > 0) {
          console.log('   ✅ Existing OCR columns:');
          existingColumns.forEach(col => console.log(`      • ${col}`));
        }
        
        if (missingColumns.length > 0) {
          console.log('\n   ❌ Missing OCR columns:');
          missingColumns.forEach(col => console.log(`      • ${col}`));
          console.log('\n   💡 Migration 005 needs to be applied to this environment');
        }
        
        if (existingColumns.length === 0 && missingColumns.length === 0) {
          console.log('   ⚠️  Could not determine column status');
        }
        
      } else if (columns && columns.length > 0) {
        console.log('   ✅ OCR tracking columns found:\n');
        columns.forEach((col: ColumnInfo) => {
          console.log(`      • ${col.column_name}`);
          console.log(`        Type: ${col.data_type}`);
          console.log(`        Nullable: ${col.is_nullable}`);
          console.log('');
        });
      } else {
        console.log('   ❌ No OCR tracking columns found');
        console.log('   💡 Migration 005 needs to be applied to this environment');
      }
      
      // Check for status_id = 6 (OCR_PROCESSING)
      const { data: statusData, error: statusError } = await client
        .from('extraction_status')
        .select('id, name')
        .eq('id', 6)
        .single();
      
      if (statusError) {
        console.log('\n   ❌ Status ID 6 (OCR_PROCESSING) not found');
        console.log('   💡 Migration 005 needs to be applied to this environment');
      } else if (statusData) {
        console.log(`\n   ✅ Status ID 6: "${statusData.name}"`);
      }
      
      // Check for any jobs in OCR_PROCESSING state
      const { data: ocrJobs, error: jobsError } = await client
        .from('extraction_queue')
        .select('id, status_id, document_number')
        .eq('status_id', 6)
        .limit(5);
      
      if (!jobsError && ocrJobs && ocrJobs.length > 0) {
        console.log(`\n   📋 Found ${ocrJobs.length} job(s) in OCR_PROCESSING state:`);
        ocrJobs.forEach(job => {
          console.log(`      • Job ${job.id}: ${job.document_number}`);
        });
      }
      
    } catch (error) {
      console.log(`   ❌ Error checking ${env}:`, error);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Check complete\n');
}

// Run the check
checkOCRColumns()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });


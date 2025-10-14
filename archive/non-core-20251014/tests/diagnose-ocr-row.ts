import { supabaseManager } from '../src/utils/supabase';
import { logger } from '../src/utils/logger';
import { EXTRACTION_STATUS } from '../src/types';
import fs from 'fs/promises';
import path from 'path';

/**
 * Diagnostic script to check why a specific row isn't being picked up by the OCR worker
 * Usage: npx tsx diagnose-ocr-row.ts <row-id>
 */

const ROW_ID = process.argv[2] || '65a7ee1f-674d-4efa-a4a1-714b89333921';

interface DiagnosticResult {
  rowFound: boolean;
  environment?: string;
  rowData?: any;
  meetsOCRCriteria: boolean;
  criteriaChecks: {
    hasCorrectStatus: boolean;
    isIndexDocument: boolean;
    hasNoFileContent: boolean;
    hasSupabasePath: boolean;
  };
  downloadTest?: {
    success: boolean;
    error?: string;
    fileSize?: number;
    filePath?: string;
  };
  recommendations: string[];
}

async function diagnoseRow(rowId: string): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    rowFound: false,
    meetsOCRCriteria: false,
    criteriaChecks: {
      hasCorrectStatus: false,
      isIndexDocument: false,
      hasNoFileContent: false,
      hasSupabasePath: false,
    },
    recommendations: [],
  };

  console.log('\n🔍 Diagnosing OCR Worker Issue');
  console.log('================================\n');
  console.log(`Row ID: ${rowId}\n`);

  // Check all environments
  const environments = supabaseManager.getAvailableEnvironments();
  console.log(`📊 Checking ${environments.length} environment(s): ${environments.join(', ')}\n`);

  for (const env of environments) {
    const client = supabaseManager.getServiceClient(env);
    if (!client) {
      console.log(`⚠️  No client available for environment: ${env}`);
      continue;
    }

    console.log(`🔎 Checking environment: ${env}`);

    try {
      const { data, error } = await client
        .from('extraction_queue')
        .select('*')
        .eq('id', rowId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log(`   ❌ Row not found in ${env}`);
        } else {
          console.log(`   ❌ Error querying ${env}:`, error.message);
        }
        continue;
      }

      if (data) {
        result.rowFound = true;
        result.environment = env;
        result.rowData = data;

        console.log(`   ✅ Row found in ${env}!\n`);
        console.log('📋 Row Details:');
        console.log('   ├─ Document Source:', data.document_source);
        console.log('   ├─ Document Number:', data.document_number);
        console.log('   ├─ Status ID:', data.status_id, getStatusName(data.status_id));
        console.log('   ├─ Supabase Path:', data.supabase_path || '(null)');
        console.log('   ├─ File Content:', data.file_content ? `${data.file_content.length} chars` : '(null)');
        console.log('   ├─ Boosted Content:', data.boosted_file_content ? `${data.boosted_file_content.length} chars` : '(null)');
        console.log('   ├─ Worker ID:', data.worker_id || '(null)');
        console.log('   ├─ Created At:', data.created_at);
        console.log('   └─ Updated At:', data.updated_at);

        // Check OCR criteria
        console.log('\n🎯 OCR Worker Criteria Check:');
        
        result.criteriaChecks.hasCorrectStatus = data.status_id === EXTRACTION_STATUS.COMPLETE;
        console.log(`   ${result.criteriaChecks.hasCorrectStatus ? '✅' : '❌'} Status ID = 3 (COMPLETE): ${data.status_id === EXTRACTION_STATUS.COMPLETE ? 'YES' : `NO (current: ${data.status_id})`}`);

        result.criteriaChecks.isIndexDocument = data.document_source === 'index';
        console.log(`   ${result.criteriaChecks.isIndexDocument ? '✅' : '❌'} Document Source = 'index': ${data.document_source === 'index' ? 'YES' : `NO (current: ${data.document_source})`}`);

        result.criteriaChecks.hasNoFileContent = data.file_content === null || data.file_content === undefined;
        console.log(`   ${result.criteriaChecks.hasNoFileContent ? '✅' : '❌'} File Content IS NULL: ${result.criteriaChecks.hasNoFileContent ? 'YES' : 'NO (already has content)'}`);

        result.criteriaChecks.hasSupabasePath = !!data.supabase_path;
        console.log(`   ${result.criteriaChecks.hasSupabasePath ? '✅' : '❌'} Supabase Path IS NOT NULL: ${result.criteriaChecks.hasSupabasePath ? 'YES' : 'NO (missing path)'}`);

        result.meetsOCRCriteria = Object.values(result.criteriaChecks).every(v => v);

        console.log(`\n   ${result.meetsOCRCriteria ? '✅ MEETS ALL CRITERIA' : '❌ DOES NOT MEET ALL CRITERIA'}`);

        // Test download if criteria are met
        if (result.meetsOCRCriteria && data.supabase_path) {
          console.log('\n📥 Testing File Download from Supabase Storage...');
          result.downloadTest = await testDownload(client, data, env);
        }

        // Generate recommendations
        generateRecommendations(result);

        break; // Found the row, no need to check other environments
      }
    } catch (error) {
      console.log(`   ❌ Unexpected error in ${env}:`, error);
    }
  }

  if (!result.rowFound) {
    console.log('\n❌ Row not found in any environment!');
    result.recommendations.push('Verify the row ID is correct');
    result.recommendations.push('Check if the row was deleted or moved to a different database');
  }

  return result;
}

async function testDownload(client: any, rowData: any, environment: string): Promise<any> {
  const testResult = {
    success: false,
    error: undefined as string | undefined,
    fileSize: undefined as number | undefined,
    filePath: undefined as string | undefined,
  };

  try {
    // Determine bucket name
    const bucketName = rowData.document_source === 'acte' ? 'actes'
                     : rowData.document_source === 'plan_cadastraux' ? 'plans-cadastraux'
                     : 'index';

    console.log(`   📦 Bucket: ${bucketName}`);

    // Parse storage path
    let storagePath = rowData.supabase_path;
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
      const urlMatch = storagePath.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
      if (urlMatch) {
        storagePath = urlMatch[1];
      }
    } else if (storagePath.startsWith(`${bucketName}/`)) {
      storagePath = storagePath.substring(bucketName.length + 1);
    }

    console.log(`   📄 Storage Path: ${storagePath}`);

    // Attempt download
    console.log(`   ⏳ Downloading...`);
    const { data: pdfData, error: downloadError } = await client.storage
      .from(bucketName)
      .download(storagePath);

    if (downloadError || !pdfData) {
      testResult.error = downloadError?.message || 'No data returned';
      console.log(`   ❌ Download failed: ${testResult.error}`);
      return testResult;
    }

    // Save to temp file
    const tempDir = '/tmp/ocr-diagnostics';
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `test-${Date.now()}.pdf`);

    const arrayBuffer = await pdfData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(tempPath, buffer);

    testResult.success = true;
    testResult.fileSize = buffer.length;
    testResult.filePath = tempPath;

    console.log(`   ✅ Download successful!`);
    console.log(`   📊 File size: ${(buffer.length / 1024).toFixed(2)} KB`);
    console.log(`   💾 Saved to: ${tempPath}`);

    // Clean up
    await fs.unlink(tempPath).catch(() => {});

  } catch (error) {
    testResult.error = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ Download test failed: ${testResult.error}`);
  }

  return testResult;
}

function generateRecommendations(result: DiagnosticResult): void {
  console.log('\n💡 Recommendations:');
  console.log('==================\n');

  if (!result.meetsOCRCriteria) {
    if (!result.criteriaChecks.hasCorrectStatus) {
      result.recommendations.push(`Update status_id to 3 (COMPLETE). Current: ${result.rowData?.status_id}`);
    }
    if (!result.criteriaChecks.isIndexDocument) {
      result.recommendations.push(`This is not an index document (current: ${result.rowData?.document_source}). OCR only processes index documents.`);
    }
    if (!result.criteriaChecks.hasNoFileContent) {
      result.recommendations.push('File content already exists. OCR has already been processed or manually added.');
    }
    if (!result.criteriaChecks.hasSupabasePath) {
      result.recommendations.push('Missing supabase_path. The PDF must be uploaded to storage first.');
    }
  } else {
    if (result.downloadTest?.success) {
      result.recommendations.push('✅ Row meets all criteria and file download works!');
      result.recommendations.push('Check if the OCR monitor is running:');
      result.recommendations.push('   - Run: npm run ocr:dev (for development)');
      result.recommendations.push('   - Or: npm run ocr (for production)');
      result.recommendations.push('   - Check logs for any errors');
      result.recommendations.push(`   - The monitor polls every 10 seconds by default`);
    } else if (result.downloadTest) {
      result.recommendations.push(`❌ File download failed: ${result.downloadTest.error}`);
      result.recommendations.push('Check bucket permissions and file path');
      result.recommendations.push('Verify the file exists in Supabase Storage');
    }
  }

  result.recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`);
  });
}

function getStatusName(statusId: number): string {
  const statusMap: Record<number, string> = {
    1: '(En attente)',
    2: '(En traitement)',
    3: '(Complété)',
    4: '(Erreur)',
    5: '(Extraction complété)'
  };
  return statusMap[statusId] || '(Unknown)';
}

// Run the diagnostic
diagnoseRow(ROW_ID)
  .then((result) => {
    console.log('\n' + '='.repeat(50));
    console.log('Diagnostic Complete');
    console.log('='.repeat(50) + '\n');
    
    if (result.meetsOCRCriteria && result.downloadTest?.success) {
      console.log('✅ Everything looks good! The OCR worker should pick this up.');
      console.log('   If it\'s not being processed, check if the OCR monitor is running.\n');
      process.exit(0);
    } else {
      console.log('❌ Issues found. Please review the recommendations above.\n');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('\n❌ Diagnostic failed:', error);
    process.exit(1);
  });


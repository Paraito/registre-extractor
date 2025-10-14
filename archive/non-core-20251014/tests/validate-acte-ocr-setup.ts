/**
 * Acte OCR Setup Validation Script
 * 
 * This script validates that the environment is properly configured
 * for Acte OCR testing and operation.
 * 
 * Usage:
 *   npx ts-node validate-acte-ocr-setup.ts
 */

import { config } from '../src/config';
import { supabaseManager, EnvironmentName } from '../src/utils/supabase';
import { GeminiFileClient } from '../src/ocr/gemini-file-client';
import { EXTRACTION_STATUS } from '../src/types';
import fs from 'fs/promises';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg: string) => console.log(`\n${'='.repeat(67)}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${'='.repeat(67)}\n`),
  section: (emoji: string, title: string) => console.log(`\n${colors.bright}${emoji} ${title}${colors.reset}`),
  success: (msg: string) => console.log(`${colors.green}  ✅ ${msg}${colors.reset}`),
  error: (msg: string) => console.log(`${colors.red}  ❌ ${msg}${colors.reset}`),
  warning: (msg: string) => console.log(`${colors.yellow}  ⚠️  ${msg}${colors.reset}`),
  info: (msg: string) => console.log(`${colors.blue}  ℹ️  ${msg}${colors.reset}`),
};

interface ValidationResult {
  category: string;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}

const results: ValidationResult[] = [];

/**
 * Validate environment variables
 */
async function validateEnvironmentVariables(): Promise<ValidationResult> {
  log.section('🔧', 'Environment Variables');

  const result: ValidationResult = {
    category: 'Environment Variables',
    checks: [],
  };

  // Check Gemini API Key
  if (config.ocr.geminiApiKey) {
    result.checks.push({
      name: 'GEMINI_API_KEY',
      passed: true,
      message: `Set (${config.ocr.geminiApiKey.substring(0, 8)}...)`,
    });
    log.success(`GEMINI_API_KEY: Set (${config.ocr.geminiApiKey.substring(0, 8)}...)`);
  } else {
    result.checks.push({
      name: 'GEMINI_API_KEY',
      passed: false,
      message: 'Not set',
    });
    log.error('GEMINI_API_KEY: Not set');
  }

  // Check Supabase environments
  const environments: EnvironmentName[] = ['dev', 'staging', 'prod'];
  for (const env of environments) {
    const envConfig = config.environments[env];
    const enabled = config.ocr.enabledEnvironments[env];

    if (envConfig) {
      result.checks.push({
        name: `${env.toUpperCase()}_SUPABASE_*`,
        passed: true,
        message: `Configured${enabled ? ' (OCR enabled)' : ' (OCR disabled)'}`,
      });
      log.success(`${env.toUpperCase()}_SUPABASE_*: Configured${enabled ? ' (OCR enabled)' : ' (OCR disabled)'}`);
    } else {
      result.checks.push({
        name: `${env.toUpperCase()}_SUPABASE_*`,
        passed: false,
        message: 'Not configured',
      });
      log.warning(`${env.toUpperCase()}_SUPABASE_*: Not configured`);
    }
  }

  // Check Acte OCR configuration
  log.info(`ACTE_OCR_EXTRACT_MODEL: ${config.ocr.acte.extractModel}`);
  log.info(`ACTE_OCR_BOOST_MODEL: ${config.ocr.acte.boostModel}`);
  log.info(`ACTE_OCR_EXTRACT_TEMPERATURE: ${config.ocr.acte.extractTemperature}`);
  log.info(`ACTE_OCR_BOOST_TEMPERATURE: ${config.ocr.acte.boostTemperature}`);

  return result;
}

/**
 * Validate Gemini API connectivity
 */
async function validateGeminiAPI(): Promise<ValidationResult> {
  log.section('🤖', 'Gemini API Connectivity');

  const result: ValidationResult = {
    category: 'Gemini API',
    checks: [],
  };

  if (!config.ocr.geminiApiKey) {
    result.checks.push({
      name: 'API Connection',
      passed: false,
      message: 'Cannot test - API key not set',
    });
    log.error('Cannot test - API key not set');
    return result;
  }

  try {
    const client = new GeminiFileClient({
      apiKey: config.ocr.geminiApiKey,
    });

    // Try to create a simple test (we can't easily test without uploading a file)
    // For now, just verify the client can be instantiated
    result.checks.push({
      name: 'Client Initialization',
      passed: true,
      message: 'GeminiFileClient initialized successfully',
    });
    log.success('GeminiFileClient initialized successfully');

    // Note: We can't easily test file upload without a real file
    log.info('File upload test skipped (requires test file)');

  } catch (error) {
    result.checks.push({
      name: 'Client Initialization',
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
    log.error(`Failed: ${error instanceof Error ? error.message : error}`);
  }

  return result;
}

/**
 * Validate Supabase connectivity and test data
 */
async function validateSupabase(): Promise<ValidationResult> {
  log.section('💾', 'Supabase Connectivity and Test Data');

  const result: ValidationResult = {
    category: 'Supabase',
    checks: [],
  };

  const environments: EnvironmentName[] = ['dev', 'staging', 'prod'];

  for (const env of environments) {
    const envConfig = config.environments[env];
    if (!envConfig) {
      log.warning(`${env}: Not configured`);
      continue;
    }

    try {
      const client = supabaseManager.getServiceClient(env);
      if (!client) {
        result.checks.push({
          name: `${env} - Connection`,
          passed: false,
          message: 'Client not available',
        });
        log.error(`${env}: Client not available`);
        continue;
      }

      // Test database connection
      const { data: testData, error: testError } = await client
        .from('extraction_queue')
        .select('count')
        .limit(1);

      if (testError) {
        result.checks.push({
          name: `${env} - Connection`,
          passed: false,
          message: testError.message,
        });
        log.error(`${env}: Connection failed - ${testError.message}`);
        continue;
      }

      result.checks.push({
        name: `${env} - Connection`,
        passed: true,
        message: 'Connected successfully',
      });
      log.success(`${env}: Connected successfully`);

      // Check for acte documents ready for OCR
      const { data: acteDocuments, error: acteError } = await client
        .from('extraction_queue')
        .select('id, document_number, status_id, ocr_attempts, ocr_max_attempts')
        .eq('status_id', EXTRACTION_STATUS.COMPLETE)
        .eq('document_source', 'acte')
        .limit(10);

      if (acteError) {
        result.checks.push({
          name: `${env} - Acte Documents`,
          passed: false,
          message: acteError.message,
        });
        log.error(`${env}: Failed to query acte documents - ${acteError.message}`);
        continue;
      }

      const eligible = acteDocuments?.filter(doc => {
        const attempts = doc.ocr_attempts || 0;
        const maxAttempts = doc.ocr_max_attempts || 3;
        return attempts < maxAttempts;
      }) || [];

      if (eligible.length > 0) {
        result.checks.push({
          name: `${env} - Acte Documents`,
          passed: true,
          message: `${eligible.length} document(s) ready for OCR`,
        });
        log.success(`${env}: ${eligible.length} acte document(s) ready for OCR`);
        
        // Show first few documents
        eligible.slice(0, 3).forEach(doc => {
          log.info(`  - ${doc.document_number} (attempts: ${doc.ocr_attempts || 0})`);
        });
      } else {
        result.checks.push({
          name: `${env} - Acte Documents`,
          passed: false,
          message: 'No acte documents ready for OCR',
        });
        log.warning(`${env}: No acte documents ready for OCR`);
      }

      // Check storage bucket access
      const { data: bucketData, error: bucketError } = await client.storage
        .from('actes')
        .list('', { limit: 1 });

      if (bucketError) {
        result.checks.push({
          name: `${env} - Storage Access`,
          passed: false,
          message: bucketError.message,
        });
        log.error(`${env}: Storage access failed - ${bucketError.message}`);
      } else {
        result.checks.push({
          name: `${env} - Storage Access`,
          passed: true,
          message: 'Actes bucket accessible',
        });
        log.success(`${env}: Actes bucket accessible`);
      }

    } catch (error) {
      result.checks.push({
        name: `${env} - General`,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      });
      log.error(`${env}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return result;
}

/**
 * Validate file system permissions
 */
async function validateFileSystem(): Promise<ValidationResult> {
  log.section('📁', 'File System Permissions');

  const result: ValidationResult = {
    category: 'File System',
    checks: [],
  };

  const testDirs = [
    '/tmp/ocr-acte-processing',
    '/tmp/test-acte-ocr',
    '/tmp/test-acte-ocr-integration',
  ];

  for (const dir of testDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fs.constants.W_OK);
      await fs.rmdir(dir);

      result.checks.push({
        name: dir,
        passed: true,
        message: 'Writable',
      });
      log.success(`${dir}: Writable`);
    } catch (error) {
      result.checks.push({
        name: dir,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      });
      log.error(`${dir}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return result;
}

/**
 * Display summary
 */
function displaySummary(results: ValidationResult[]) {
  log.header('📊 Validation Summary');

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  for (const result of results) {
    console.log(`\n${colors.bright}${result.category}${colors.reset}`);
    
    for (const check of result.checks) {
      totalChecks++;
      if (check.passed) {
        passedChecks++;
        console.log(`  ${colors.green}✅${colors.reset} ${check.name}: ${check.message}`);
      } else {
        failedChecks++;
        console.log(`  ${colors.red}❌${colors.reset} ${check.name}: ${check.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(67)}`);
  console.log(`${colors.bright}Total Checks:${colors.reset} ${totalChecks}`);
  console.log(`${colors.green}Passed:${colors.reset} ${passedChecks}`);
  console.log(`${colors.red}Failed:${colors.reset} ${failedChecks}`);
  console.log(`${'='.repeat(67)}\n`);

  if (failedChecks === 0) {
    log.success('All validation checks passed! ✨');
    log.info('You can now run the test scripts:');
    console.log('  - npx ts-node test-acte-ocr.ts');
    console.log('  - npx ts-node test-acte-ocr-integration.ts');
  } else {
    log.error(`${failedChecks} validation check(s) failed`);
    log.warning('Please fix the issues before running tests');
  }
}

/**
 * Main validation function
 */
async function main() {
  log.header('🔍 Acte OCR Setup Validation');

  try {
    // Run all validations
    results.push(await validateEnvironmentVariables());
    results.push(await validateGeminiAPI());
    results.push(await validateSupabase());
    results.push(await validateFileSystem());

    // Display summary
    displaySummary(results);

  } catch (error) {
    log.error(`Validation failed: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run validation
main();


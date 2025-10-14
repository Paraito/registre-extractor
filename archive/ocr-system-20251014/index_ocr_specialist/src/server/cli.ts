#!/usr/bin/env node
/**
 * CLI Entry Point for OCR King Pipeline
 * 
 * Provides command-line interface for running the complete E2E pipeline.
 */

import { CONFIG, validateConfig } from '../../config/runtime.js';
import { runE2EPipeline } from './pipeline.js';
import { createLogger } from '../util/log.js';

// Simple argument parsing
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
OCR King - Multi-model PDF OCR pipeline

Usage:
  node cli.js run [options]           Run the complete E2E OCR pipeline
  node cli.js test [options]          Run E2E test with assertions
  node cli.js process-queue [options] Process a specific extraction_queue document

Options:
  --url <url>           PDF URL to process (default: test PDF)
  --model <model>       Extraction model: gemini (only option)
  --run-id <id>         Custom run ID (default: auto-generated)
  --tolerance <percent> Coherence tolerance percentage (default: 5.0)
  --skip-boost          Skip boost processing
  --skip-coherence      Skip coherence checking
  --queue-id <id>       Extraction queue ID to process (for process-queue command)
  --env <name>          Environment name (default: dev)

Examples:
  node cli.js run --url "https://example.com/doc.pdf" --model gemini
  node cli.js test --model qwen3
  node cli.js process-queue --queue-id 123 --env dev
`);
  process.exit(0);
}

// Parse options
function getOption(name: string, defaultValue?: string): string | undefined {
  const index = args.findIndex(arg => arg === `--${name}`);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

if (command === 'run') {
  (async () => {
    const options = {
      url: getOption('url', CONFIG.testPdfUrl),
      model: 'gemini' as const, // Only Gemini 2.5 Pro supported
      runId: getOption('run-id'),
      tolerance: getOption('tolerance', '5.0'),
      skipBoost: hasFlag('skip-boost'),
      skipCoherence: hasFlag('skip-coherence')
    };
    try {
      // Validate configuration
      validateConfig();

      // Create logger
      const runId = options.runId || `run-${Date.now()}`;
      const logger = createLogger(runId);
      await logger.init();

      await logger.info('cli', 'Starting OCR King pipeline', {
        url: options.url,
        model: options.model,
        runId,
        options: {
          tolerance: parseFloat(options.tolerance!),
          skipBoost: options.skipBoost,
          skipCoherence: options.skipCoherence
        }
      });

      // Run pipeline
      const result = await runE2EPipeline({
        url: options.url!,
        extractionModel: options.model,
        runId,
        tolerancePercent: parseFloat(options.tolerance!),
        skipBoost: options.skipBoost,
        skipCoherence: options.skipCoherence,
        logger
      });

      // Print summary
      console.log('\n🎉 Pipeline completed successfully!');
      console.log(`📊 Processed ${result.document.totalPages} pages, extracted ${result.document.totalLines} lines`);
      console.log(`📁 Artifacts saved to: ${CONFIG.artifactsDir}/${runId}`);
      console.log(`📋 Summary report: ${result.artifactPaths.summaryReport}`);
      console.log(`📝 Logs: ${logger.getLogFile()}`);

      // Check for warnings
      const incompletePages = result.document.pages.filter((p: any) => !p.isCompleted);
      if (incompletePages.length > 0) {
        console.log(`⚠️  Warning: ${incompletePages.length} pages may have incomplete extractions`);
      }

      process.exit(0);

    } catch (error) {
      console.error('❌ Pipeline failed:', (error as Error).message);
      console.error('Stack trace:', (error as Error).stack);
      process.exit(1);
    }
  })();
} else if (command === 'test') {
  (async () => {
    const options = {
      model: 'gemini' as const, // Only Gemini 2.5 Pro supported
      url: getOption('url', CONFIG.testPdfUrl)
    };
    try {
      validateConfig();

      const runId = `test-${options.model}-${Date.now()}`;
      const logger = createLogger(runId);
      await logger.init();

      await logger.info('test', 'Starting E2E test', {
        model: options.model,
        url: options.url
      });

      const result = await runE2EPipeline({
        url: options.url!,
        extractionModel: options.model,
        runId,
        tolerancePercent: 5.0,
        skipBoost: true,      // Skip boost - Gemini extraction is sufficient
        skipCoherence: true,  // Skip Claude coherence check - avoids 5MB image limit
        logger
      });

      // Run test assertions
      await runTestAssertions(result, logger);

      console.log('\n✅ All tests passed!');
      console.log(`📁 Test artifacts: ${CONFIG.artifactsDir}/${runId}`);
      console.log(`📋 Test report: ${result.artifactPaths.summaryReport}`);

      process.exit(0);

    } catch (error) {
      console.error('❌ Test failed:', (error as Error).message);
      process.exit(1);
    }
  })();
} else if (command === 'process-queue') {
  (async () => {
    const queueId = getOption('queue-id');
    const environment = getOption('env', 'dev');

    if (!queueId) {
      console.error('❌ Error: --queue-id is required for process-queue command');
      console.log('\nUsage: node cli.js process-queue --queue-id <id> [--env <name>]');
      console.log('\nExample: node cli.js process-queue --queue-id 123 --env dev');
      process.exit(1);
    }

    try {
      // Import the processQueueDocument function
      const { processQueueDocument } = await import('./process-queue.js');

      console.log(`\n🔄 Processing extraction_queue document...`);
      console.log(`   Queue ID: ${queueId}`);
      console.log(`   Environment: ${environment}\n`);

      await processQueueDocument(parseInt(queueId), environment);

      console.log('\n✅ Document processed successfully!');
      process.exit(0);

    } catch (error) {
      console.error('❌ Processing failed:', (error as Error).message);
      console.error('Stack trace:', (error as Error).stack);
      process.exit(1);
    }
  })();
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

/**
 * Run test assertions
 */
async function runTestAssertions(result: any, logger: any): Promise<void> {
  await logger.info('test_assertions', 'Running test assertions');
  
  // Assertion 1: Pipeline completes without errors
  if (!result.document) {
    throw new Error('Pipeline did not produce a document');
  }
  
  // Assertion 2: For test PDF, page 3 and page 4 should have > 40 lines
  const page3 = result.document.pages.find((p: any) => p.page === 3);
  const page4 = result.document.pages.find((p: any) => p.page === 4);
  
  if (page3 && page3.lines.length <= 40) {
    throw new Error(`Page 3 assertion failed: expected > 40 lines, got ${page3.lines.length}`);
  }
  
  if (page4 && page4.lines.length <= 40) {
    throw new Error(`Page 4 assertion failed: expected > 40 lines, got ${page4.lines.length}`);
  }
  
  // Assertion 3: No page should have > 60 lines (max limit)
  for (const page of result.document.pages) {
    if (page.lines.length > CONFIG.maxLinesPerPage) {
      throw new Error(`Page ${page.page} exceeds max lines: ${page.lines.length} > ${CONFIG.maxLinesPerPage}`);
    }
  }
  
  await logger.success('test_assertions', 'All assertions passed', {
    page3Lines: page3?.lines.length || 0,
    page4Lines: page4?.lines.length || 0,
    maxLinesPerPage: CONFIG.maxLinesPerPage
  });
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// CLI is self-executing based on command parsing above

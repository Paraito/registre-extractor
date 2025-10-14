/**
 * API Rate Limit Configuration
 * 
 * Based on Tier 3 limits for Gemini and Claude APIs.
 * We use 80% of maximum limits as safe operating thresholds to prevent hitting limits.
 * 
 * References:
 * - Gemini: https://ai.google.dev/gemini-api/docs/rate-limits
 * - Claude: https://docs.anthropic.com/en/api/rate-limits
 */

export interface ModelRateLimits {
  rpm: number;      // Requests per minute
  tpm?: number;     // Total tokens per minute (Gemini)
  itpm?: number;    // Input tokens per minute (Claude)
  otpm?: number;    // Output tokens per minute (Claude)
}

export interface SafeRateLimits extends ModelRateLimits {
  safeRpm: number;
  safeTpm?: number;
  safeItpm?: number;
  safeOtpm?: number;
}

/**
 * Gemini 2.5 Pro - Tier 3 Rate Limits
 * Source: https://ai.google.dev/gemini-api/docs/rate-limits
 */
export const GEMINI_TIER_3_LIMITS: SafeRateLimits = {
  // Maximum limits
  rpm: 2000,
  tpm: 8_000_000,
  
  // Safe operating limits (80% of max to prevent hitting limits)
  safeRpm: 1600,
  safeTpm: 6_400_000,
};

/**
 * Claude Sonnet 3.5 - Tier 3 Rate Limits
 * Source: https://docs.anthropic.com/en/api/rate-limits
 */
export const CLAUDE_TIER_3_LIMITS: SafeRateLimits = {
  // Maximum limits
  rpm: 4000,
  itpm: 2_000_000,  // Input tokens per minute
  otpm: 400_000,    // Output tokens per minute (bottleneck!)
  
  // Safe operating limits (80% of max)
  safeRpm: 3200,
  safeItpm: 1_600_000,
  safeOtpm: 320_000,
};

/**
 * Stage-specific configuration for parallel processing
 */
export interface StageConfig {
  maxConcurrency: number;
  apiDelayMs: number;
  estimatedDurationMs: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  model: 'gemini' | 'claude';
}

/**
 * Line Counting Stage Configuration
 * - Uses Gemini 2.5 Pro only
 * - Fast operation (~2-3 seconds per page)
 * - Small token usage (~1K input, ~100 output)
 */
export const LINE_COUNT_CONFIG: StageConfig = {
  maxConcurrency: 10,           // 10 pages at once
  apiDelayMs: 500,              // 500ms stagger between starts
  estimatedDurationMs: 2500,    // ~2.5 seconds per request
  estimatedInputTokens: 1000,   // Image tokens
  estimatedOutputTokens: 100,   // Just a number
  model: 'gemini',
};

/**
 * Text Extraction Stage Configuration
 * - Uses Gemini 2.5 Pro
 * - Longer operation (~10-20 seconds per page)
 * - Large token usage (~10K input, ~5K output)
 */
export const EXTRACTION_CONFIG: StageConfig = {
  maxConcurrency: 6,            // 6 pages at once
  apiDelayMs: 2000,             // 2 second stagger
  estimatedDurationMs: 15000,   // ~15 seconds per request
  estimatedInputTokens: 10000,  // Image + prompt tokens
  estimatedOutputTokens: 5000,  // JSON response
  model: 'gemini',
};

/**
 * Boost Stage Configuration
 * - Uses Claude Sonnet 3.5
 * - Medium operation (~5-10 seconds per page)
 * - Medium token usage (~5K input, ~5K output)
 * - OTPM is the bottleneck (400K / 5K = 80 pages/minute max)
 */
export const BOOST_CONFIG: StageConfig = {
  maxConcurrency: 5,            // 5 pages at once
  apiDelayMs: 1000,             // 1 second stagger
  estimatedDurationMs: 8000,    // ~8 seconds per request
  estimatedInputTokens: 5000,   // JSON input
  estimatedOutputTokens: 5000,  // JSON output
  model: 'claude',
};

/**
 * Calculate theoretical throughput for a stage
 */
export function calculateThroughput(config: StageConfig): {
  pagesPerMinute: number;
  requestsPerSecond: number;
  tokensPerMinute: { input: number; output: number };
} {
  const requestsPerSecond = config.maxConcurrency / (config.apiDelayMs / 1000);
  const pagesPerMinute = (60 / (config.estimatedDurationMs / 1000)) * config.maxConcurrency;
  
  return {
    pagesPerMinute,
    requestsPerSecond,
    tokensPerMinute: {
      input: pagesPerMinute * config.estimatedInputTokens,
      output: pagesPerMinute * config.estimatedOutputTokens,
    },
  };
}

/**
 * Validate that a stage config doesn't exceed rate limits
 */
export function validateStageConfig(config: StageConfig): {
  valid: boolean;
  warnings: string[];
} {
  const limits = config.model === 'gemini' ? GEMINI_TIER_3_LIMITS : CLAUDE_TIER_3_LIMITS;
  const throughput = calculateThroughput(config);
  const warnings: string[] = [];
  
  // Check RPM
  const rpm = throughput.requestsPerSecond * 60;
  if (rpm > limits.safeRpm) {
    warnings.push(
      `RPM (${rpm.toFixed(0)}) exceeds safe limit (${limits.safeRpm})`
    );
  }
  
  // Check token limits
  if (config.model === 'gemini' && limits.safeTpm) {
    const totalTpm = throughput.tokensPerMinute.input + throughput.tokensPerMinute.output;
    if (totalTpm > limits.safeTpm) {
      warnings.push(
        `TPM (${totalTpm.toFixed(0)}) exceeds safe limit (${limits.safeTpm})`
      );
    }
  }
  
  if (config.model === 'claude') {
    if (limits.safeItpm && throughput.tokensPerMinute.input > limits.safeItpm) {
      warnings.push(
        `ITPM (${throughput.tokensPerMinute.input.toFixed(0)}) exceeds safe limit (${limits.safeItpm})`
      );
    }
    if (limits.safeOtpm && throughput.tokensPerMinute.output > limits.safeOtpm) {
      warnings.push(
        `OTPM (${throughput.tokensPerMinute.output.toFixed(0)}) exceeds safe limit (${limits.safeOtpm})`
      );
    }
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Print throughput analysis for all stages
 */
export function printThroughputAnalysis(): void {
  console.log('\n📊 OCR Pipeline Throughput Analysis (Tier 3 Limits)\n');
  console.log('═'.repeat(80));
  
  const stages = [
    { name: 'Line Counting', config: LINE_COUNT_CONFIG },
    { name: 'Text Extraction', config: EXTRACTION_CONFIG },
    { name: 'Boost', config: BOOST_CONFIG },
  ];
  
  for (const { name, config } of stages) {
    const throughput = calculateThroughput(config);
    const validation = validateStageConfig(config);
    const limits = config.model === 'gemini' ? GEMINI_TIER_3_LIMITS : CLAUDE_TIER_3_LIMITS;
    
    console.log(`\n${name} (${config.model.toUpperCase()})`);
    console.log('─'.repeat(80));
    console.log(`  Concurrency: ${config.maxConcurrency} pages`);
    console.log(`  Stagger: ${config.apiDelayMs}ms`);
    console.log(`  Duration: ${config.estimatedDurationMs}ms per page`);
    console.log(`\n  Throughput:`);
    console.log(`    ${throughput.pagesPerMinute.toFixed(1)} pages/minute`);
    console.log(`    ${throughput.requestsPerSecond.toFixed(1)} requests/second`);
    console.log(`    ${(throughput.requestsPerSecond * 60).toFixed(0)} RPM (limit: ${limits.safeRpm})`);
    
    if (config.model === 'gemini') {
      const totalTpm = throughput.tokensPerMinute.input + throughput.tokensPerMinute.output;
      console.log(`    ${totalTpm.toFixed(0)} TPM (limit: ${limits.safeTpm})`);
    } else {
      console.log(`    ${throughput.tokensPerMinute.input.toFixed(0)} ITPM (limit: ${limits.safeItpm})`);
      console.log(`    ${throughput.tokensPerMinute.output.toFixed(0)} OTPM (limit: ${limits.safeOtpm})`);
    }
    
    if (!validation.valid) {
      console.log(`\n  ⚠️  WARNINGS:`);
      validation.warnings.forEach(w => console.log(`    - ${w}`));
    } else {
      console.log(`\n  ✅ Within safe limits`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('\n💡 Estimated time for 10-page document:');
  console.log(`  Line Counting: ${(10 / calculateThroughput(LINE_COUNT_CONFIG).pagesPerMinute).toFixed(1)} minutes`);
  console.log(`  Extraction: ${(10 / calculateThroughput(EXTRACTION_CONFIG).pagesPerMinute).toFixed(1)} minutes`);
  console.log(`  Boost: ${(10 / calculateThroughput(BOOST_CONFIG).pagesPerMinute).toFixed(1)} minutes`);
  console.log(`  TOTAL: ~${(
    10 / calculateThroughput(LINE_COUNT_CONFIG).pagesPerMinute +
    10 / calculateThroughput(EXTRACTION_CONFIG).pagesPerMinute +
    10 / calculateThroughput(BOOST_CONFIG).pagesPerMinute
  ).toFixed(1)} minutes\n`);
}


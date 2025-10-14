#!/usr/bin/env tsx
/**
 * Throughput Analysis Tool
 * 
 * Analyzes and validates the OCR pipeline throughput configuration
 * against Tier 3 rate limits for Gemini and Claude APIs.
 * 
 * Usage:
 *   npm run analyze-throughput
 *   or
 *   tsx scripts/analyze-throughput.ts
 */

import { printThroughputAnalysis } from '../config/rate-limits.js';

printThroughputAnalysis();


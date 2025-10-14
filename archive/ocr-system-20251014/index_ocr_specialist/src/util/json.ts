/**
 * JSON Schema Validation and Type Definitions
 * 
 * Defines TypeScript schemas for pipeline data structures
 * and provides validation utilities.
 */

import { z } from 'zod';

/**
 * Line Count Result Schema
 */
export const LineCountResultSchema = z.object({
  page: z.number().int().positive(),
  lineCount: z.number().int().min(0),
  model: z.enum(['gemini', 'claude']),
  confidence: z.number().min(0).max(1),
  countingMethod: z.string().optional(),
  tableBoundaries: z.object({
    firstLineDescription: z.string(),
    lastLineDescription: z.string()
  }).optional()
});

export type LineCountResult = z.infer<typeof LineCountResultSchema>;

/**
 * Extracted Line Schema
 */
export const ExtractedLineSchema = z.object({
  index: z.number().int().positive(),
  party: z.string(),
  nature: z.string(),
  date: z.string().nullable().optional(),
  publicationNo: z.string().nullable().optional(),
  radiation: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  rawLine: z.string().optional()
});

export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;

/**
 * Page Extraction Schema
 */
export const PageExtractionSchema = z.object({
  page: z.number().int().positive(),
  lines: z.array(ExtractedLineSchema),
  isCompleted: z.boolean(),
  totalLinesDetected: z.number().int().min(0).optional(),
  extractionWindows: z.array(z.object({
    start: z.number().int().min(1),
    end: z.number().int().min(1),
    model: z.enum(['gemini', 'claude', 'failed']),
    linesExtracted: z.number().int().min(0)
  })).optional(),
  coherenceCheck: z.object({
    status: z.enum(['COMPLETE', 'INCOMPLETE', 'OVER_EXTRACTED', 'UNCERTAIN']),
    confidence: z.number().min(0).max(1),
    recommendation: z.enum(['ACCEPT_AS_IS', 'RETRY_EXTRACTION', 'MANUAL_REVIEW']),
    explanation: z.string()
  }).optional()
});

export type PageExtraction = z.infer<typeof PageExtractionSchema>;

/**
 * Document Extraction Schema
 */
export const DocumentExtractionSchema = z.object({
  pages: z.array(PageExtractionSchema),
  sourceUrl: z.string().url(),
  createdAt: z.string().datetime(),
  runId: z.string(),
  totalPages: z.number().int().positive(),
  totalLines: z.number().int().min(0),
  processingTimeMs: z.number().int().min(0),
  models: z.object({
    lineCount: z.array(z.enum(['gemini', 'claude'])),
    extraction: z.enum(['gemini', 'claude']),
    coherenceCheck: z.enum(['claude']),
    boost: z.enum(['claude'])
  })
});

export type DocumentExtraction = z.infer<typeof DocumentExtractionSchema>;

/**
 * Consensus Result Schema
 */
export const ConsensusResultSchema = z.object({
  page: z.number().int().positive(),
  geminiCount: z.number().int().min(0),
  claudeCount: z.number().int().min(0),
  consensusCount: z.number().int().min(0),
  consensusRule: z.enum(['higher', 'lower', 'average']),
  confidence: z.number().min(0).max(1)
});

export type ConsensusResult = z.infer<typeof ConsensusResultSchema>;

/**
 * Pipeline Stage Result Schema
 */
export const PipelineStageResultSchema = z.object({
  stage: z.string(),
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  durationMs: z.number().int().min(0),
  page: z.number().int().positive().optional()
});

export type PipelineStageResult = z.infer<typeof PipelineStageResultSchema>;

/**
 * Validation utilities
 */
export class ValidationError extends Error {
  constructor(message: string, public issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a schema
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      `Validation failed: ${result.error.issues.map(i => i.message).join(', ')}`,
      result.error.issues
    );
  }
  return result.data;
}

/**
 * Parse JSON with validation
 */
export function parseJSON<T>(schema: z.ZodSchema<T>, jsonString: string): T {
  try {
    const data = JSON.parse(jsonString);
    return validate(schema, data);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Safe JSON parsing with fallback
 */
export function safeParseJSON(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    // Try to extract JSON from text that might have extra content
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through to return null
      }
    }
    return null;
  }
}

/**
 * Coerce data to match schema (with best effort)
 */
export function coerceToSchema<T>(schema: z.ZodSchema<T>, data: any): T | null {
  try {
    return validate(schema, data);
  } catch (error) {
    // Try basic coercion for common issues
    if (typeof data === 'object' && data !== null) {
      // Convert string numbers to numbers
      const coerced = { ...data };
      for (const [key, value] of Object.entries(coerced)) {
        if (typeof value === 'string' && !isNaN(Number(value))) {
          coerced[key] = Number(value);
        }
      }
      
      try {
        return validate(schema, coerced);
      } catch {
        return null;
      }
    }
    return null;
  }
}

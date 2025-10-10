/**
 * OCR Module for Quebec Land Registry Index Documents
 *
 * This module provides OCR processing capabilities using Google's Gemini AI
 * with specialized prompts and boost rules for Quebec land registry documents.
 */

export { GeminiOCRClient, GeminiOCRConfig, OCRExtractionResult, OCRBoostResult } from './gemini-client';
export { PDFConverter, PDFToImageOptions, ConversionResult, MultiPageConversionResult } from './pdf-converter';
export { OCRProcessor, OCRProcessorConfig, OCRResult, PageOCRResult, MultiPageOCRResult } from './processor';
export { OCRMonitor, OCRMonitorConfig } from './monitor';
export { StaleOCRMonitor, staleOCRMonitor } from './stale-ocr-monitor';
export { OCRLogger } from './ocr-logger';
export { EXTRACT_PROMPT, BOOST_PROMPT } from './prompts';


/**
 * OCR Module for Quebec Land Registry Documents
 *
 * This module provides OCR processing capabilities using Google's Gemini AI
 * with specialized prompts and boost rules for Quebec land registry documents.
 *
 * Supports:
 * - Index documents (using Vision API with PDF to image conversion)
 * - Acte documents (using File API for direct PDF processing)
 */

export { GeminiOCRClient, GeminiOCRConfig, OCRExtractionResult, OCRBoostResult } from './gemini-client';
export { GeminiFileClient, GeminiFileClientConfig, FileUploadResult, FileProcessingStatus, OCRFileExtractionResult } from './gemini-file-client';
export { PDFConverter, PDFToImageOptions, ConversionResult, MultiPageConversionResult } from './pdf-converter';
export { OCRProcessor, OCRProcessorConfig, OCRResult, PageOCRResult, MultiPageOCRResult } from './processor';
export { ActeOCRProcessor, ActeOCRProcessorConfig, ActeOCRResult } from './acte-processor';
export { OCRMonitor, OCRMonitorConfig } from './monitor';
export { StaleOCRMonitor, staleOCRMonitor } from './stale-ocr-monitor';
export { OCRLogger } from './ocr-logger';
export { EXTRACT_PROMPT, BOOST_PROMPT } from './prompts';
export { ACTE_EXTRACT_PROMPT, ACTE_BOOST_PROMPT } from './prompts-acte';


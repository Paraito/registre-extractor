# Parallel OCR Processing

This document explains how to use the parallel OCR processing capabilities to efficiently process multi-page PDF documents.

## Overview

The OCR processor now supports parallel processing of multi-page PDFs, which significantly improves performance when dealing with documents that have multiple pages. Instead of processing pages sequentially, all pages are:

1. **Converted to images in parallel** - All PDF pages are converted simultaneously
2. **OCR extracted in parallel** - Text extraction happens concurrently for all pages
3. **Boosted in parallel** - Correction rules are applied to all pages at once

## Performance Benefits

For a 5-page document, parallel processing can provide:
- **~5x faster processing** compared to sequential processing
- **Better resource utilization** by leveraging concurrent API calls
- **Reduced total processing time** from minutes to seconds

## API Reference

### New Methods

#### `processPDFParallel(pdfPath: string): Promise<MultiPageOCRResult>`

Process all pages of a PDF in parallel.

```typescript
const result = await processor.processPDFParallel('/path/to/document.pdf');

console.log(`Processed ${result.totalPages} pages`);
console.log(`Combined text: ${result.combinedBoostedText}`);

// Access individual pages
result.pages.forEach(page => {
  console.log(`Page ${page.pageNumber}: ${page.boostedText}`);
});
```

#### `processPDFFromURLParallel(url: string): Promise<MultiPageOCRResult>`

Download and process a PDF from a URL in parallel.

```typescript
const result = await processor.processPDFFromURLParallel(
  'https://example.com/document.pdf'
);
```

#### `processPDFFromBase64Parallel(base64Data: string): Promise<MultiPageOCRResult>`

Process a PDF from base64 data in parallel.

```typescript
const result = await processor.processPDFFromBase64Parallel(base64String);
```

### Return Types

#### `MultiPageOCRResult`

```typescript
interface MultiPageOCRResult {
  pages: PageOCRResult[];           // Individual page results
  totalPages: number;                // Total number of pages processed
  combinedRawText: string;           // All raw text combined
  combinedBoostedText: string;       // All boosted text combined
  allPagesComplete: boolean;         // True if all pages completed successfully
}
```

#### `PageOCRResult`

```typescript
interface PageOCRResult {
  pageNumber: number;                // Page number (1-indexed)
  rawText: string;                   // Raw extracted text
  boostedText: string;               // Text after boost corrections
  extractionComplete: boolean;       // Extraction completion status
  boostComplete: boolean;            // Boost completion status
}
```

## Usage Examples

### Basic Parallel Processing

```typescript
import { OCRProcessor } from './ocr';

const processor = new OCRProcessor({
  geminiApiKey: process.env.GEMINI_API_KEY,
  extractModel: 'gemini-2.0-flash-exp',
  boostModel: 'gemini-2.5-pro'
});

await processor.initialize();

// Process all pages in parallel
const result = await processor.processPDFParallel('/path/to/document.pdf');

console.log(`Total pages: ${result.totalPages}`);
console.log(`All complete: ${result.allPagesComplete}`);

// Save combined result
await fs.writeFile('output.txt', result.combinedBoostedText);
```

### Processing Individual Pages

```typescript
const result = await processor.processPDFParallel('/path/to/document.pdf');

// Process each page separately
for (const page of result.pages) {
  console.log(`\n=== Page ${page.pageNumber} ===`);
  console.log(page.boostedText);
  
  // Save each page to a separate file
  await fs.writeFile(
    `page-${page.pageNumber}.txt`,
    page.boostedText
  );
}
```

### Error Handling

```typescript
const result = await processor.processPDFParallel('/path/to/document.pdf');

// Check for incomplete pages
const incompletPages = result.pages.filter(
  p => !p.extractionComplete || !p.boostComplete
);

if (incompletPages.length > 0) {
  console.warn(`Incomplete pages: ${incompletPages.map(p => p.pageNumber).join(', ')}`);
  
  // Use only complete pages
  const completeText = result.pages
    .filter(p => p.extractionComplete && p.boostComplete)
    .map(p => p.boostedText)
    .join('\n\n');
}
```

### Performance Comparison

```typescript
// Sequential processing (backward compatible)
const startSeq = Date.now();
const seqResult = await processor.processPDF('/path/to/document.pdf');
const seqTime = Date.now() - startSeq;

// Parallel processing
const startPar = Date.now();
const parResult = await processor.processPDFParallel('/path/to/document.pdf');
const parTime = Date.now() - startPar;

console.log(`Sequential: ${seqTime}ms for 1 page`);
console.log(`Parallel: ${parTime}ms for ${parResult.totalPages} pages`);
console.log(`Speedup: ${((seqTime * parResult.totalPages) / parTime).toFixed(2)}x`);
```

## Backward Compatibility

All existing methods remain unchanged:

- `processPDF()` - Still processes only the first page
- `processPDFFromURL()` - Still processes only the first page
- `processPDFFromBase64()` - Still processes only the first page

To use parallel processing, explicitly call the `*Parallel` variants.

## Configuration

The parallel processing uses the same configuration as sequential processing:

```typescript
const processor = new OCRProcessor({
  geminiApiKey: 'your-api-key',
  tempDir: '/tmp/ocr-processing',
  extractModel: 'gemini-2.0-flash-exp',  // Fast model for extraction
  boostModel: 'gemini-2.5-pro',          // Accurate model for boost
  extractTemperature: 0.1,
  boostTemperature: 0.2
});
```

## Technical Details

### PDF Conversion

The `PDFConverter` now includes:

- `getPageCount()` - Detects number of pages using `pdfinfo` or ImageMagick
- `convertAllPagesToImages()` - Converts all pages in parallel
- `convertPageToImage()` - Converts a specific page

### Parallel Execution

The processor uses `Promise.all()` to execute OCR operations concurrently:

```typescript
// All pages are processed simultaneously
const pageResults = await Promise.all(
  pages.map(page => this.processPage(page.pageNumber, page.base64Data, page.mimeType))
);
```

### Resource Management

- Temporary image files are created for each page
- All temporary files are cleaned up after processing
- Memory usage scales with the number of pages

## Best Practices

1. **Use parallel processing for multi-page documents** - Significant performance gains
2. **Use sequential processing for single-page documents** - Simpler API, same performance
3. **Monitor memory usage** - Large documents with many pages may require more memory
4. **Check completion status** - Always verify `allPagesComplete` before using results
5. **Handle errors gracefully** - Individual pages may fail; check each page's status

## Limitations

- Requires `pdfinfo` (from poppler-utils) or ImageMagick for page counting
- Memory usage increases with document size
- API rate limits may apply for concurrent requests
- Very large documents (100+ pages) may need batching

## Migration Guide

### From Sequential to Parallel

**Before:**
```typescript
const result = await processor.processPDF(pdfPath);
console.log(result.boostedText);
```

**After:**
```typescript
const result = await processor.processPDFParallel(pdfPath);
console.log(result.combinedBoostedText);

// Or access individual pages
result.pages.forEach(page => {
  console.log(`Page ${page.pageNumber}: ${page.boostedText}`);
});
```

## See Also

- [Main OCR README](./README.md) - General OCR documentation
- [Examples](./examples/parallel-processing-example.ts) - Complete working examples
- [API Reference](./index.ts) - Full API documentation


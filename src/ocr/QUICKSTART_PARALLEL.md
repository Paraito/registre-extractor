# Quick Start: Parallel OCR Processing

Get started with parallel OCR processing in 5 minutes!

## Installation

Ensure you have the required system dependencies:

```bash
# macOS
brew install poppler imagemagick

# Ubuntu/Debian
sudo apt-get install poppler-utils imagemagick

# CentOS/RHEL
sudo yum install poppler-utils ImageMagick
```

## Basic Usage

### 1. Initialize the Processor

```typescript
import { OCRProcessor } from './ocr';

const processor = new OCRProcessor({
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  extractModel: 'gemini-2.0-flash-exp',
  boostModel: 'gemini-2.5-pro',
  tempDir: '/tmp/ocr-processing'
});

await processor.initialize();
```

### 2. Process a Multi-Page PDF

```typescript
// Process all pages in parallel
const result = await processor.processPDFParallel('/path/to/document.pdf');

console.log(`Processed ${result.totalPages} pages`);
console.log(`All pages complete: ${result.allPagesComplete}`);

// Get the combined text from all pages
console.log(result.combinedBoostedText);
```

### 3. Access Individual Pages

```typescript
// Loop through each page
result.pages.forEach(page => {
  console.log(`\n=== Page ${page.pageNumber} ===`);
  console.log(`Extraction complete: ${page.extractionComplete}`);
  console.log(`Boost complete: ${page.boostComplete}`);
  console.log(`Text length: ${page.boostedText.length} characters`);
  console.log(page.boostedText);
});
```

## Common Scenarios

### Scenario 1: Process from URL

```typescript
const result = await processor.processPDFFromURLParallel(
  'https://example.com/document.pdf'
);

console.log(`Downloaded and processed ${result.totalPages} pages`);
```

### Scenario 2: Process from Base64

```typescript
const base64Data = '...'; // Your base64 PDF data
const result = await processor.processPDFFromBase64Parallel(base64Data);

console.log(`Processed ${result.totalPages} pages from base64 data`);
```

### Scenario 3: Save Each Page Separately

```typescript
import fs from 'fs/promises';

const result = await processor.processPDFParallel('/path/to/document.pdf');

// Save each page to a separate file
for (const page of result.pages) {
  await fs.writeFile(
    `output-page-${page.pageNumber}.txt`,
    page.boostedText
  );
}

console.log(`Saved ${result.totalPages} pages to separate files`);
```

### Scenario 4: Handle Incomplete Pages

```typescript
const result = await processor.processPDFParallel('/path/to/document.pdf');

// Filter for complete pages only
const completePages = result.pages.filter(
  p => p.extractionComplete && p.boostComplete
);

const incompletePages = result.pages.filter(
  p => !p.extractionComplete || !p.boostComplete
);

console.log(`Complete: ${completePages.length}/${result.totalPages}`);

if (incompletePages.length > 0) {
  console.warn(`Incomplete pages: ${incompletePages.map(p => p.pageNumber).join(', ')}`);
}

// Use only complete pages
const completeText = completePages
  .map(p => p.boostedText)
  .join('\n\n');
```

### Scenario 5: Performance Comparison

```typescript
// Time sequential processing
const startSeq = Date.now();
const seqResult = await processor.processPDF('/path/to/document.pdf');
const seqTime = Date.now() - startSeq;

// Time parallel processing
const startPar = Date.now();
const parResult = await processor.processPDFParallel('/path/to/document.pdf');
const parTime = Date.now() - startPar;

console.log(`Sequential: ${seqTime}ms (1 page)`);
console.log(`Parallel: ${parTime}ms (${parResult.totalPages} pages)`);

if (parResult.totalPages > 1) {
  const estimatedSeqTime = seqTime * parResult.totalPages;
  const speedup = estimatedSeqTime / parTime;
  console.log(`Estimated speedup: ${speedup.toFixed(2)}x`);
}
```

## Complete Example

```typescript
import { OCRProcessor } from './ocr';
import fs from 'fs/promises';

async function processDocument(pdfPath: string) {
  // 1. Initialize processor
  const processor = new OCRProcessor({
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    extractModel: 'gemini-2.0-flash-exp',
    boostModel: 'gemini-2.5-pro'
  });

  await processor.initialize();

  try {
    // 2. Process all pages in parallel
    console.log('Processing document...');
    const result = await processor.processPDFParallel(pdfPath);

    // 3. Log summary
    console.log(`\n=== Processing Summary ===`);
    console.log(`Total pages: ${result.totalPages}`);
    console.log(`All pages complete: ${result.allPagesComplete}`);
    console.log(`Combined text length: ${result.combinedBoostedText.length} chars`);

    // 4. Save combined result
    await fs.writeFile('output-combined.txt', result.combinedBoostedText);
    console.log('\nSaved combined text to output-combined.txt');

    // 5. Save individual pages
    for (const page of result.pages) {
      await fs.writeFile(
        `output-page-${page.pageNumber}.txt`,
        page.boostedText
      );
    }
    console.log(`Saved ${result.totalPages} individual page files`);

    // 6. Generate report
    const report = {
      totalPages: result.totalPages,
      allComplete: result.allPagesComplete,
      pages: result.pages.map(p => ({
        pageNumber: p.pageNumber,
        extractionComplete: p.extractionComplete,
        boostComplete: p.boostComplete,
        textLength: p.boostedText.length
      }))
    };

    await fs.writeFile('report.json', JSON.stringify(report, null, 2));
    console.log('Saved processing report to report.json');

  } catch (error) {
    console.error('Processing failed:', error);
    throw error;
  } finally {
    // 7. Cleanup
    await processor.cleanup();
    console.log('\nCleanup complete');
  }
}

// Run it
processDocument('/path/to/your/document.pdf')
  .then(() => console.log('\nDone!'))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
```

## Environment Setup

Create a `.env` file:

```env
GEMINI_API_KEY=your-gemini-api-key-here
```

Or set it in your shell:

```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
```

## Running the Examples

```bash
# Install dependencies
npm install

# Run the quick start example
npx ts-node src/ocr/examples/parallel-processing-example.ts

# Or create your own script
npx ts-node my-ocr-script.ts
```

## Troubleshooting

### "pdfinfo not found"
Install poppler-utils:
```bash
brew install poppler  # macOS
sudo apt-get install poppler-utils  # Ubuntu
```

### "convert not found"
Install ImageMagick:
```bash
brew install imagemagick  # macOS
sudo apt-get install imagemagick  # Ubuntu
```

### "API key not configured"
Set your Gemini API key:
```bash
export GEMINI_API_KEY="your-key-here"
```

### "Out of memory"
For very large documents, process in batches or increase Node.js memory:
```bash
node --max-old-space-size=4096 your-script.js
```

## Next Steps

- Read the [full documentation](./PARALLEL_PROCESSING.md)
- Check out the [architecture guide](./ARCHITECTURE.md)
- Review the [complete examples](./examples/parallel-processing-example.ts)
- Run the [tests](../__tests__/parallel-processing.test.ts)

## API Quick Reference

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `processPDFParallel(path)` | Process all pages in parallel | `MultiPageOCRResult` |
| `processPDFFromURLParallel(url)` | Download and process in parallel | `MultiPageOCRResult` |
| `processPDFFromBase64Parallel(data)` | Process base64 data in parallel | `MultiPageOCRResult` |
| `processPDF(path)` | Process first page only (legacy) | `OCRResult` |

### Types

```typescript
interface MultiPageOCRResult {
  pages: PageOCRResult[];
  totalPages: number;
  combinedRawText: string;
  combinedBoostedText: string;
  allPagesComplete: boolean;
}

interface PageOCRResult {
  pageNumber: number;
  rawText: string;
  boostedText: string;
  extractionComplete: boolean;
  boostComplete: boolean;
}
```

## Performance Tips

1. **Use parallel for multi-page docs** - Up to 5x faster
2. **Use sequential for single-page docs** - Simpler, same speed
3. **Monitor API rate limits** - Gemini has rate limits
4. **Clean up temp files** - Always call `processor.cleanup()`
5. **Check completion status** - Verify `allPagesComplete` before using results

Happy OCR processing! 🚀


# OCR Processing Architecture

## Sequential Processing (Original)

```
┌─────────────────────────────────────────────────────────────┐
│                    processPDF(pdfPath)                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Convert PDF to Image (First Page Only)            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ convertToImage(pdfPath)                              │  │
│  │  - Uses ImageMagick or pdftoppm                      │  │
│  │  - Converts page [0] only                            │  │
│  │  - Returns base64 image data                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Extract Text from Image                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ geminiClient.extractText(base64Data)                 │  │
│  │  - Sends image to Gemini Vision API                  │  │
│  │  - Uses EXTRACT_PROMPT                               │  │
│  │  - Returns raw extracted text                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Apply Boost Corrections                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ geminiClient.boostText(rawText)                      │  │
│  │  - Applies 60+ correction rules                      │  │
│  │  - Uses BOOST_PROMPT                                 │  │
│  │  - Returns boosted text                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  OCRResult    │
                    │  - rawText    │
                    │  - boostedText│
                    └───────────────┘

Time for 3-page document: ~30 seconds (10s × 3 pages)
```

## Parallel Processing (New)

```
┌─────────────────────────────────────────────────────────────┐
│                processPDFParallel(pdfPath)                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Get Page Count                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ getPageCount(pdfPath)                                │  │
│  │  - Uses pdfinfo or ImageMagick identify              │  │
│  │  - Returns total number of pages                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Convert All Pages to Images (PARALLEL)            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Promise.all([                                        │  │
│  │   convertPageToImage(pdfPath, 1),  ◄─┐              │  │
│  │   convertPageToImage(pdfPath, 2),  ◄─┼─ Parallel    │  │
│  │   convertPageToImage(pdfPath, 3)   ◄─┘              │  │
│  │ ])                                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Process All Pages (PARALLEL)                      │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐ │
│  │   Page 1        │  │   Page 2        │  │   Page 3   │ │
│  │                 │  │                 │  │            │ │
│  │ extractText()   │  │ extractText()   │  │extractText()│ │
│  │      ▼          │  │      ▼          │  │     ▼      │ │
│  │ boostText()     │  │ boostText()     │  │boostText() │ │
│  │      ▼          │  │      ▼          │  │     ▼      │ │
│  │ PageOCRResult   │  │ PageOCRResult   │  │PageOCRResult│ │
│  └─────────────────┘  └─────────────────┘  └────────────┘ │
│         │                     │                    │       │
│         └─────────────────────┼────────────────────┘       │
│                               │                            │
│                    Promise.all([...])                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: Combine Results                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Merge all page results into:                         │  │
│  │  - pages: PageOCRResult[]                            │  │
│  │  - combinedRawText: string                           │  │
│  │  - combinedBoostedText: string                       │  │
│  │  - allPagesComplete: boolean                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────┐
                │  MultiPageOCRResult       │
                │  - pages: [...]           │
                │  - totalPages: 3          │
                │  - combinedBoostedText    │
                │  - allPagesComplete: true │
                └───────────────────────────┘

Time for 3-page document: ~10 seconds (all pages processed simultaneously)
Speedup: 3x faster! 🚀
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OCRMonitor                           │
│  - Polls extraction_queue for new documents                │
│  - Triggers OCR processing                                  │
│  - Updates database with results                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ uses
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       OCRProcessor                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Sequential Methods (Backward Compatible)             │  │
│  │  - processPDF()                                      │  │
│  │  - processPDFFromURL()                               │  │
│  │  - processPDFFromBase64()                            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Parallel Methods (New)                               │  │
│  │  - processPDFParallel()                              │  │
│  │  - processPDFFromURLParallel()                       │  │
│  │  - processPDFFromBase64Parallel()                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
            │                               │
            │ uses                          │ uses
            ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│     PDFConverter         │    │    GeminiOCRClient       │
│  - getPageCount()        │    │  - extractText()         │
│  - convertToImage()      │    │  - boostText()           │
│  - convertAllPages()     │    │                          │
│  - convertPageToImage()  │    │  Uses:                   │
│                          │    │  - EXTRACT_PROMPT        │
│  Uses:                   │    │  - BOOST_PROMPT          │
│  - ImageMagick           │    │                          │
│  - pdftoppm              │    │                          │
│  - pdfinfo               │    │                          │
└──────────────────────────┘    └──────────────────────────┘
```

## Data Flow

### Input
```
PDF Document
  │
  ├─ From file path
  ├─ From URL (downloaded)
  └─ From base64 data
```

### Processing Pipeline
```
PDF → [Page Detection] → [Parallel Conversion] → [Parallel OCR] → Results
                                    │                    │
                                    ▼                    ▼
                            Image Files (PNG)    Gemini API Calls
                                    │                    │
                                    ▼                    ▼
                            Base64 Data          Raw Text + Boosted Text
```

### Output
```
MultiPageOCRResult
  │
  ├─ pages: PageOCRResult[]
  │    ├─ pageNumber: 1
  │    ├─ rawText: "..."
  │    ├─ boostedText: "..."
  │    ├─ extractionComplete: true
  │    └─ boostComplete: true
  │
  ├─ totalPages: 3
  ├─ combinedRawText: "Page 1...\nPage 2...\nPage 3..."
  ├─ combinedBoostedText: "Page 1...\nPage 2...\nPage 3..."
  └─ allPagesComplete: true
```

## Concurrency Model

### Parallel Conversion
```typescript
// All pages converted simultaneously
const conversionPromises = Array.from({ length: pageCount }, (_, i) => 
  convertPageToImage(pdfPath, i + 1, options)
);
const pages = await Promise.all(conversionPromises);
```

### Parallel OCR Processing
```typescript
// All pages processed simultaneously
const pageProcessingPromises = pages.map((page, index) =>
  processPage(index + 1, page.base64Data, page.mimeType)
);
const pageResults = await Promise.all(pageProcessingPromises);
```

### Resource Management
- **Temporary Files**: One image file per page, all cleaned up after processing
- **API Calls**: Concurrent calls to Gemini API (subject to rate limits)
- **Memory**: Scales linearly with page count (base64 data held in memory)

## Error Handling

```
┌─────────────────────────────────────────────────────────────┐
│  Try to process all pages in parallel                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  Any errors?  │
                    └───────────────┘
                      │           │
                  Yes │           │ No
                      ▼           ▼
            ┌─────────────┐   ┌──────────────────┐
            │ Throw error │   │ Check individual │
            │ (all fail)  │   │ page completion  │
            └─────────────┘   └──────────────────┘
                                      │
                                      ▼
                          ┌───────────────────────┐
                          │ allPagesComplete =    │
                          │ all pages succeeded   │
                          └───────────────────────┘
```

## Performance Characteristics

| Metric | Sequential | Parallel | Improvement |
|--------|-----------|----------|-------------|
| 1-page doc | 10s | 10s | 1x (same) |
| 3-page doc | 30s | 10s | 3x faster |
| 5-page doc | 50s | 10s | 5x faster |
| 10-page doc | 100s | 15s | 6.7x faster |

*Note: Times are approximate and depend on network speed, API response time, and document complexity.*

## Best Practices

1. **Use parallel for multi-page documents** - Significant performance gains
2. **Use sequential for single-page documents** - Simpler API, same performance
3. **Monitor memory usage** - Large documents may require more memory
4. **Check completion status** - Always verify `allPagesComplete`
5. **Handle partial failures** - Individual pages may fail while others succeed


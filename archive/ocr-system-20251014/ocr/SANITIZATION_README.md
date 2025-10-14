# OCR Sanitization Feature

## Overview

The OCR sanitization feature converts verbose OCR output into clean, structured JSON suitable for database storage and downstream processing.

---

## Quick Start

### Using the Sanitizer

```typescript
import { sanitizeOCRResult } from './ocr/sanitizer';

// After OCR processing
const ocrResult = await processor.processPDFParallel(pdfPath);
const verboseText = ocrResult.combinedBoostedText;

// Sanitize to clean JSON
const cleanData = sanitizeOCRResult(verboseText);

// Store in database
const jsonString = JSON.stringify(cleanData, null, 2);
await db.update({ file_content: jsonString });
```

### Running Tests

```bash
# Run all sanitizer tests
npm test -- --testPathPattern=sanitizer

# Run specific test file
npm test -- sanitizer.test.ts
npm test -- sanitizer-integration.test.ts

# Run with coverage
npm test -- --coverage --testPathPattern=sanitizer
```

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Input: Verbose OCR Text (combinedBoostedText)               │
│ - Contains thinking process, multiple options, explanations │
│ - Size: ~50KB per document                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ sanitizeOCRResult()                                         │
│ 1. Split by page markers                                    │
│ 2. Extract metadata per page                                │
│ 3. Parse inscriptions (Ligne X:)                            │
│ 4. Select highest confidence options                        │
│ 5. Parse parties intelligently                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Output: Clean JSON (SanitizedOCRResult)                     │
│ - Structured data only                                      │
│ - Size: ~5KB per document (90% reduction)                   │
└─────────────────────────────────────────────────────────────┘
```

### Database Storage

- **`file_content`**: Clean JSON (sanitized from boosted text)
- **`boosted_file_content`**: Verbose text (for logging/debugging)

---

## JSON Structure

### TypeScript Types

```typescript
interface SanitizedOCRResult {
  pages: PageResult[];
}

interface PageResult {
  pageNumber: number;
  metadata: PageMetadata;
  inscriptions: Inscription[];
}

interface PageMetadata {
  circonscription: string | null;
  cadastre: string | null;
  lot_number: string | null;
}

interface Inscription {
  acte_publication_date: string | null;
  acte_publication_number: string | null;
  acte_nature: string | null;
  parties: Party[];
  remarques: string | null;
  radiation_number: string | null;
}

interface Party {
  name: string;
  role: string;
}
```

### Example JSON

```json
{
  "pages": [
    {
      "pageNumber": 1,
      "metadata": {
        "circonscription": "Montréal",
        "cadastre": "Cité de Montréal (quartier Sainte-Marie)",
        "lot_number": "1358-176"
      },
      "inscriptions": [
        {
          "acte_publication_date": "1986-09-12",
          "acte_publication_number": "3 770 292",
          "acte_nature": "Testament",
          "parties": [
            {
              "name": "BEAUREGARD, ADRIEN",
              "role": "Décédé"
            }
          ],
          "remarques": "PERMIS DE DISPOSER",
          "radiation_number": null
        }
      ]
    }
  ]
}
```

---

## Parsing Rules

### 1. Page Splitting
- Looks for `--- Page X ---` markers
- Handles missing markers (treats as single page)

### 2. Metadata Extraction
- **Circonscription**: `Circonscription foncière: VALUE`
- **Cadastre**: `Cadastre: VALUE`
- **Lot Number**: `Lot: VALUE`
- Missing fields → `null`

### 3. Inscription Parsing
- Finds all `Ligne X:` sections
- Extracts all fields from each section
- Handles both "Option 1:" and simple formats

### 4. Confidence Selection
- Always selects **Option 1** (highest confidence)
- Pattern: `Option 1: VALUE (Confiance: XX%)`
- Fallback: Simple `Field: value` format

### 5. Party Parsing

**Single Party:**
```
Input: "BEAUREGARD, ADRIEN" + "Décédé"
Output: [{ name: "BEAUREGARD, ADRIEN", role: "Décédé" }]
```

**Multiple Parties:**
```
Input: "THIBODEAU, GUY BEAUREGARD, ANDRE" + "1ere partie 2ième partie"
Output: [
  { name: "THIBODEAU, GUY", role: "1ere partie" },
  { name: "BEAUREGARD, ANDRE", role: "2ième partie" }
]
```

**Compound Roles:**
```
Input: "BEAUREGARD, ANDRE" + "Créancier Débiteur"
Output: [{ name: "BEAUREGARD, ANDRE", role: "Créancier Débiteur" }]
```

### 6. Value Normalization
- `[Vide]` → `null`
- Empty strings → `null`
- Whitespace trimmed

---

## Error Handling

### Graceful Degradation
- Malformed input → Returns minimal valid structure
- Missing metadata → `null` values
- Parsing errors → Logged, page skipped
- No inscriptions → Empty array

### Logging
- **INFO**: Start/end of sanitization, page count, inscription count
- **DEBUG**: Per-page processing details
- **WARN**: Parsing issues, missing data
- **ERROR**: Critical failures with context

---

## Testing

### Test Coverage

**Unit Tests (10 tests):**
1. Single page with single inscription
2. Multiple pages
3. Missing metadata
4. Single party parsing
5. Multiple parties with role indicators
6. Compound roles
7. Highest confidence option selection
8. `[Vide]` fields as null
9. Malformed input handling
10. Multiple inscriptions on same page

**Integration Tests (2 tests):**
1. Real-world example from user
2. Multi-page documents

**Total: 12/12 tests passing ✅**

### Running Tests

```bash
# All sanitizer tests
npm test -- --testPathPattern=sanitizer

# With coverage
npm test -- --coverage --testPathPattern=sanitizer

# Specific test file
npm test -- sanitizer.test.ts
npm test -- sanitizer-integration.test.ts
```

---

## Performance

### Storage Savings
- **Before**: ~50KB per document (verbose text)
- **After**: ~5KB per document (clean JSON)
- **Reduction**: ~90%

### Processing Time
- Sanitization: < 100ms per document
- Negligible overhead compared to OCR processing

---

## Files

### Core Implementation
- `src/types/ocr.ts` - Type definitions
- `src/ocr/sanitizer.ts` - Sanitization logic
- `src/ocr/monitor.ts` - Integration with OCR monitor

### Tests
- `src/ocr/__tests__/sanitizer.test.ts` - Unit tests
- `src/ocr/__tests__/sanitizer-integration.test.ts` - Integration tests

### Documentation
- `src/ocr/OCR_SANITIZATION_IMPLEMENTATION_PLAN.md` - Detailed implementation plan
- `src/ocr/IMPLEMENTATION_SUMMARY.md` - Implementation summary
- `src/ocr/SANITIZATION_README.md` - This file

---

## Troubleshooting

### Issue: Tests failing with import errors
**Solution**: Install @types/jest
```bash
npm install --save-dev @types/jest
```

### Issue: TypeScript errors
**Solution**: Run type check
```bash
npm run typecheck
```

### Issue: Parsing not working correctly
**Solution**: Check logs for warnings
```bash
# Look for WARN or ERROR level logs
grep -i "warn\|error" logs/ocr.log
```

### Issue: Missing inscriptions
**Solution**: Verify input format
- Check for `Ligne X:` markers
- Verify field names match expected patterns
- Check verbose text structure

---

## Future Enhancements

### Potential Improvements
1. **Better party name splitting** - More sophisticated heuristics
2. **Field validation** - Validate dates, numbers, etc.
3. **Performance optimization** - Cache regex patterns
4. **More test coverage** - Edge cases, stress tests
5. **Metrics tracking** - Success rate, parsing errors

### Monitoring
- Track sanitization success rate
- Monitor parsing errors
- Measure storage savings
- Alert on failures

---

## Support

### Documentation
- Implementation plan: `OCR_SANITIZATION_IMPLEMENTATION_PLAN.md`
- Summary: `IMPLEMENTATION_SUMMARY.md`
- This README: `SANITIZATION_README.md`

### Code
- Main module: `src/ocr/sanitizer.ts`
- Types: `src/types/ocr.ts`
- Tests: `src/ocr/__tests__/sanitizer*.test.ts`

---

**Version**: 1.0  
**Status**: ✅ Production Ready  
**Last Updated**: 2025-10-10


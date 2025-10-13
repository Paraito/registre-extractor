# OCR Sanitization Implementation Plan

## Executive Summary

This document outlines the implementation plan for adding a sanitization layer to the OCR processing pipeline. The goal is to transform verbose, multi-option OCR output into clean, structured JSON data suitable for database storage while preserving the full verbose output for logging and debugging purposes.

---

## Table of Contents

1. [Context & Problem Statement](#context--problem-statement)
2. [Current System Architecture](#current-system-architecture)
3. [Objectives](#objectives)
4. [Proposed Solution](#proposed-solution)
5. [Data Structure Specifications](#data-structure-specifications)
6. [Implementation Steps](#implementation-steps)
7. [Parsing Logic & Rules](#parsing-logic--rules)
8. [Edge Cases & Error Handling](#edge-cases--error-handling)
9. [Testing Strategy](#testing-strategy)
10. [Rollout Plan](#rollout-plan)

---

## Context & Problem Statement

### Current Situation

When processing a 6-page land registry document:

1. **PDF Processing**: The system uses `processPDFParallel()` to convert all pages to images
2. **OCR Extraction**: Each page gets 2 API calls:
   - `extractText()` - Raw OCR extraction with Gemini Vision AI
   - `boostText()` - Applies 60+ domain-specific correction rules
3. **Result Combination**: All pages are combined with separators (`--- Page 1 ---`, etc.)
4. **Database Storage**: The entire verbose output is stored in `file_content`

### The Problem

The verbose OCR output includes:
- Detailed thinking process ("ÉTAPE PRÉLIMINAIRE CRITIQUE", "Analyse Visuelle", etc.)
- Multiple confidence options for each field (Option 1: 95%, Option 2: 5%, etc.)
- Explanatory text and reasoning
- Validation notes and cross-references

**Example of current DB storage:**
```
--- Page 1 ---

ÉTAPE PRÉLIMINAIRE CRITIQUE : DESCRIPTION DÉTAILLÉE
* Type de document: Formulaire pré-imprimé
* Qualité de l'écriture: Principalement lisible
...

Ligne 1:
* Date de présentation d'inscription: 1986-09-12
* Numéro: 3 770 292
* Nature de l'acte: Testament
* Qualité: Décédé
* Nom des parties: BEAUREGARD, ADRIEN
...
```

This creates **massive text blobs** (often 50KB+ per document) with lots of "fluff" that:
- Makes database queries inefficient
- Complicates downstream processing
- Wastes storage space
- Makes data extraction difficult for other services

### What We Need

**For Logging**: Keep ALL verbose output (for debugging, auditing, quality control)

**For Database**: Store clean, structured JSON with:
- Only the extracted line items (inscriptions)
- Only the highest confidence values
- Proper data structure for easy querying
- No thinking process or explanations

---

## Current System Architecture

### File Structure
```
src/ocr/
├── processor.ts          # Main OCR orchestrator
├── gemini-client.ts      # Gemini API wrapper
├── pdf-converter.ts      # PDF to image conversion
├── prompts.ts           # OCR extraction & boost prompts
├── monitor.ts           # Queue monitoring & DB updates
└── index.ts             # Public exports
```

### Current Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. PDF Input (6 pages)                                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. processPDFParallel()                                     │
│    - Converts all pages to images in parallel               │
│    - Returns: MultiPageConversionResult                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Process Each Page (in parallel)                          │
│    For each page:                                           │
│    a. extractText() → rawText (verbose)                     │
│    b. boostText() → boostedText (verbose + corrected)       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Combine Results                                          │
│    - combinedRawText = "--- Page 1 ---\n..." + ...          │
│    - combinedBoostedText = "--- Page 1 ---\n..." + ...      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Database Update (monitor.ts)                             │
│    - file_content = combinedRawText (PROBLEM: too verbose)  │
│    - boosted_file_content = combinedBoostedText             │
└─────────────────────────────────────────────────────────────┘
```

### Key Files & Functions

**processor.ts**
- `processPDFParallel(pdfPath: string): Promise<MultiPageOCRResult>`
- Returns: `{ pages, totalPages, combinedRawText, combinedBoostedText, allPagesComplete }`

**monitor.ts**
- `processDocument(document, environment)` - Main processing loop
- Line 260-261: Gets `combinedRawText` and `combinedBoostedText`
- Line 265-275: Updates database with verbose text

**Types** (src/types/index.ts)
```typescript
interface ExtractionQueue {
  file_content?: string;           // Currently: verbose raw text
  boosted_file_content?: string;   // Currently: verbose boosted text
  // ... other fields
}
```

---

## Objectives

### Primary Goals

1. **Add Sanitization Layer**: Create a new processing step that converts verbose OCR output to clean JSON
2. **Preserve Verbose Output**: Keep full verbose text in `boosted_file_content` for debugging
3. **Store Clean JSON**: Save sanitized, structured data in `file_content` for efficient querying
4. **Maintain Backward Compatibility**: Don't break existing functionality

### Success Criteria

- ✅ `file_content` contains only clean JSON (no verbose text)
- ✅ `boosted_file_content` contains full verbose output (for logging)
- ✅ JSON structure is consistent and well-typed
- ✅ All inscriptions from all pages are captured
- ✅ Only highest confidence values are selected
- ✅ Parties are properly parsed into arrays
- ✅ No data loss during sanitization
- ✅ Existing OCR pipeline continues to work

---

## Proposed Solution

### New Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1-4. [Same as before: PDF → OCR → Combine]                 │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. NEW: Sanitize to JSON                                    │
│    sanitizeOCRResult(combinedBoostedText)                   │
│    → Clean JSON structure                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Database Update (MODIFIED)                               │
│    - file_content = JSON.stringify(sanitizedJSON)           │
│    - boosted_file_content = combinedBoostedText (verbose)   │
└─────────────────────────────────────────────────────────────┘
```

### New Files to Create

1. **src/ocr/sanitizer.ts** - Main sanitization logic
2. **src/ocr/__tests__/sanitizer.test.ts** - Unit tests
3. **src/types/ocr.ts** - TypeScript types for sanitized data

---

## Data Structure Specifications

### Output JSON Schema

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

### Example Output

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
        },
        {
          "acte_publication_date": "1989-05-19",
          "acte_publication_number": "4 155 383",
          "acte_nature": "Servitude",
          "parties": [
            {
              "name": "THIBODEAU, GUY",
              "role": "1ere partie"
            },
            {
              "name": "BEAUREGARD, ANDRE",
              "role": "2ième partie"
            }
          ],
          "remarques": "2EME IMMEUBLE",
          "radiation_number": null
        }
      ]
    }
  ]
}
```

---

## Implementation Steps

### Step 1: Create TypeScript Types

**File**: `src/types/ocr.ts`

**Tasks**:
1. Define `SanitizedOCRResult` interface
2. Define `PageResult` interface
3. Define `PageMetadata` interface
4. Define `Inscription` interface
5. Define `Party` interface
6. Export all types

**Acceptance Criteria**:
- All types are properly exported
- Types match the JSON schema specification
- No TypeScript compilation errors

---

### Step 2: Create Sanitizer Module

**File**: `src/ocr/sanitizer.ts`

**Main Function Signature**:
```typescript
export function sanitizeOCRResult(
  combinedBoostedText: string
): SanitizedOCRResult
```

**Sub-functions to Implement**:

1. **`splitIntoPages(text: string): string[]`**
   - Split by `--- Page X ---` markers
   - Return array of page text sections
   - Handle edge cases (missing markers, malformed separators)

2. **`extractPageMetadata(pageText: string): PageMetadata`**
   - Extract circonscription (look for "Circonscription foncière:")
   - Extract cadastre (look for "Cadastre:")
   - Extract lot_number (look for "Lot:")
   - Return null for missing fields

3. **`extractInscriptions(pageText: string): Inscription[]`**
   - Find all "Ligne X:" sections
   - For each line, extract all fields
   - Parse parties using `parseParties()`
   - Select only "Option 1" values (highest confidence)

4. **`parseParties(partiesText: string, qualiteText: string): Party[]`**
   - Handle single party: `"BEAUREGARD, ADRIEN"` + `"Décédé"` → `[{name: "BEAUREGARD, ADRIEN", role: "Décédé"}]`
   - Handle multiple parties: `"THIBODEAU, GUY BEAUREGARD, ANDRE"` + `"1ere partie 2ième partie"` → Split into 2 objects
   - Handle compound roles: Keep "Créancier Débiteur" as single string
   - Handle edge cases: empty, null, malformed

5. **`selectHighestConfidence(optionsText: string): string | null`**
   - Parse "Option 1: VALUE (Confiance: XX%)" pattern
   - Return VALUE from Option 1
   - Return null if "[Vide]" or missing

**Acceptance Criteria**:
- Function successfully parses sample verbose output
- All inscriptions are extracted
- Metadata is correctly identified
- Parties are properly split and structured
- Only Option 1 values are selected
- Edge cases handled gracefully (missing data, malformed text)

---

### Step 3: Update Monitor to Use Sanitizer

**File**: `src/ocr/monitor.ts`

**Changes Required**:

**Import sanitizer** (top of file):
```typescript
import { sanitizeOCRResult } from './sanitizer';
```

**Modify database update logic** (around line 257-270):

**BEFORE**:
```typescript
const rawText = ocrResult.combinedRawText;
const boostedText = ocrResult.combinedBoostedText;

let updateData: any = {
  file_content: rawText,
  boosted_file_content: boostedText,
  status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
  updated_at: new Date().toISOString()
};
```

**AFTER**:
```typescript
const rawText = ocrResult.combinedRawText;
const boostedText = ocrResult.combinedBoostedText;

// NEW: Sanitize boosted text to clean JSON
logger.info({ documentId: document.id }, 'Sanitizing OCR result to JSON');
const sanitizedJSON = sanitizeOCRResult(boostedText);
const cleanJSON = JSON.stringify(sanitizedJSON, null, 2);

logger.info({
  documentId: document.id,
  totalPages: sanitizedJSON.pages.length,
  totalInscriptions: sanitizedJSON.pages.reduce((sum, p) => sum + p.inscriptions.length, 0)
}, 'OCR sanitization complete');

let updateData: any = {
  file_content: cleanJSON,                    // CHANGED: Now clean JSON
  boosted_file_content: boostedText,          // UNCHANGED: Verbose for logging
  status_id: EXTRACTION_STATUS.EXTRACTION_COMPLETE,
  updated_at: new Date().toISOString()
};
```

**Acceptance Criteria**:
- Sanitizer is called after OCR processing
- Clean JSON is stored in `file_content`
- Verbose text is stored in `boosted_file_content`
- Logging shows sanitization progress
- No breaking changes to existing flow

---

### Step 4: Add Comprehensive Logging

**File**: `src/ocr/sanitizer.ts`

**Logging Points**:

1. **Start of sanitization**:
```typescript
logger.info({ textLength: combinedBoostedText.length }, 'Starting OCR sanitization');
```

2. **Page splitting**:
```typescript
logger.info({ pageCount: pages.length }, 'Split into pages');
```

3. **Per-page processing**:
```typescript
logger.debug({
  pageNumber,
  inscriptionCount: inscriptions.length,
  hasMetadata: !!metadata.circonscription
}, 'Processed page');
```

4. **Warnings for parsing issues**:
```typescript
logger.warn({
  pageNumber,
  issue: 'Could not extract metadata'
}, 'Metadata extraction failed');
```

5. **Final summary**:
```typescript
logger.info({
  totalPages: result.pages.length,
  totalInscriptions: result.pages.reduce((sum, p) => sum + p.inscriptions.length, 0)
}, 'Sanitization complete');
```

**Acceptance Criteria**:
- All major steps are logged
- Warnings are logged for parsing issues
- Debug logs available for troubleshooting
- No sensitive data in logs

---

### Step 5: Create Unit Tests

**File**: `src/ocr/__tests__/sanitizer.test.ts`

**Test Cases**:

1. **Test: Parse single page with single inscription**
   - Input: Verbose text with 1 page, 1 inscription
   - Expected: Correct JSON structure with all fields

2. **Test: Parse multiple pages**
   - Input: Verbose text with 3 pages
   - Expected: 3 page objects in result

3. **Test: Extract metadata correctly**
   - Input: Page with circonscription, cadastre, lot_number
   - Expected: All metadata fields populated

4. **Test: Handle missing metadata**
   - Input: Page without metadata
   - Expected: Metadata fields are null

5. **Test: Parse single party**
   - Input: `"BEAUREGARD, ADRIEN"` + `"Décédé"`
   - Expected: `[{name: "BEAUREGARD, ADRIEN", role: "Décédé"}]`

6. **Test: Parse multiple parties**
   - Input: `"THIBODEAU, GUY BEAUREGARD, ANDRE"` + `"1ere partie 2ième partie"`
   - Expected: 2 party objects

7. **Test: Handle compound roles**
   - Input: `"Créancier Débiteur"`
   - Expected: Single role string (not split)

8. **Test: Select highest confidence option**
   - Input: Multiple options with confidence scores
   - Expected: Only Option 1 value selected

9. **Test: Handle [Vide] fields**
   - Input: Field marked as `[Vide]`
   - Expected: null value

10. **Test: Handle malformed input**
    - Input: Incomplete or malformed verbose text
    - Expected: Graceful degradation, no crashes

**Acceptance Criteria**:
- All tests pass
- Code coverage > 80%
- Edge cases covered
- Tests are maintainable and well-documented

---

## Parsing Logic & Rules

### Page Splitting

**Pattern**: `--- Page X ---` where X is a number

**Algorithm**:
```typescript
function splitIntoPages(text: string): string[] {
  const pagePattern = /--- Page (\d+) ---/g;
  const pages: string[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = pagePattern.exec(text)) !== null) {
    if (lastIndex > 0) {
      pages.push(text.substring(lastIndex, match.index));
    }
    lastIndex = match.index + match[0].length;
  }
  
  // Add last page
  if (lastIndex < text.length) {
    pages.push(text.substring(lastIndex));
  }
  
  return pages;
}
```

---

### Metadata Extraction

**Patterns to Match**:

1. **Circonscription**: 
   - Pattern: `Circonscription foncière:\s*(.+)`
   - Example: `Circonscription foncière: Montréal`

2. **Cadastre**:
   - Pattern: `Cadastre:\s*(.+)`
   - Example: `Cadastre: Cité de Montréal (quartier Sainte-Marie)`

3. **Lot Number**:
   - Pattern: `Lot:\s*(.+)`
   - Example: `Lot: 1358-176`

**Algorithm**:
```typescript
function extractPageMetadata(pageText: string): PageMetadata {
  const circonscriptionMatch = pageText.match(/Circonscription foncière:\s*(.+)/i);
  const cadastreMatch = pageText.match(/Cadastre:\s*(.+)/i);
  const lotMatch = pageText.match(/Lot:\s*(.+)/i);
  
  return {
    circonscription: circonscriptionMatch ? circonscriptionMatch[1].trim() : null,
    cadastre: cadastreMatch ? cadastreMatch[1].trim() : null,
    lot_number: lotMatch ? lotMatch[1].trim() : null
  };
}
```

---

### Inscription Extraction

**Pattern**: Each inscription starts with `Ligne X:` where X is a number

**Fields to Extract** (with patterns):

1. **acte_publication_date**:
   - Pattern: `Date de présentation d'inscription:\s*Option 1:\s*(.+?)\s*\(Confiance`
   - Fallback: `Date de présentation d'inscription:\s*(.+)`

2. **acte_publication_number**:
   - Pattern: `Numéro:\s*Option 1:\s*(.+?)\s*\(Confiance`
   - Fallback: `Numéro:\s*(.+)`

3. **acte_nature**:
   - Pattern: `Nature de l'acte:\s*Option 1:\s*(.+?)\s*\(Confiance`
   - Fallback: `Nature de l'acte:\s*(.+)`

4. **parties** (special handling - see below)

5. **remarques**:
   - Pattern: `Remarques:\s*Option 1:\s*(.+?)\s*\(Confiance`
   - Fallback: `Remarques:\s*(.+)`

6. **radiation_number**:
   - Pattern: `Radiations:\s*Option 1:\s*(.+?)\s*\(Confiance`
   - Fallback: `Radiations:\s*(.+)`

**Handle `[Vide]`**: If extracted value is `[Vide]`, return `null`

---

### Parties Parsing

**Inputs**:
- `partiesText`: Names from "Nom des parties" field
- `qualiteText`: Roles from "Qualité" field

**Scenarios**:

**Scenario 1: Single Party**
- Input: `"BEAUREGARD, ADRIEN"` + `"Décédé"`
- Output: `[{name: "BEAUREGARD, ADRIEN", role: "Décédé"}]`

**Scenario 2: Multiple Parties with Role Indicators**
- Input: `"THIBODEAU, GUY BEAUREGARD, ANDRE"` + `"1ere partie 2ième partie"`
- Algorithm:
  1. Split qualite by role indicators: `["1ere partie", "2ième partie"]`
  2. Split names (heuristic: by uppercase letter after space)
  3. Match names to roles
- Output: `[{name: "THIBODEAU, GUY", role: "1ere partie"}, {name: "BEAUREGARD, ANDRE", role: "2ième partie"}]`

**Scenario 3: Compound Roles**
- Input: `"BEAUREGARD, ANDRE"` + `"Créancier Débiteur"`
- Output: `[{name: "BEAUREGARD, ANDRE", role: "Créancier Débiteur"}]`
- Note: Keep as single role string (don't split)

**Algorithm**:
```typescript
function parseParties(partiesText: string, qualiteText: string): Party[] {
  // Handle [Vide] or empty
  if (!partiesText || partiesText === '[Vide]') return [];
  if (!qualiteText || qualiteText === '[Vide]') {
    return [{ name: partiesText.trim(), role: '' }];
  }
  
  // Check for role indicators (1ere partie, 2ième partie, etc.)
  const roleIndicators = qualiteText.match(/\d+(?:ere|ième)\s+partie/gi);
  
  if (roleIndicators && roleIndicators.length > 1) {
    // Multiple parties scenario
    const names = splitNames(partiesText);
    return names.map((name, index) => ({
      name: name.trim(),
      role: roleIndicators[index] || ''
    }));
  } else {
    // Single party or compound role
    return [{
      name: partiesText.trim(),
      role: qualiteText.trim()
    }];
  }
}

function splitNames(text: string): string[] {
  // Heuristic: Split on pattern of uppercase letter after space
  // Example: "THIBODEAU, GUY BEAUREGARD, ANDRE" → ["THIBODEAU, GUY", "BEAUREGARD, ANDRE"]
  const pattern = /(?=[A-Z][A-Z]+,)/g;
  return text.split(pattern).filter(n => n.trim().length > 0);
}
```

---

### Confidence Selection

**Pattern**: `Option 1: VALUE (Confiance: XX%)`

**Algorithm**:
```typescript
function selectHighestConfidence(text: string): string | null {
  // Look for "Option 1: VALUE (Confiance: XX%)"
  const match = text.match(/Option 1:\s*(.+?)\s*\(Confiance/i);
  
  if (match) {
    const value = match[1].trim();
    return value === '[Vide]' ? null : value;
  }
  
  // Fallback: No options format, just extract value
  const simpleMatch = text.match(/:\s*(.+)/);
  if (simpleMatch) {
    const value = simpleMatch[1].trim();
    return value === '[Vide]' ? null : value;
  }
  
  return null;
}
```

---

## Edge Cases & Error Handling

### Edge Case 1: Missing Page Markers

**Scenario**: Text doesn't contain `--- Page X ---` markers

**Handling**: Treat entire text as single page (pageNumber: 1)

**Code**:
```typescript
if (pages.length === 0) {
  logger.warn('No page markers found, treating as single page');
  pages = [combinedBoostedText];
}
```

---

### Edge Case 2: Malformed Metadata

**Scenario**: Metadata fields are present but values are garbled

**Handling**: Extract what's possible, set rest to null, log warning

**Code**:
```typescript
try {
  metadata = extractPageMetadata(pageText);
} catch (error) {
  logger.warn({ pageNumber, error }, 'Metadata extraction failed');
  metadata = { circonscription: null, cadastre: null, lot_number: null };
}
```

---

### Edge Case 3: No Inscriptions Found

**Scenario**: Page has metadata but no inscription lines

**Handling**: Return empty inscriptions array, log info

**Code**:
```typescript
if (inscriptions.length === 0) {
  logger.info({ pageNumber }, 'No inscriptions found on page');
}
```

---

### Edge Case 4: Incomplete Inscription Data

**Scenario**: Inscription line is missing some fields

**Handling**: Set missing fields to null, include inscription anyway

**Code**:
```typescript
const inscription: Inscription = {
  acte_publication_date: extractField('Date') || null,
  acte_publication_number: extractField('Numéro') || null,
  acte_nature: extractField('Nature') || null,
  parties: parseParties(partiesText, qualiteText) || [],
  remarques: extractField('Remarques') || null,
  radiation_number: extractField('Radiations') || null
};
```

---

### Edge Case 5: Parsing Errors

**Scenario**: Unexpected format causes parsing to fail

**Handling**: Catch error, log details, return partial result

**Code**:
```typescript
try {
  const sanitized = sanitizeOCRResult(boostedText);
  return sanitized;
} catch (error) {
  logger.error({
    error: error instanceof Error ? error.message : error,
    textPreview: boostedText.substring(0, 500)
  }, 'Sanitization failed');
  
  // Return minimal valid structure
  return {
    pages: [{
      pageNumber: 1,
      metadata: { circonscription: null, cadastre: null, lot_number: null },
      inscriptions: []
    }]
  };
}
```

---

## Testing Strategy

### Unit Tests

**Coverage Goals**:
- Line coverage: > 80%
- Branch coverage: > 75%
- Function coverage: 100%

**Test Data**:
Create sample verbose OCR outputs in `src/ocr/__tests__/fixtures/`:
- `single-page-single-inscription.txt`
- `multi-page-multi-inscriptions.txt`
- `missing-metadata.txt`
- `malformed-input.txt`

---

### Integration Tests

**Test**: End-to-end OCR processing with sanitization

**File**: `src/ocr/__tests__/integration.test.ts`

**Scenario**:
1. Mock `processPDFParallel()` to return sample verbose output
2. Call sanitizer
3. Verify JSON structure
4. Verify database update

---

### Manual Testing

**Test Cases**:

1. **Real Document Test**:
   - Process actual 6-page land registry document
   - Verify all pages extracted
   - Verify all inscriptions captured
   - Verify parties correctly parsed

2. **Database Verification**:
   - Check `file_content` is valid JSON
   - Check `boosted_file_content` has verbose text
   - Verify JSON can be parsed and queried

3. **Performance Test**:
   - Process 10 documents
   - Measure sanitization time
   - Ensure < 1 second per document

---

## Rollout Plan

### Phase 1: Development & Testing (Week 1)

**Tasks**:
- [ ] Create TypeScript types
- [ ] Implement sanitizer module
- [ ] Write unit tests
- [ ] Update monitor.ts
- [ ] Run integration tests

**Deliverables**:
- Working sanitizer with tests
- Updated monitor with sanitization

---

### Phase 2: Staging Deployment (Week 2)

**Tasks**:
- [ ] Deploy to staging environment
- [ ] Process 10-20 test documents
- [ ] Verify database storage
- [ ] Check logs for errors
- [ ] Performance testing

**Validation**:
- All test documents processed successfully
- JSON structure is correct
- No errors in logs
- Performance acceptable

---

### Phase 3: Production Rollout (Week 3)

**Tasks**:
- [ ] Deploy to production
- [ ] Monitor first 100 documents
- [ ] Set up alerts for parsing failures
- [ ] Document any issues

**Rollback Plan**:
If critical issues found:
1. Revert monitor.ts changes
2. Fall back to storing verbose text in `file_content`
3. Fix issues in staging
4. Re-deploy

---

### Phase 4: Monitoring & Optimization (Ongoing)

**Metrics to Track**:
- Sanitization success rate
- Average processing time
- Parsing error rate
- Database storage savings

**Optimization Opportunities**:
- Improve parsing accuracy
- Add more edge case handling
- Optimize regex patterns
- Cache common patterns

---

## Appendix

### A. Sample Input (Verbose OCR Output)

```
--- Page 1 ---

ÉTAPE PRÉLIMINAIRE CRITIQUE : DESCRIPTION DÉTAILLÉE

*   **Type de document:** Formulaire pré-imprimé (index des immeubles)
*   **Qualité de l'écriture:** Principalement lisible
...

Type de Modèle Identifié : Type Old 2

Métadonnées de l'En-tête :

*   Circonscription foncière: Montréal
*   Cadastre: Cité de Montréal (quartier Sainte-Marie)
*   Lot: 1358-176

Données du Tableau :

Ligne 1:

*   Date de présentation d'inscription: 1986-09-12
*   Numéro: 3 770 292
*   Nature de l'acte: Testament
*   Qualité: Décédé
*   Nom des parties: BEAUREGARD, ADRIEN
*   Remarques: PERMIS DE DISPOSER
*   Radiations: [Vide]
```

### B. Sample Output (Clean JSON)

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

## Questions & Support

For questions or issues during implementation, contact:
- **Technical Lead**: [Your Name]
- **Project Manager**: [PM Name]
- **Slack Channel**: #ocr-sanitization

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-10  
**Author**: AI Assistant (for Marin)


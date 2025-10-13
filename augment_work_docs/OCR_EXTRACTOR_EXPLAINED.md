# 📖 OCR Extractor - Complete Explanation

## 🎯 Overview

The OCR extractor is a **two-stage AI-powered system** that extracts and enhances text from Quebec land registry documents. It processes both:
- **Index documents** (registry index pages with tabular data)
- **Acte documents** (full legal acts with typed and handwritten text)

---

## 🏗️ Architecture

### **Dual-Provider System with Automatic Fallback**

```
┌─────────────┐
│   PDF File  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│  PDF → Images Conversion    │
│  (300 DPI, PNG, 95% quality)│
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Try Gemini (Preferred)     │◄─── Stage 1: Extraction
│  ├─ Success → Continue      │
│  └─ Failure → Fallback ──┐  │
└──────┬──────────────────┼───┘
       │                  │
       │                  ▼
       │         ┌────────────────┐
       │         │  Claude Fallback│
       │         └────────┬────────┘
       │                  │
       ▼                  ▼
┌─────────────────────────────┐
│  Combine All Pages          │
│  (with page markers)        │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Try Same Provider (Boost)  │◄─── Stage 2: Enhancement
│  ├─ Success → Done          │
│  └─ Failure → Fallback      │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Final Boosted Text         │
└─────────────────────────────┘
```

**Providers:**
- **Gemini** (Google): `gemini-2.0-flash-exp` for extraction, `gemini-2.5-pro` for boost
- **Claude** (Anthropic): `claude-sonnet-4-5-20250929` for both extraction and boost

---

## 🔄 Processing Pipeline

### **Step 1: PDF Conversion**
:file_folder: Reference: `src/ocr/pdf-converter.ts`

- Converts each PDF page to PNG images
- Settings: 300 DPI, 95% quality
- Encodes to base64 for API transmission
- **Why?** Both Gemini and Claude require images, not PDFs

### **Step 2: Text Extraction (Raw OCR)**
:file_folder: Reference: `src/ocr/unified-ocr-processor.ts` — lines 122-150

**Process:**
1. All pages processed **in parallel** for speed
2. Each page analyzed independently by AI vision model
3. Uses specialized prompts based on document type
4. Results concatenated with page markers: `\n\n--- Page X ---\n\n`

**Completion Detection:**
- Looks for marker: `✅ EXTRACTION_COMPLETE: [X] lignes traitées sur [X] lignes visibles.`
- If marker missing → response was truncated → retry with continuation prompt

### **Step 3: Text Enhancement (Boost)**
:file_folder: Reference: `src/ocr/unified-ocr-processor.ts` — lines 160-193

**Process:**
1. Takes **combined** raw text from all pages
2. Applies domain-specific corrections and standardization
3. Single boost call (not per-page)
4. Uses same provider as extraction (or fallback if it fails)

**Completion Detection:**
- Looks for marker: `✅ BOOST_COMPLETE: [X] lignes traitées, [Y] corrections appliquées.`
- If marker missing → response was truncated → retry

---

## 📝 Prompts Used

### **For Index Documents**

#### **1. EXTRACT_PROMPT** (Stage 1)
:file_folder: Reference: `src/ocr/prompts.ts` — lines 5-183

**Purpose:** Extract structured data from index registry pages

**Key Instructions:**
- **Preliminary description**: Describe document type, quality, structure before extraction
- **Dynamic thinking schema**: Step-by-step analysis from general to specific
- **Confidence options**: Provide multiple options with confidence scores for ambiguous fields
- **Critical fields**: 
  - NOMS DES PARTIES (party names)
  - Nature de l'Acte (type of act)
  - Date
  - **N° (Publication Number)** ← MOST CRITICAL
- **Complete extraction**: Extract ALL visible lines, never stop mid-way
- **Completion marker**: Must end with `✅ EXTRACTION_COMPLETE: [X] lignes traitées sur [X] lignes visibles.`

**Example Output Structure:**
```
Type de Modèle Identifié : Type Old 2

Métadonnées de l'En-tête :
Lot no : 283-359
Paroisse : STE-JULIE

Données du Tableau (Ligne 1) :
NOMS DES PARTIES :
  Option 1 : S. Pronovost et Hydro Québec (Confiance : 85%)
  Option 2 : S. Pronovost et Hydro-Québec (Confiance : 10%)

Nature de l'Acte :
  Option 1 : Servitude (Confiance : 95%)
  Option 2 : Sûreté (Confiance : 5%)

ENREGISTREMENT - N° (CRITIQUE) :
  Option 1 : 146828 (Confiance : 80%)
  Option 2 : 146823 (Confiance : 12%)
```

#### **2. BOOST_PROMPT** (Stage 2)
:file_folder: Reference: `src/ocr/prompts.ts` — lines 189-306

**Purpose:** Apply 60+ domain-specific correction rules to raw OCR text

**Key Rules (60+ total):**

**Utilities/Electricity (Rules 1-6):**
- Hydro-Québec detected + Nature uncertain → boost "Servitude"
- Tokens like "poteau", "ligne" in Remarks → boost "Servitude"

**Transportation/Corridors (Rules 7-9):**
- Ministère des Transports + uncertain Nature → boost "Servitude"
- Railways (CN/CP) + uncertain → boost "Servitude"

**Banks/Finance (Rules 10-17):**
- RBC/TD/BMO/Banque Nationale + amounts → boost "Hypothèque"
- Bank + "quittance" + same creditor → boost "Quittance/Mainlevée"
- Tokens "cession de rang", "subrogation" → boost "Cession d'hypothèque"

**Public Organizations (Rules 18-23):**
- Municipality + "aqueduc/égout" → boost "Servitude"
- School board + "accès scolaire" → boost "Servitude de passage"

**Disambiguation (Rules 29-33):**
- Fuzzy "Banque Nationale" vs "Bernard Nandin" + Hypothèque → snap to "Banque Nationale"
- Fuzzy "Hydro-Québec" vs "Hubert-Québertin" + electricity tokens → snap to "Hydro-Québec"

**Critical Instructions:**
- **Preserve structure**: Keep exact format from raw text (don't convert to Markdown tables)
- **Apply corrections only to values**, not structure
- **Process ALL lines** without stopping
- **Completion marker**: `✅ BOOST_COMPLETE: [X] lignes traitées, [Y] corrections appliquées.`

---

### **For Acte Documents**

#### **1. ACTE_EXTRACT_PROMPT** (Stage 1)
:file_folder: Reference: `src/ocr/prompts-acte.ts` — lines 5-110

**Purpose:** Extract complete text from legal act documents (typed + handwritten)

**Key Instructions:**
- **Complete extraction**: Extract ALL text (headers, clauses, signatures, annotations)
- **Handwritten text handling**: 
  - Best effort to decipher
  - Mark uncertain words with `[?]`
  - Mark illegible words with `[ILLISIBLE]`
- **Structure preservation**: Maintain sections, paragraphs, numbering
- **Important elements**:
  - Header (registration number, date, office)
  - Parties (names, addresses, legal capacity)
  - Nature of act (sale, mortgage, servitude, etc.)
  - Property description (lot numbers, cadastre)
  - Amounts, dates, references
  - Conditions, clauses, signatures

**Output Format:**
```markdown
## EN-TÊTE
Numéro d'inscription : [numéro]
Date d'enregistrement : [date]

## NATURE DE L'ACTE
[Type d'acte]

## PARTIES
### Partie 1 (Vendeur/Créancier)
Nom : [nom complet]
Adresse : [adresse]

## DESCRIPTION DE LA PROPRIÉTÉ
[Description complète]
Lot(s) : [numéros]

## MONTANTS
[Tous les montants]

## CONDITIONS ET CLAUSES
[Toutes les conditions]
```

#### **2. ACTE_BOOST_PROMPT** (Stage 2)
:file_folder: Reference: `src/ocr/prompts-acte.ts` — lines 116-204

**Purpose:** Apply corrections and standardization to acte text

**Key Rules:**

**1. OCR Error Correction:**
- "0" vs "O", "1" vs "l" vs "I", "5" vs "S", "8" vs "B"
- Fix spacing and punctuation

**2. Entity Standardization:**
- "RBC" → "Banque Royale du Canada (RBC)"
- "BMO" → "Banque de Montréal (BMO)"
- "Hydro-Québec" (with hyphen)
- "MTQ" → "Ministère des Transports du Québec (MTQ)"

**3. Amount Formatting:**
- "50000$" → "50 000 $" (space before $, thousands separator)

**4. Date Standardization:**
- Prefer: AAAA-MM-JJ
- "15 janvier 2020" → "2020-01-15 (15 janvier 2020)"

**5. Address Formatting:**
- "123 rue Principale, Montréal, Québec, H1A 1A1"

**6. Abbreviation Expansion:**
- "Cir. fonc." → "Circonscription foncière"
- "Cad." → "Cadastre"

**7. Readability Enhancement:**
- Use Markdown headers (##, ###)
- Use lists and tables
- Bold important elements
- Italics for notes

**8. Consistency Validation:**
- Check amounts are consistent
- Check dates are logical
- Flag inconsistencies with `[⚠️ INCOHÉRENCE: ...]`

---

## 🔧 Technical Details

### **Models Used**

| Provider | Extraction Model | Boost Model | Max Output Tokens |
|----------|-----------------|-------------|-------------------|
| **Gemini** | `gemini-2.0-flash-exp` | `gemini-2.5-pro` | 8,192 / 65,536 |
| **Claude** | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-5-20250929` | 16,000 |

### **Temperature Settings**
- **Extraction**: 0.0-0.1 (very deterministic)
- **Boost**: 0.0-0.2 (mostly deterministic)

### **Retry Logic**
- **Max attempts**: 3 per stage
- **Continuation prompts**: If response truncated, retry with continuation request
- **Exponential backoff**: For Claude (1s, 2s, 4s...)

### **Completion Detection**
Both stages check for completion markers:
- **Extraction**: `✅ EXTRACTION_COMPLETE:`
- **Boost**: `✅ BOOST_COMPLETE:`

If marker missing → response was truncated → automatic retry with continuation prompt

---

## 📊 Key Files

| File | Purpose |
|------|---------|
| `src/ocr/unified-ocr-processor.ts` | Main orchestrator with fallback logic |
| `src/ocr/gemini-client.ts` | Gemini API client |
| `src/ocr/claude-ocr-client.ts` | Claude API client |
| `src/ocr/pdf-converter.ts` | PDF → Image conversion |
| `src/ocr/prompts.ts` | Index document prompts |
| `src/ocr/prompts-acte.ts` | Acte document prompts |
| `src/ocr/acte-processor.ts` | Specialized acte processor |
| `src/ocr/processor.ts` | Legacy single-page processor |

---

## 🎯 Summary

**What it does:**
1. Converts PDF pages to high-quality images
2. Uses AI vision models to extract text (with confidence scores for ambiguous fields)
3. Uses AI language models to apply domain-specific corrections and standardization
4. Provides automatic fallback between Gemini and Claude for reliability

**Why two stages?**
- **Stage 1 (Extraction)**: Vision models are best at reading images
- **Stage 2 (Boost)**: Language models are best at applying domain knowledge and corrections

**Why fallback?**
- Ensures high availability even if one provider fails
- Gemini is preferred for cost/speed, Claude for reliability

**Key innovation:**
- **Confidence-based extraction**: Provides multiple options for ambiguous fields
- **Domain-specific boost**: 60+ rules tailored to Quebec land registry documents
- **Completion detection**: Automatic retry if responses are truncated


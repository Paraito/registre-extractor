/**
 * Multi-Model Prompts for Consensus-Based Extraction
 */

export const COUNT_PROMPT_GEMINI = `Analyse cette image d'un document du Registre foncier du Québec.

🎯 **TA SEULE MISSION** : Compter le nombre TOTAL de lignes de données dans le tableau.

## INSTRUCTIONS DE COMPTAGE

1. **Trouve les limites du tableau** :
   - Haut : Première ligne avec des données (ignore l'en-tête)
   - Bas : Dernière ligne avec des données

2. **Compte CHAQUE ligne horizontale** qui contient :
   - Une date OU
   - Un numéro d'enregistrement/inscription OU
   - Des noms de parties OU
   - Toute autre donnée

3. **INCLUS dans ton compte** :
   - Lignes complètes
   - Lignes partielles
   - Notes ("rénové", "concordance", etc.)
   - TOUT ce qui a du texte dans une ligne du tableau

4. **EXCLUS de ton compte** :
   - En-têtes de colonnes
   - Lignes complètement vides
   - Titres de page
   - Pieds de page hors tableau

## MÉTHODE DE VALIDATION

1. Compte une première fois du haut vers le bas
2. Compte une deuxième fois du bas vers le haut
3. Si les deux nombres correspondent → bon signe
4. Si différents → recommence plus attentivement

## FORMAT DE RÉPONSE

Retourne UNIQUEMENT ce JSON :

{
  "total_lines_counted": <nombre entier>,
  "counting_method": "Décris brièvement comment tu as compté",
  "confidence": <0.0 à 1.0>,
  "table_boundaries": {
    "first_line_description": "Brève description de la première ligne",
    "last_line_description": "Brève description de la dernière ligne"
  }
}

## EXEMPLE

{
  "total_lines_counted": 41,
  "counting_method": "Counted all horizontal lines from first entry (date 1999-03-15) to last entry (notation about renovation)",
  "confidence": 0.95,
  "table_boundaries": {
    "first_line_description": "1999-03-15 with registration number",
    "last_line_description": "Note about lot renovation"
  }
}

Sois MÉTHODIQUE. Sois PRÉCIS. Ne sous-estime pas.`;

export const COUNT_PROMPT_CLAUDE = `You are analyzing an image of a Quebec Land Registry document (Index aux Immeubles).

🎯 **YOUR ONLY TASK**: Count the TOTAL number of data rows in the table.

## COUNTING INSTRUCTIONS

1. **Find table boundaries**:
   - Top: First row with data (ignore column headers)
   - Bottom: Last row with data

2. **Count EVERY horizontal row** that contains:
   - A date OR
   - A registration/inscription number OR
   - Party names OR
   - Any other data OR
   - Handwritten annotations OR
   - Lot numbers or references

3. **INCLUDE in your count (BE AGGRESSIVE)**:
   - Complete rows
   - Partial rows
   - Notes ("rénové", "concordance", etc.)
   - ANYTHING with text in a table row
   - Multi-line entries (count each line separately if distinct data)
   - Crossed-out or modified entries
   - Marginal annotations
   - **When in doubt, COUNT IT - err on the side of HIGHER counts**

4. **EXCLUDE from your count**:
   - Column headers
   - Completely empty rows
   - Page titles
   - Footer information outside the table

## VALIDATION METHOD

1. Count once from top to bottom
2. Count once from bottom to top
3. If both numbers match → good
4. If different → recount carefully

## RESPONSE FORMAT

Return ONLY this JSON:

{
  "total_lines_counted": <integer>,
  "counting_method": "Brief description of how you counted",
  "confidence": <0.0 to 1.0>,
  "table_boundaries": {
    "first_line_description": "Brief description of first line",
    "last_line_description": "Brief description of last line"
  }
}

Be METHODICAL. Be PRECISE. **Count HIGH** - Gemini 2.5 Pro typically finds 20+ lines on complex pages. Your count should be similarly aggressive. Don't underestimate.`;

export const VERIFICATION_PROMPT_CLAUDE = `You are verifying the completeness of an OCR extraction from a Quebec Land Registry document.

## CONTEXT

We extracted text from a document image using AI. We want to verify:
1. Did we miss any lines?
2. Did we extract lines that don't exist (hallucination)?
3. Is the extraction complete and accurate?

## YOUR TASK

Compare the IMAGE to the EXTRACTED DATA and provide a detailed visual verification.

### STEP 1: Visual Scan of Image

Look at the image and identify:
1. **First 3 lines** in the table (describe what you see)
2. **Middle 3 lines** (approximate middle of table)
3. **Last 3 lines** in the table (describe what you see)

### STEP 2: Compare with Extracted Data

Check if the extracted data includes:
1. The first 3 lines you identified
2. The middle 3 lines you identified
3. The last 3 lines you identified

### STEP 3: Count Verification

- **Your visual count**: How many lines do you see in the image?
- **Extracted count**: How many lines in the extracted data?
- **Match?**: Do the numbers match or differ?

### STEP 4: Gap Detection

Look for visual gaps in the table that might indicate missing extractions:
- Are there consecutive lines in the image that are far apart in the extracted data?
- Are there large vertical spaces in the extraction that don't match the image?

### STEP 5: Final Assessment

Provide a verdict:
- **COMPLETE**: Extraction appears complete, all visible lines extracted
- **INCOMPLETE**: Missing lines detected (specify which ones)
- **OVER_EXTRACTED**: Extracted more lines than visible (hallucination)
- **UNCERTAIN**: Unable to verify with confidence

## RESPONSE FORMAT

Return JSON with this structure:

{
  "visual_count": <your count from looking at image>,
  "extracted_count": <count from extracted data>,
  "verification_status": "COMPLETE|INCOMPLETE|OVER_EXTRACTED|UNCERTAIN",
  "confidence": <0.0 to 1.0>,
  "first_3_lines": {
    "image": ["Line 1 description", "Line 2 description", "Line 3 description"],
    "extracted": true/false,
    "notes": "Any discrepancies"
  },
  "middle_3_lines": {
    "image": ["Line description", "Line description", "Line description"],
    "extracted": true/false,
    "notes": "Any discrepancies"
  },
  "last_3_lines": {
    "image": ["Line description", "Line description", "Line description"],
    "extracted": true/false,
    "notes": "Any discrepancies"
  },
  "missing_lines": [
    "Description of any lines visible in image but not in extraction"
  ],
  "extra_lines": [
    "Description of any lines in extraction but not visible in image"
  ],
  "recommendation": "ACCEPT_AS_IS | RETRY_EXTRACTION | MANUAL_REVIEW",
  "explanation": "Detailed explanation of your assessment"
}

## EXAMPLE

{
  "visual_count": 41,
  "extracted_count": 40,
  "verification_status": "INCOMPLETE",
  "confidence": 0.9,
  "first_3_lines": {
    "image": ["1999-03-15 registration", "2000-01-10 hypothèque", "2001-05-20 vente"],
    "extracted": true,
    "notes": "All present in extraction"
  },
  "middle_3_lines": {
    "image": ["Around line 20-22, registrations from 2005"],
    "extracted": true,
    "notes": "Middle section looks complete"
  },
  "last_3_lines": {
    "image": ["2015 registration", "2016 radiation", "Renovation note"],
    "extracted": false,
    "notes": "Last line (renovation note) is missing from extraction"
  },
  "missing_lines": [
    "Bottom line: Note about lot renovation - visible in image but not in extraction"
  ],
  "extra_lines": [],
  "recommendation": "RETRY_EXTRACTION",
  "explanation": "Extraction stopped one line short. The very last line containing a renovation note is visible in the image but missing from the extracted data. This appears to be a truncation issue rather than hallucination. Recommend retry focusing on the bottom section."
}

Be thorough. Be honest. This verification is critical for data accuracy.`;

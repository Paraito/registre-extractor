/**
 * OCR Sanitization Module
 * Converts verbose OCR output to clean, structured JSON
 */

import { logger } from '../utils/logger';
import {
  SanitizedOCRResult,
  PageResult,
  PageMetadata,
  Inscription,
  Party
} from '../types/ocr';

/**
 * Main sanitization function
 * Converts verbose OCR output (combinedBoostedText) to clean JSON structure
 */
export function sanitizeOCRResult(combinedBoostedText: string): SanitizedOCRResult {
  logger.info({ textLength: combinedBoostedText.length }, 'Starting OCR sanitization');

  try {
    // Step 1: Split into pages
    const pageTexts = splitIntoPages(combinedBoostedText);
    logger.info({ pageCount: pageTexts.length }, 'Split into pages');

    // Step 2: Process each page
    const pages: PageResult[] = pageTexts.map((pageText, index) => {
      const pageNumber = index + 1;
      
      try {
        // Extract metadata
        const metadata = extractPageMetadata(pageText);
        
        // Extract inscriptions
        const inscriptions = extractInscriptions(pageText);
        
        logger.debug({
          pageNumber,
          inscriptionCount: inscriptions.length,
          hasMetadata: !!(metadata.circonscription || metadata.cadastre || metadata.lot_number)
        }, 'Processed page');

        return {
          pageNumber,
          metadata,
          inscriptions
        };
      } catch (error) {
        logger.error({
          pageNumber,
          error: error instanceof Error ? error.message : error
        }, 'Failed to process page');
        
        // Return minimal valid structure for this page
        return {
          pageNumber,
          metadata: { circonscription: null, cadastre: null, lot_number: null },
          inscriptions: []
        };
      }
    });

    const totalInscriptions = pages.reduce((sum, p) => sum + p.inscriptions.length, 0);
    logger.info({
      totalPages: pages.length,
      totalInscriptions
    }, 'Sanitization complete');

    return { pages };

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : error,
      textPreview: combinedBoostedText.substring(0, 500)
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
}

/**
 * Split combined text into individual pages
 * Looks for "--- Page X ---" markers
 */
function splitIntoPages(text: string): string[] {
  const pagePattern = /---\s*Page\s+(\d+)\s*---/gi;
  const pages: string[] = [];
  let lastIndex = 0;
  let match;

  // Reset regex state
  pagePattern.lastIndex = 0;

  while ((match = pagePattern.exec(text)) !== null) {
    if (lastIndex > 0) {
      // Add the text between previous marker and current marker
      pages.push(text.substring(lastIndex, match.index).trim());
    }
    lastIndex = match.index + match[0].length;
  }

  // Add the last page (after the last marker)
  if (lastIndex < text.length) {
    pages.push(text.substring(lastIndex).trim());
  }

  // Edge case: No page markers found
  if (pages.length === 0) {
    logger.warn('No page markers found, treating as single page');
    return [text];
  }

  return pages;
}

/**
 * Extract metadata from a page
 * Looks for: Circonscription foncière, Cadastre, Lot
 */
function extractPageMetadata(pageText: string): PageMetadata {
  // Pattern variations to handle different formats
  const circonscriptionMatch = pageText.match(/Circonscription\s+foncière\s*:\s*(.+?)(?:\n|$)/i);
  const cadastreMatch = pageText.match(/Cadastre\s*:\s*(.+?)(?:\n|$)/i);
  const lotMatch = pageText.match(/Lot\s*:\s*(.+?)(?:\n|$)/i);

  return {
    circonscription: circonscriptionMatch ? circonscriptionMatch[1].trim() : null,
    cadastre: cadastreMatch ? cadastreMatch[1].trim() : null,
    lot_number: lotMatch ? lotMatch[1].trim() : null
  };
}

/**
 * Extract all inscriptions from a page
 * Looks for "Ligne X:" sections
 */
function extractInscriptions(pageText: string): Inscription[] {
  const inscriptions: Inscription[] = [];
  
  // Split by "Ligne X:" to get individual inscription blocks
  const lignePattern = /Ligne\s+(\d+)\s*:/gi;
  const matches = [...pageText.matchAll(lignePattern)];
  
  if (matches.length === 0) {
    logger.debug('No inscription lines found on page');
    return inscriptions;
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIndex = match.index! + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : pageText.length;
    const inscriptionText = pageText.substring(startIndex, endIndex);

    try {
      const inscription = parseInscription(inscriptionText);
      inscriptions.push(inscription);
    } catch (error) {
      logger.warn({
        ligneNumber: match[1],
        error: error instanceof Error ? error.message : error
      }, 'Failed to parse inscription');
    }
  }

  return inscriptions;
}

/**
 * Parse a single inscription from its text block
 */
function parseInscription(text: string): Inscription {
  // Extract fields using helper function
  const date = extractField(text, 'Date de présentation d\'inscription');
  const numero = extractField(text, 'Numéro');
  const nature = extractField(text, 'Nature de l\'acte');
  const qualite = extractField(text, 'Qualité');
  const nomParties = extractField(text, 'Nom des parties');
  const remarques = extractField(text, 'Remarques');
  const radiations = extractField(text, 'Radiations');

  // Parse parties
  const parties = parseParties(nomParties || '', qualite || '');

  return {
    acte_publication_date: date,
    acte_publication_number: numero,
    acte_nature: nature,
    parties,
    remarques,
    radiation_number: radiations
  };
}

/**
 * Extract a field value from inscription text
 * Handles both "Option 1:" format and simple "Field: value" format
 */
function extractField(text: string, fieldName: string): string | null {
  // Try to match "Option 1: VALUE (Confiance: XX%)" pattern first
  const optionPattern = new RegExp(
    `${escapeRegex(fieldName)}\\s*:?\\s*Option\\s+1\\s*:\\s*(.+?)\\s*\\(Confiance`,
    'is'
  );
  const optionMatch = text.match(optionPattern);
  
  if (optionMatch) {
    const value = optionMatch[1].trim();
    return normalizeValue(value);
  }

  // Fallback: Try simple "Field: value" pattern
  const simplePattern = new RegExp(
    `${escapeRegex(fieldName)}\\s*:?\\s*(.+?)(?:\\n|$)`,
    'i'
  );
  const simpleMatch = text.match(simplePattern);
  
  if (simpleMatch) {
    const value = simpleMatch[1].trim();
    return normalizeValue(value);
  }

  return null;
}

/**
 * Parse parties from names and roles text
 * Handles single party, multiple parties, and compound roles
 */
function parseParties(partiesText: string, qualiteText: string): Party[] {
  // Handle empty or [Vide]
  if (!partiesText || partiesText === '[Vide]') {
    return [];
  }

  // Normalize the text
  const normalizedParties = partiesText.trim();
  const normalizedQualite = qualiteText.trim();

  // If no qualite, return single party with empty role
  if (!normalizedQualite || normalizedQualite === '[Vide]') {
    return [{
      name: normalizedParties,
      role: ''
    }];
  }

  // Check for role indicators (1ere partie, 2ième partie, etc.)
  const roleIndicators = normalizedQualite.match(/\d+(?:ere|ère|ieme|ième)\s+partie/gi);
  
  if (roleIndicators && roleIndicators.length > 1) {
    // Multiple parties scenario
    const names = splitNames(normalizedParties);
    
    return names.map((name, index) => ({
      name: name.trim(),
      role: roleIndicators[index]?.trim() || ''
    }));
  } else {
    // Single party or compound role (e.g., "Créancier Débiteur")
    return [{
      name: normalizedParties,
      role: normalizedQualite
    }];
  }
}

/**
 * Split multiple names from a single string
 * Heuristic: Split on uppercase letter sequences that look like last names
 */
function splitNames(text: string): string[] {
  // Pattern: Look for sequences like "LASTNAME, Firstname" followed by another "LASTNAME"
  // This is a heuristic and may need refinement based on real data
  const names: string[] = [];
  
  // Try to split by pattern of uppercase sequences followed by comma
  const pattern = /([A-ZÀÂÄÇÉÈÊËÏÎÔÙÛÜ][A-ZÀÂÄÇÉÈÊËÏÎÔÙÛÜ\s-]+,\s*[^,]+?)(?=\s+[A-ZÀÂÄÇÉÈÊËÏÎÔÙÛÜ]{2,}|$)/g;
  const matches = text.matchAll(pattern);
  
  for (const match of matches) {
    names.push(match[1].trim());
  }
  
  // Fallback: If pattern didn't work, return as single name
  if (names.length === 0) {
    return [text];
  }
  
  return names;
}

/**
 * Normalize a field value
 * Converts [Vide] to null, trims whitespace
 */
function normalizeValue(value: string): string | null {
  const trimmed = value.trim();
  
  if (trimmed === '[Vide]' || trimmed === '' || trimmed.toLowerCase() === 'vide') {
    return null;
  }
  
  return trimmed;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


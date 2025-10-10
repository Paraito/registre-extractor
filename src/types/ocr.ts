/**
 * TypeScript types for OCR sanitization
 * These types define the clean JSON structure for storing OCR results in the database
 */

/**
 * Party involved in a land registry inscription
 */
export interface Party {
  /** Full name of the party (e.g., "BEAUREGARD, ADRIEN") */
  name: string;
  /** Role of the party (e.g., "Décédé", "Créancier Débiteur", "1ere partie") */
  role: string;
}

/**
 * A single inscription (line item) from a land registry document
 */
export interface Inscription {
  /** Date of publication/presentation (format: YYYY-MM-DD or as extracted) */
  acte_publication_date: string | null;
  /** Publication/registration number */
  acte_publication_number: string | null;
  /** Nature/type of the act (e.g., "Testament", "Hypothèque", "Servitude") */
  acte_nature: string | null;
  /** Array of parties involved in this inscription */
  parties: Party[];
  /** Remarks/notes about this inscription */
  remarques: string | null;
  /** Radiation/cancellation number if applicable */
  radiation_number: string | null;
}

/**
 * Metadata extracted from a page header
 */
export interface PageMetadata {
  /** Land registry office/district (e.g., "Montréal") */
  circonscription: string | null;
  /** Cadastre/survey area (e.g., "Cité de Montréal (quartier Sainte-Marie)") */
  cadastre: string | null;
  /** Lot number (e.g., "1358-176") */
  lot_number: string | null;
}

/**
 * Result for a single page of OCR processing
 */
export interface PageResult {
  /** Page number (1-indexed) */
  pageNumber: number;
  /** Metadata extracted from the page header */
  metadata: PageMetadata;
  /** Array of inscriptions found on this page */
  inscriptions: Inscription[];
}

/**
 * Complete sanitized OCR result for a multi-page document
 * This is the clean JSON structure stored in the database
 */
export interface SanitizedOCRResult {
  /** Array of page results, one per page in the document */
  pages: PageResult[];
}


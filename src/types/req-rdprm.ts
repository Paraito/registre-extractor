/**
 * Types for REQ (Registre des Entreprises du Québec) and RDPRM (Registre des Droits Personnels et Réels Mobiliers)
 */

// ============================================================================
// SEARCH SESSIONS
// ============================================================================
export interface SearchSession {
  id: string;
  initial_search_query: string;
  status: SearchSessionStatus;
  selected_req_company_id?: string;
  final_pdf_path?: string;
  req_completed: boolean;  // Tracks if REQ scraping is complete
  error_message?: string;
  error_details?: Record<string, any>;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type SearchSessionStatus =
  | 'pending_company_selection'  // Waiting for user to select a company
  | 'scraping_company_data'      // Fetching detailed company data
  | 'pending_name_selection'     // Waiting for user to select names for RDPRM
  | 'rdprm_in_progress'          // Running RDPRM searches
  | 'generating_pdf'             // Creating final merged PDF
  | 'completed'                  // All done
  | 'failed'                     // Error occurred
  | 'cancelled';                 // User cancelled

// ============================================================================
// REQ COMPANIES
// ============================================================================
export interface REQCompany {
  id: string;
  search_session_id: string;
  neq: string;  // Numéro d'entreprise du Québec
  company_name: string;
  status: string;
  address?: string;
  created_at: string;
}

export interface REQCompanyDetails {
  id: string;
  req_company_id: string;
  full_data: Record<string, any>;  // Complete scraped data
  names_found: string[];  // List of names extracted for RDPRM
  created_at: string;
}

// ============================================================================
// RDPRM SEARCHES
// ============================================================================
export interface RDPRMSearch {
  id: string;
  search_session_id: string;
  search_name: string;
  status: RDPRMSearchStatus;
  result_pdf_path?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type RDPRMSearchStatus =
  | 'pending'      // Waiting to be processed
  | 'in_progress'  // Currently being scraped
  | 'completed'    // Successfully completed
  | 'failed'       // Error occurred
  | 'no_results';  // Search completed but no results found

// ============================================================================
// UNIFIED WORKER JOB TYPE
// ============================================================================
export interface UnifiedWorkerJob {
  id: string;
  _job_type: 'extraction' | 'req' | 'rdprm';
  _environment: string;
  _session_id?: string;  // For RDPRM jobs
  [key: string]: any;  // Allow other properties from specific job types
}


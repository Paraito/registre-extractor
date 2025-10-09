export interface ExtractionJob {
  id: string;
  document_type: 'index' | 'actes' | 'plans_cadastraux';
  // Index and plans_cadastraux fields
  lot_number?: string;
  cadastre?: string;
  circumscription: string;
  designation_secondaire?: string;
  // Actes specific fields
  type_document?: string;
  numero_inscription?: string;
  priority: 'low' | 'normal' | 'high';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  worker_id?: string;
  attempts: number;
  max_attempts: number;
  document_url?: string;
  error_message?: string;
  error_screenshot?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  metadata?: Record<string, any>;
}

// New interface for extraction_queue table
export interface ExtractionQueueJob {
  id: string;
  document_source: 'acte' | 'index' | 'plan_cadastraux';
  document_number: string;
  document_number_normalized?: string;
  circonscription_fonciere?: string;
  cadastre?: string;
  designation_secondaire?: string;
  acte_type?: 'Acte' | 'Avis d\'adresse' | 'Radiation' | 'Acte divers';
  status_id?: number; // 1='En attente', 2='En traitement', 3='Complété', 4='Erreur', 5='Extraction Complété'
  worker_id?: string;
  attemtps?: number; // Note: typo in database column name
  max_attempts?: number;
  retry_count?: number;
  supabase_path?: string;
  error_message?: string;
  file_content?: string; // Raw OCR text (unprocessed)
  boosted_file_content?: string; // Enhanced OCR text (with corrections applied)
  searchable_file_content?: string;
  claude_file_id?: string;
  file_id_active?: boolean;
  created_at: string;
  updated_at: string;
  processing_started_at?: string;
}

// Status mapping constants for easy reference
export const EXTRACTION_STATUS = {
  EN_ATTENTE: 1,
  EN_TRAITEMENT: 2,
  COMPLETE: 3,
  ERREUR: 4,
  EXTRACTION_COMPLETE: 5
} as const;

export interface WorkerAccount {
  id: string;
  username: string;
  password: string;
  is_active: boolean;
  last_used?: string;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkerStatus {
  id: string;
  worker_id: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  current_job_id?: string;
  account_id?: string;
  last_heartbeat: string;
  started_at: string;
  jobs_completed: number;
  jobs_failed: number;
}

export interface ExtractedDocument {
  id: string;
  job_id: string;
  lot_number: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  extracted_at: string;
  metadata?: Record<string, any>;
}

export interface ExtractionConfig {
  document_type: 'index' | 'actes' | 'plans_cadastraux';
  circumscription: string;
  cadastre?: string; // Not required for actes
  lot_number?: string; // Not required for actes
  designation_secondaire?: string;
  // Actes specific fields
  type_document?: string;
  numero_inscription?: string;
}

// New interface for extraction config using queue field names
export interface ExtractionConfigQueue {
  document_source: 'acte' | 'index' | 'plan_cadastraux';
  circonscription_fonciere: string;
  cadastre?: string; // Not required for acte
  document_number_normalized: string;
  designation_secondaire?: string;
  acte_type?: string; // Only for acte
}

export interface WorkerConfig {
  workerId: string;
  account: WorkerAccount;
  headless: boolean;
  timeout: number;
}

// Custom error class for data validation errors (e.g., when contValErr appears)
export class DataValidationError extends Error {
  constructor(message: string, public originalMessage?: string) {
    super(message);
    this.name = 'DataValidationError';
  }
}
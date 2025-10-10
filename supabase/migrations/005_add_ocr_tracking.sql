-- Migration to add OCR job tracking columns to extraction_queue table
-- This enables monitoring and retry logic for OCR processing
-- Applied to NotaFlow - Dev on 2025-10-10

-- Add new status for OCR in-progress
INSERT INTO extraction_status (id, name) 
VALUES (6, 'OCR en traitement')
ON CONFLICT (id) DO NOTHING;

-- Add OCR tracking columns
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS ocr_worker_id TEXT,
ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ocr_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ocr_max_attempts INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS ocr_error TEXT,
ADD COLUMN IF NOT EXISTS ocr_last_error_at TIMESTAMPTZ;

-- Create index for finding documents ready for OCR
-- (status_id=3, document_source='index', file_content is null, ocr_attempts < ocr_max_attempts)
CREATE INDEX IF NOT EXISTS idx_extraction_queue_ocr_ready 
ON extraction_queue(status_id, document_source, created_at, ocr_attempts) 
WHERE status_id = 3 AND document_source = 'index' AND file_content IS NULL;

-- Create index for finding stuck OCR jobs (for monitoring)
CREATE INDEX IF NOT EXISTS idx_extraction_queue_ocr_stuck 
ON extraction_queue(status_id, ocr_started_at) 
WHERE status_id = 6 AND ocr_started_at IS NOT NULL;

-- Add comments
COMMENT ON COLUMN extraction_queue.ocr_worker_id IS 'Identifier of the OCR worker processing this document';
COMMENT ON COLUMN extraction_queue.ocr_started_at IS 'Timestamp when OCR processing began';
COMMENT ON COLUMN extraction_queue.ocr_completed_at IS 'Timestamp when OCR processing completed successfully';
COMMENT ON COLUMN extraction_queue.ocr_attempts IS 'Number of OCR processing attempts made';
COMMENT ON COLUMN extraction_queue.ocr_max_attempts IS 'Maximum number of OCR attempts allowed before giving up';
COMMENT ON COLUMN extraction_queue.ocr_error IS 'Most recent OCR-specific error message';
COMMENT ON COLUMN extraction_queue.ocr_last_error_at IS 'Timestamp of the most recent OCR error';


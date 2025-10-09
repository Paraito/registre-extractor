-- Migration to add OCR support to extraction_queue table
-- This migration ensures the file_content column exists and adds indexes for OCR processing

-- Add file_content column if it doesn't exist (for storing OCR results)
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS file_content TEXT;

-- Add searchable_file_content column if it doesn't exist (for full-text search)
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS searchable_file_content TEXT;

-- Add claude_file_id column if it doesn't exist (for Claude API integration)
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS claude_file_id TEXT;

-- Add file_id_active column if it doesn't exist (to track if Claude file is active)
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS file_id_active BOOLEAN DEFAULT false;

-- Create index for finding documents that need OCR processing
-- (status_id=3, document_source='index', file_content is null)
CREATE INDEX IF NOT EXISTS idx_extraction_queue_ocr_pending 
ON extraction_queue(status_id, document_source, created_at) 
WHERE status_id = 3 AND document_source = 'index' AND file_content IS NULL;

-- Create index for finding completed OCR documents
CREATE INDEX IF NOT EXISTS idx_extraction_queue_ocr_complete 
ON extraction_queue(status_id, document_source) 
WHERE status_id = 5;

-- Create index for full-text search on file_content (if using PostgreSQL full-text search)
-- This is optional but recommended for better search performance
CREATE INDEX IF NOT EXISTS idx_extraction_queue_file_content_search 
ON extraction_queue USING gin(to_tsvector('french', file_content))
WHERE file_content IS NOT NULL;

-- Add comment to document the OCR workflow
COMMENT ON COLUMN extraction_queue.file_content IS 'OCR extracted and boosted text content from the PDF document (for index documents only)';
COMMENT ON COLUMN extraction_queue.searchable_file_content IS 'Searchable version of file_content for full-text search';
COMMENT ON COLUMN extraction_queue.claude_file_id IS 'Claude API file ID for uploaded documents';
COMMENT ON COLUMN extraction_queue.file_id_active IS 'Whether the Claude file ID is still active and usable';


-- Migration to add boosted_file_content column to extraction_queue table
-- This separates raw OCR text from enhanced/corrected text

-- Add boosted_file_content column for storing enhanced OCR results
ALTER TABLE extraction_queue 
ADD COLUMN IF NOT EXISTS boosted_file_content TEXT;

-- Add index for searching boosted content
CREATE INDEX IF NOT EXISTS idx_extraction_queue_boosted_content_search 
ON extraction_queue USING gin(to_tsvector('french', boosted_file_content))
WHERE boosted_file_content IS NOT NULL;

-- Update column comments to clarify the distinction
COMMENT ON COLUMN extraction_queue.file_content IS 'Raw OCR extracted text content from the PDF document (for index documents only) - unprocessed output from Gemini Vision AI';
COMMENT ON COLUMN extraction_queue.boosted_file_content IS 'Enhanced OCR text with 60+ domain-specific correction rules applied (for index documents only) - final processed version';

-- Note: Existing documents will have NULL boosted_file_content
-- The OCR monitor will populate this field going forward
-- To backfill existing documents, run a separate migration or script


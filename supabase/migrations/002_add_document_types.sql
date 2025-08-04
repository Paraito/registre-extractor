-- Add new columns to extraction_jobs table
ALTER TABLE extraction_jobs 
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'index' CHECK (document_type IN ('index', 'actes', 'plans_cadastraux')),
ADD COLUMN IF NOT EXISTS type_document TEXT,
ADD COLUMN IF NOT EXISTS numero_inscription TEXT;

-- Update existing records to have document_type
UPDATE extraction_jobs SET document_type = 'index' WHERE document_type IS NULL;

-- Make document_type NOT NULL after updating existing records
ALTER TABLE extraction_jobs ALTER COLUMN document_type SET NOT NULL;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_document_type ON extraction_jobs(document_type);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_numero_inscription ON extraction_jobs(numero_inscription);

-- Update the view or add comments
COMMENT ON COLUMN extraction_jobs.document_type IS 'Type of document to extract: index, actes, or plans_cadastraux';
COMMENT ON COLUMN extraction_jobs.type_document IS 'For actes: Type of document (Acte, Avis d''adresse, Radiation, Acte divers)';
COMMENT ON COLUMN extraction_jobs.numero_inscription IS 'For actes: Registration number';
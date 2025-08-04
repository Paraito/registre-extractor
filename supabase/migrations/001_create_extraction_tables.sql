-- Worker accounts table
CREATE TABLE IF NOT EXISTS worker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for active accounts
CREATE INDEX idx_worker_accounts_active ON worker_accounts(is_active, failure_count);

-- Worker status table
CREATE TABLE IF NOT EXISTS worker_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'busy', 'error', 'offline')),
  current_job_id UUID,
  account_id UUID REFERENCES worker_accounts(id),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0
);

-- Create index for worker status
CREATE INDEX idx_worker_status_status ON worker_status(status);

-- Extraction jobs table
CREATE TABLE IF NOT EXISTS extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_number TEXT NOT NULL,
  circumscription TEXT NOT NULL DEFAULT 'Montréal',
  cadastre TEXT NOT NULL DEFAULT 'Cadastre du Québec',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  worker_id TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  document_url TEXT,
  error_message TEXT,
  error_screenshot TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for job queries
CREATE INDEX idx_extraction_jobs_status ON extraction_jobs(status, priority, created_at);
CREATE INDEX idx_extraction_jobs_lot ON extraction_jobs(lot_number);
CREATE INDEX idx_extraction_jobs_worker ON extraction_jobs(worker_id);

-- Extracted documents table
CREATE TABLE IF NOT EXISTS extracted_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES extraction_jobs(id),
  lot_number TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create index for document lookups
CREATE INDEX idx_extracted_documents_job ON extracted_documents(job_id);
CREATE INDEX idx_extracted_documents_lot ON extracted_documents(lot_number);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for worker_accounts
CREATE TRIGGER update_worker_accounts_updated_at BEFORE UPDATE
  ON worker_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial worker accounts (you'll need to add 20 accounts)
INSERT INTO worker_accounts (username, password) VALUES
  ('30F3315', 'Sainte-Clara1504!'),
  -- Add 19 more accounts here
  ('account2', 'password2'),
  ('account3', 'password3');

-- RLS Policies (if needed)
ALTER TABLE extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_status ENABLE ROW LEVEL SECURITY;

-- Service role has full access (using service key)
CREATE POLICY "Service role has full access to extraction_jobs" ON extraction_jobs
  FOR ALL USING (true);

CREATE POLICY "Service role has full access to extracted_documents" ON extracted_documents
  FOR ALL USING (true);

CREATE POLICY "Service role has full access to worker_accounts" ON worker_accounts
  FOR ALL USING (true);

CREATE POLICY "Service role has full access to worker_status" ON worker_status
  FOR ALL USING (true);
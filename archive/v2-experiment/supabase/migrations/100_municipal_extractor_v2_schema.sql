-- Municipal Data Extractor v2 - Database Schema
-- This is a completely separate schema from the existing extractor

-- AI Workers table
CREATE TABLE ai_workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('idle', 'busy', 'error', 'offline')),
    current_job_id UUID,
    browser_session_id TEXT,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    jobs_completed INTEGER DEFAULT 0,
    jobs_failed INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Extraction Queue v2
CREATE TABLE extraction_queue_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_url TEXT NOT NULL,
    data_type TEXT NOT NULL, -- permits, zoning, flooding, taxes, notices
    target_fields JSONB NOT NULL, -- Array of fields to extract
    filters JSONB, -- Search filters/parameters
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    worker_id TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    result_data JSONB, -- Extracted data
    standardized_data JSONB, -- Standardized format
    error_message TEXT,
    execution_trace JSONB, -- Steps taken during extraction
    cost_estimate DECIMAL, -- Estimated AI cost
    actual_cost DECIMAL, -- Actual AI cost incurred
    used_cache BOOLEAN DEFAULT FALSE, -- Whether cached process was used
    cache_hit_rate DECIMAL, -- Cache effectiveness
    processing_started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Process Cache - Stores successful extraction processes
CREATE TABLE process_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT UNIQUE NOT NULL, -- Unique identifier for this process type
    site_pattern TEXT NOT NULL, -- Site domain pattern
    data_type TEXT NOT NULL, -- Type of data extracted
    extraction_steps JSONB NOT NULL, -- Steps to perform extraction
    selectors JSONB, -- CSS/XPath selectors used
    navigation_path JSONB, -- Navigation sequence
    validation_rules JSONB, -- Rules to validate success
    success_rate DECIMAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 0,
    last_successful_use TIMESTAMP WITH TIME ZONE,
    avg_execution_time INTEGER, -- Average time in seconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Screenshot Analysis - AI analysis of page screenshots
CREATE TABLE screenshot_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES extraction_queue_v2(id) ON DELETE CASCADE,
    screenshot_path TEXT, -- Path to screenshot file
    screenshot_data BYTEA, -- Screenshot binary data (optional)
    page_url TEXT,
    analysis_result JSONB, -- AI analysis results
    visual_elements JSONB, -- Detected visual elements
    recommended_action JSONB, -- Next recommended action
    was_stuck BOOLEAN DEFAULT FALSE,
    stuck_reason TEXT,
    recovery_action JSONB,
    recovery_successful BOOLEAN,
    confidence_score DECIMAL,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Municipal Site Patterns - Known patterns for government sites
CREATE TABLE site_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_domain TEXT NOT NULL,
    site_name TEXT, -- Human readable name
    site_type TEXT NOT NULL, -- municipal, provincial, federal, flood, tax
    country TEXT DEFAULT 'CA',
    province TEXT DEFAULT 'QC',
    language TEXT DEFAULT 'fr', -- Primary language
    patterns JSONB NOT NULL, -- Site-specific patterns
    common_selectors JSONB, -- Common CSS selectors for this site
    navigation_patterns JSONB, -- Common navigation flows
    form_patterns JSONB, -- Common form structures
    data_patterns JSONB, -- Common data layouts
    rate_limits JSONB, -- Rate limiting information
    auth_required BOOLEAN DEFAULT FALSE,
    auth_patterns JSONB, -- Authentication patterns if required
    preferred_access_hours TEXT, -- Best time to access (business hours)
    known_issues JSONB, -- Known issues and workarounds
    success_rate DECIMAL DEFAULT 1.0,
    last_validated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Data Schema Registry - Standard schemas for different data types
CREATE TABLE data_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_type TEXT UNIQUE NOT NULL, -- permits, zoning, flooding, etc.
    schema_version TEXT DEFAULT '1.0',
    standard_fields JSONB NOT NULL, -- Standard field definitions
    validation_rules JSONB, -- Validation rules for each field
    transformation_rules JSONB, -- Rules for data transformation
    output_format TEXT DEFAULT 'json', -- Default output format
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Field Mappings - Map site-specific fields to standard schema
CREATE TABLE field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_pattern TEXT NOT NULL,
    data_type TEXT NOT NULL,
    site_field_name TEXT NOT NULL,
    standard_field_name TEXT NOT NULL,
    transformation_function TEXT, -- Function to transform the data
    confidence_score DECIMAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(site_pattern, data_type, site_field_name)
);

-- Extraction Analytics - Performance and cost analytics
CREATE TABLE extraction_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    site_pattern TEXT,
    data_type TEXT,
    total_extractions INTEGER DEFAULT 0,
    successful_extractions INTEGER DEFAULT 0,
    failed_extractions INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    total_ai_cost DECIMAL DEFAULT 0,
    avg_execution_time INTEGER, -- Average time in seconds
    avg_confidence_score DECIMAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(date, site_pattern, data_type)
);

-- Learning Events - Track learning and improvements
CREATE TABLE learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL, -- pattern_learned, selector_improved, recovery_successful
    job_id UUID REFERENCES extraction_queue_v2(id),
    site_pattern TEXT,
    data_type TEXT,
    event_data JSONB, -- Details of what was learned
    improvement_impact JSONB, -- Measured improvement
    confidence_score DECIMAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_ai_workers_status ON ai_workers(status);
CREATE INDEX idx_ai_workers_worker_id ON ai_workers(worker_id);
CREATE INDEX idx_extraction_queue_v2_status ON extraction_queue_v2(status);
CREATE INDEX idx_extraction_queue_v2_priority ON extraction_queue_v2(priority);
CREATE INDEX idx_extraction_queue_v2_created_at ON extraction_queue_v2(created_at);
CREATE INDEX idx_extraction_queue_v2_data_type ON extraction_queue_v2(data_type);
CREATE INDEX idx_process_cache_fingerprint ON process_cache(fingerprint);
CREATE INDEX idx_process_cache_site_pattern ON process_cache(site_pattern);
CREATE INDEX idx_process_cache_data_type ON process_cache(data_type);
CREATE INDEX idx_screenshot_analysis_job_id ON screenshot_analysis(job_id);
CREATE INDEX idx_site_patterns_domain ON site_patterns(site_domain);
CREATE INDEX idx_site_patterns_type ON site_patterns(site_type);
CREATE INDEX idx_field_mappings_lookup ON field_mappings(site_pattern, data_type);
CREATE INDEX idx_extraction_analytics_date ON extraction_analytics(date);

-- RLS (Row Level Security) policies
ALTER TABLE ai_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_queue_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenshot_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (adjust based on your auth requirements)
CREATE POLICY "Enable all operations for service role" ON ai_workers FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON extraction_queue_v2 FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON process_cache FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON screenshot_analysis FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON site_patterns FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON data_schemas FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON field_mappings FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON extraction_analytics FOR ALL USING (true);
CREATE POLICY "Enable all operations for service role" ON learning_events FOR ALL USING (true);

-- Insert default data schemas
INSERT INTO data_schemas (data_type, standard_fields, validation_rules, description) VALUES
('permits', '{
    "permit_number": {"type": "string", "required": true},
    "permit_type": {"type": "string", "required": true},
    "address": {"type": "string", "required": true},
    "applicant": {"type": "string", "required": false},
    "description": {"type": "string", "required": false},
    "date_issued": {"type": "date", "required": false},
    "date_expires": {"type": "date", "required": false},
    "status": {"type": "enum", "values": ["approved", "pending", "rejected", "expired"], "required": false},
    "value": {"type": "number", "required": false},
    "fees": {"type": "number", "required": false}
}', '{
    "permit_number": {"min_length": 1, "max_length": 100},
    "address": {"min_length": 5, "max_length": 200},
    "value": {"min": 0, "max": 999999999}
}', 'Building permits, demolition permits, occupancy permits'),

('zoning', '{
    "address": {"type": "string", "required": true},
    "zone_code": {"type": "string", "required": true},
    "zone_description": {"type": "string", "required": false},
    "allowed_uses": {"type": "array", "required": false},
    "restrictions": {"type": "array", "required": false},
    "height_limit": {"type": "number", "required": false},
    "density_limit": {"type": "number", "required": false},
    "setback_requirements": {"type": "object", "required": false},
    "last_updated": {"type": "date", "required": false}
}', '{
    "address": {"min_length": 5, "max_length": 200},
    "zone_code": {"min_length": 1, "max_length": 50}
}', 'Zoning information, bylaws, variances'),

('flooding', '{
    "location": {"type": "string", "required": true},
    "water_level": {"type": "number", "required": false},
    "flood_risk": {"type": "enum", "values": ["low", "medium", "high", "critical"], "required": false},
    "alert_status": {"type": "enum", "values": ["none", "watch", "warning", "emergency"], "required": false},
    "last_measurement": {"type": "datetime", "required": false},
    "measurement_unit": {"type": "string", "required": false},
    "historical_data": {"type": "array", "required": false},
    "evacuation_zones": {"type": "array", "required": false}
}', '{
    "location": {"min_length": 2, "max_length": 200},
    "water_level": {"min": -100, "max": 1000}
}', 'Flood data, water levels, alerts'),

('taxes', '{
    "property_id": {"type": "string", "required": true},
    "address": {"type": "string", "required": true},
    "assessed_value": {"type": "number", "required": false},
    "tax_amount": {"type": "number", "required": false},
    "tax_rate": {"type": "number", "required": false},
    "tax_year": {"type": "integer", "required": false},
    "property_type": {"type": "string", "required": false},
    "exemptions": {"type": "array", "required": false},
    "payment_status": {"type": "enum", "values": ["paid", "partial", "unpaid", "overdue"], "required": false}
}', '{
    "address": {"min_length": 5, "max_length": 200},
    "assessed_value": {"min": 0, "max": 99999999999},
    "tax_year": {"min": 2000, "max": 2050}
}', 'Tax assessments, property taxes');

-- Insert some default site patterns for Quebec municipalities
INSERT INTO site_patterns (site_domain, site_name, site_type, patterns, common_selectors, description) VALUES
('ville.montreal.qc.ca', 'Ville de Montréal', 'municipal', '{
    "base_url": "https://ville.montreal.qc.ca",
    "search_patterns": ["/permits", "/zonage", "/evaluation"],
    "language": "fr",
    "rate_limit": {"requests_per_minute": 30, "delay_between_requests": 2000}
}', '{
    "search_box": ["input[name*=\"search\"]", "#search", ".search-input"],
    "results_table": ["table", ".results", ".data-table", ".liste-resultats"],
    "pagination": [".pagination", ".pager", "[class*=\"page\"]"],
    "permit_link": ["a[href*=\"permis\"]", "a[href*=\"permit\"]"]
}', 'Montreal municipal website patterns'),

('www.quebec.ca', 'Gouvernement du Québec', 'provincial', '{
    "base_url": "https://www.quebec.ca",
    "search_patterns": ["/services", "/programmes"],
    "language": "fr",
    "rate_limit": {"requests_per_minute": 60, "delay_between_requests": 1000}
}', '{
    "search_form": ["form[action*=\"search\"]", ".search-form"],
    "data_rows": ["tr", ".result-item", ".service-item"],
    "load_more": [".load-more", "button[class*=\"more\"]"]
}', 'Quebec government website patterns'),

('gatineau.ca', 'Ville de Gatineau', 'municipal', '{
    "base_url": "https://www.gatineau.ca",
    "search_patterns": ["/services", "/permis"],
    "language": "fr",
    "rate_limit": {"requests_per_minute": 30, "delay_between_requests": 2000}
}', '{
    "navigation_menu": [".main-nav", ".menu-principal"],
    "content_area": [".content", ".contenu", "main"],
    "search_results": [".search-results", ".resultats-recherche"]
}', 'Gatineau municipal website patterns');

COMMENT ON TABLE ai_workers IS 'AI workers for municipal data extraction v2';
COMMENT ON TABLE extraction_queue_v2 IS 'Job queue for municipal data extraction requests';
COMMENT ON TABLE process_cache IS 'Cache of successful extraction processes for cost optimization';
COMMENT ON TABLE screenshot_analysis IS 'AI analysis of page screenshots for navigation assistance';
COMMENT ON TABLE site_patterns IS 'Known patterns for municipal and government websites';
COMMENT ON TABLE data_schemas IS 'Standard data schemas for different types of municipal data';
COMMENT ON TABLE field_mappings IS 'Mappings between site-specific fields and standard schemas';
COMMENT ON TABLE extraction_analytics IS 'Analytics and performance metrics';
COMMENT ON TABLE learning_events IS 'Learning and improvement tracking';
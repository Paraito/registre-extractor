# Municipal Data Extractor v2 - Master Project Plan

## Project Overview
Build a completely separate AI-powered municipal/government website data extraction system that:
- Uses AI screenshot analysis to overcome navigation challenges
- Caches successful processes for 90% cost reduction
- Focuses specifically on municipal sites (Montreal, Quebec City, flood sites, etc.)
- Uses worker-based architecture similar to v1
- Maintains complete independence from existing extractor

## Core Requirements
- ✅ Never modify the existing working extractor
- ✅ Create separate Supabase database/schema
- ✅ Use worker-based architecture
- ✅ AI screenshot analysis for stuck situations
- ✅ Process caching and reuse for cost optimization
- ✅ Municipal/government site specialization
- ✅ Standardized data output across different sites

## Architecture Components

### 1. AI Screenshot Analysis System
- **Purpose**: Analyze screenshots when navigation gets stuck
- **Components**:
  - Screenshot capture and analysis
  - Visual element identification
  - Stuck situation diagnosis
  - Recovery action generation
  - Fallback strategy execution

### 2. Process Cache & Reuse Engine
- **Purpose**: Cache successful extraction processes for cost savings
- **Components**:
  - Process fingerprinting and matching
  - Successful process storage
  - Adaptive process reuse
  - Cache performance optimization

### 3. Municipal Site Pattern Recognition
- **Purpose**: Understand common patterns in government websites
- **Components**:
  - Site pattern library (Montreal, Quebec, etc.)
  - Dynamic pattern learning
  - Government site specializations
  - Multi-language support (EN/FR)

### 4. Worker-Based Architecture
- **Purpose**: Parallel processing with isolated browser instances
- **Components**:
  - AI workers with browser automation
  - Queue management system
  - Worker health monitoring
  - Load balancing and scaling

### 5. Data Standardization Engine
- **Purpose**: Standardize extracted data across different municipal sites
- **Components**:
  - Standard municipal data schemas
  - Field mapping and transformation
  - Data validation and cleaning
  - Multi-site data normalization

## Database Schema (New Supabase DB)

### Core Tables
```sql
-- AI Workers
CREATE TABLE ai_workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('idle', 'busy', 'error', 'offline')),
    current_job_id UUID,
    browser_session_id TEXT,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    jobs_completed INTEGER DEFAULT 0,
    jobs_failed INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Extraction Queue
CREATE TABLE extraction_queue_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_url TEXT NOT NULL,
    data_type TEXT NOT NULL, -- permits, zoning, flooding, etc.
    target_fields JSONB NOT NULL,
    filters JSONB,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    worker_id TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    result_data JSONB,
    error_message TEXT,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Process Cache
CREATE TABLE process_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT UNIQUE NOT NULL,
    site_pattern TEXT NOT NULL,
    data_type TEXT NOT NULL,
    extraction_steps JSONB NOT NULL,
    selectors JSONB,
    navigation_path JSONB,
    validation_rules JSONB,
    success_rate DECIMAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 0,
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Screenshot Analysis
CREATE TABLE screenshot_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES extraction_queue_v2(id),
    screenshot_data BYTEA,
    analysis_result JSONB,
    recommended_action JSONB,
    was_stuck BOOLEAN DEFAULT FALSE,
    recovery_successful BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Municipal Site Patterns
CREATE TABLE site_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_domain TEXT NOT NULL,
    site_type TEXT NOT NULL, -- municipal, provincial, federal, flood
    patterns JSONB NOT NULL,
    common_selectors JSONB,
    navigation_patterns JSONB,
    rate_limits JSONB,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
1. **Database Setup**
   - Create new Supabase database
   - Implement database schema
   - Set up connection management

2. **Basic Worker Architecture**
   - AI worker base class
   - Queue management system
   - Worker registration and heartbeat

3. **MCP Client Setup**
   - Sequential Thinking client
   - Memory client for process storage
   - Browserbase client
   - Perplexity client

### Phase 2: AI Engine & Screenshot Analysis (Week 2)
1. **AI Screenshot Analyzer**
   - Screenshot capture system
   - AI visual analysis integration
   - Stuck situation detection
   - Recovery action generation

2. **Basic Navigation Engine**
   - Page state analysis
   - Element identification
   - Action execution
   - Progress validation

3. **Process Cache Foundation**
   - Process fingerprinting
   - Basic caching mechanism
   - Cache lookup system

### Phase 3: Municipal Specialization (Week 3)
1. **Site Pattern Recognition**
   - Montreal city patterns
   - Quebec city patterns
   - Flood site patterns
   - Generic municipal patterns

2. **Data Extraction Engine**
   - Municipal data extractors
   - Field identification
   - Data validation
   - Error handling

3. **Process Cache Intelligence**
   - Adaptive process reuse
   - Cache optimization
   - Success rate tracking

### Phase 4: Data Standardization (Week 4)
1. **Municipal Data Schemas**
   - Permit data schema
   - Zoning data schema
   - Flood data schema
   - Tax assessment schema

2. **Data Standardization Engine**
   - Field mapping system
   - Data transformation
   - Multi-site normalization
   - Quality validation

### Phase 5: Integration & Testing (Week 5)
1. **API Development**
   - REST API for job submission
   - Batch processing API
   - Cache management API
   - Monitoring endpoints

2. **Comprehensive Testing**
   - Unit tests for all components
   - Integration tests
   - Municipal site testing
   - Performance optimization

### Phase 6: Deployment & Monitoring (Week 6)
1. **Deployment Setup**
   - Docker containerization
   - Production configuration
   - Environment setup
   - CI/CD pipeline

2. **Monitoring & Analytics**
   - Performance monitoring
   - Cost tracking
   - Success rate analysis
   - Cache effectiveness metrics

## File Structure
```
src/municipal-extractor-v2/
├── core/
│   ├── ai-engine.ts                   # Main AI orchestration
│   ├── worker.ts                      # AI worker implementation
│   ├── queue-manager.ts               # Queue management
│   └── process-cache.ts               # Process caching engine
├── analysis/
│   ├── screenshot-analyzer.ts         # AI screenshot analysis
│   ├── visual-analyzer.ts             # Visual element analysis
│   ├── page-state-analyzer.ts         # Page state understanding
│   └── stuck-detector.ts              # Stuck situation detection
├── navigation/
│   ├── adaptive-navigator.ts          # Intelligent navigation
│   ├── element-finder.ts              # Element identification
│   ├── action-executor.ts             # Action execution
│   └── progress-validator.ts          # Progress validation
├── patterns/
│   ├── municipal-patterns.ts          # Municipal site patterns
│   ├── site-classifier.ts             # Site type classification
│   ├── pattern-learner.ts             # Pattern learning system
│   └── selector-optimizer.ts          # Selector optimization
├── extraction/
│   ├── data-extractor.ts              # Main extraction engine
│   ├── permit-extractor.ts            # Permit data extraction
│   ├── zoning-extractor.ts            # Zoning data extraction
│   ├── flood-extractor.ts             # Flood data extraction
│   └── tax-extractor.ts               # Tax data extraction
├── standardization/
│   ├── data-standardizer.ts           # Data standardization
│   ├── field-mapper.ts                # Field mapping
│   ├── schema-validator.ts            # Schema validation
│   └── data-cleaner.ts                # Data cleaning
├── mcp-clients/
│   ├── sequential-thinking.ts         # Sequential Thinking MCP
│   ├── memory-client.ts               # Memory MCP
│   ├── perplexity-client.ts          # Perplexity MCP
│   └── browserbase-client.ts          # Browserbase MCP
├── database/
│   ├── supabase-client.ts            # Supabase connection
│   ├── queue-operations.ts           # Queue DB operations
│   ├── cache-operations.ts           # Cache DB operations
│   └── analytics-operations.ts       # Analytics DB operations
├── api/
│   ├── extraction-api.ts             # Main API endpoints
│   ├── batch-api.ts                  # Batch processing
│   ├── cache-api.ts                  # Cache management
│   └── monitoring-api.ts             # Monitoring endpoints
├── monitoring/
│   ├── performance-monitor.ts        # Performance tracking
│   ├── cost-tracker.ts               # AI cost monitoring
│   ├── success-analyzer.ts           # Success rate analysis
│   └── cache-analyzer.ts             # Cache effectiveness
└── config/
    ├── database-config.ts            # Database configuration
    ├── mcp-config.ts                 # MCP server configs
    ├── worker-config.ts              # Worker configuration
    └── extraction-config.ts          # Extraction settings
```

## Success Metrics
- **Cost Efficiency**: 90% reduction in AI costs through process caching
- **Reliability**: 99%+ success rate for municipal data extraction
- **Performance**: < 30 seconds average extraction time
- **Coverage**: Support for 50+ municipal/government sites
- **Adaptability**: Auto-recovery from 95% of stuck situations

## Risk Mitigation
- **Site Changes**: AI screenshot analysis for adaptation
- **Rate Limiting**: Built-in delays and respectful crawling
- **Data Quality**: Multi-level validation and standardization
- **Cost Control**: Aggressive caching and batch optimization
- **Monitoring**: Comprehensive analytics and alerting

## Development Guidelines
- Use TypeScript for type safety
- Implement comprehensive error handling
- Include detailed logging for debugging
- Write tests for all critical components
- Document all APIs and configurations
- Follow existing project conventions from v1

## MCP Integration Strategy
- **Sequential Thinking**: For complex planning and reasoning
- **Memory**: For process caching and knowledge storage
- **Perplexity**: For real-time research and problem solving
- **Browserbase**: For browser automation and screenshot analysis
- **Context7**: For technical documentation when needed

This plan will be referenced throughout development to maintain focus and track progress.
# Architecture Summary - OCR King Pipeline

## Current State Analysis

### Entry Points
- **Root Package**: `package.json` - Delegates to backend
- **Gemini Server**: `backend/server.js` - Port 3001, Express API with 3 endpoints
- **Qwen Server**: `backend/qwen-server.js` - Port 3002, Qwen3-VL integration
- **Test Scripts**: 20+ scattered test files doing similar operations

### Current Pipeline Components

#### PDF Processing
- **Library**: `pdf-to-png-converter`
- **Settings**: `viewportScale: 4.0`, `disableFontFace: true`, `useSystemFonts: true`
- **Output**: PNG pages with high DPI for OCR accuracy

#### Image Upscaling
- **Library**: `sharp`
- **Method**: `lanczos3` kernel, 2x upscaling factor
- **Purpose**: Improve OCR accuracy on small text

#### Model Clients
- **Gemini**: Native `@google/generative-ai` integration
- **Claude**: `@anthropic-ai/sdk` (only in test scripts)
- **Qwen3-VL**: Custom `qwen-client.js` via vLLM OpenAI-compatible API

#### Prompt Architecture
- **Unified System**: `prompts-unified.js` - Single source of truth
- **Adapters**: `toGeminiPrompt()`, `toQwenPrompt()` for format conversion
- **Backward Compatibility**: `prompts.js` re-exports for existing code

### Current Workflow (Scattered Implementation)
```
1. Download PDF from URL
2. Convert PDF → PNG pages (pdf-to-png-converter)
3. Upscale images 2x (sharp + lanczos3)
4. OCR with various strategies:
   - Line counting (Gemini only)
   - Text extraction (Gemini/Qwen)
   - Boost/normalization (Gemini only)
5. Output scattered in tmp directories
```

## Target Architecture

### Unified E2E Pipeline
```
src/
├── server/           # HTTP endpoints or CLI entrypoints
├── pipeline/
│   ├── fetch.ts      # PDF download
│   ├── pdf_split.ts  # PDF → pages
│   ├── pdf_to_images.ts # Pages → PNG
│   ├── upscale.ts    # 2x image upscaling
│   ├── ocr_line_count.ts # Gemini + Claude consensus
│   ├── ocr_extract.ts    # Gemini/Qwen windowed extraction
│   ├── ocr_check.ts      # Claude coherence validation
│   ├── boost.ts          # Claude boost/scoring
│   └── merge.ts          # Merge per-page results
├── clients/
│   ├── gemini.ts
│   ├── claude.ts
│   └── qwen3.ts
└── util/
    ├── fs.ts
    ├── log.ts        # JSONL structured logging
    └── json.ts       # Schema validation
```

### Target Multi-Model OCR Flow
```
Step A: Line Count Consensus
├── Gemini 2.5 Pro → estimate lines
├── Claude Sonnet 4.5 → estimate lines  
└── Consensus: pick higher count

Step B: Content Extraction (Windowed)
├── Gemini: extract first 25 lines
├── If > 25 lines: additional 25-line windows
└── Alternative: Qwen3 for same extraction

Step C: Coherence Check
└── Claude Sonnet 4.5: validate structure (~5% tolerance)

Step D: Boost
└── Claude: confidence scoring + field normalization
```

## Key Gaps Preventing E2E Success

### 1. **No Unified Pipeline Orchestration**
- **Current**: Logic scattered across 20+ test scripts
- **Gap**: No single entry point for complete PDF processing
- **Impact**: Cannot run end-to-end without manual script selection

### 2. **Multi-Model Consensus Not in Main Pipeline**
- **Current**: Exists only in `test-multi-model-consensus.js`
- **Gap**: Line counting consensus not integrated into main flow
- **Impact**: Missing the specified Gemini+Claude consensus requirement

### 3. **Claude Coherence Checker Not Integrated**
- **Current**: `VERIFICATION_PROMPT_CLAUDE` exists but only in test
- **Gap**: No coherence validation in main pipeline
- **Impact**: Missing Step C of target OCR flow

### 4. **No Structured Logging/Reporting**
- **Current**: Each script has custom console output
- **Gap**: No JSONL logging, no structured reports
- **Impact**: Cannot track pipeline stages or generate required reports

### 5. **Configuration Management Scattered**
- **Current**: Settings hardcoded across multiple files
- **Gap**: No centralized config for URLs, limits, timeouts
- **Impact**: Cannot easily switch between test/production configs

### 6. **No Proper Artifacts Management**
- **Current**: Files scattered in various tmp directories
- **Gap**: No organized artifacts/, logs/, reports/ structure
- **Impact**: Cannot reliably find or clean up generated files

### 7. **Missing Schema Validation**
- **Current**: Manual JSON parsing with inconsistent error handling
- **Gap**: No TypeScript schemas for pipeline data structures
- **Impact**: Runtime errors from malformed model responses

## Dead/Duplicate/Legacy Code

### Duplicate Test Scripts
- Multiple scripts doing PDF→PNG→OCR with slight variations
- `test-page3-*.js`, `test-page4-*.js`, `test-page5-*.js` series
- `test-5runs.js`, `test-accuracy-5runs.js` - similar functionality

### Superseded Prompt Files
- `prompts-v2.js`, `prompts-v3-spatial.js` - replaced by unified system
- `prompts_v2_json_BACKUP.js` - backup file
- `prompts_v3_string.js` - superseded version

### Generated Artifacts
- PNG files in `tmp/` and `backend/tmp/` directories
- Log files in `backend/logs/` (keep structure, clean old logs)
- Output files like `output_page3_full.txt`, `PAGE5_COMPLETE_OUTPUT.json`

### Redundant Documentation
- 19 markdown files at root level with overlapping content
- Multiple README files covering similar topics
- Version-specific documentation that's outdated

## Implementation Priority

### Phase 1: Core Pipeline (High Priority)
1. Create unified configuration system
2. Implement pipeline orchestration modules
3. Integrate multi-model consensus (Gemini + Claude line counting)
4. Add Claude coherence checker to main flow

### Phase 2: Infrastructure (Medium Priority)
1. Structured JSONL logging
2. Artifacts management (artifacts/, logs/, reports/)
3. Schema validation with TypeScript/Zod
4. Error handling and retry logic

### Phase 3: Testing & Polish (Low Priority)
1. E2E test scripts for both Gemini and Qwen3 paths
2. Performance monitoring and optimization
3. Documentation cleanup and consolidation
4. CI/CD integration

## Success Metrics

### Technical
- [ ] Single command runs complete E2E pipeline
- [ ] Multi-model consensus working (Gemini + Claude)
- [ ] Claude coherence checker integrated
- [ ] Structured logs and reports generated
- [ ] Test assertions pass (page 3 & 4 > 40 lines)

### Code Quality
- [ ] No duplicate pipeline logic
- [ ] Configuration centralized
- [ ] Artifacts properly organized
- [ ] Dead code removed
- [ ] Documentation consolidated

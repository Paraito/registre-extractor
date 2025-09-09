// Municipal Data Extractor v2 - Type Definitions

// Core job and worker types
export interface ExtractionJobV2 {
  id: string;
  site_url: string;
  data_type: 'permits' | 'zoning' | 'flooding' | 'taxes' | 'notices';
  target_fields: string[];
  filters?: Record<string, any>;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  worker_id?: string;
  attempts: number;
  max_attempts: number;
  result_data?: Record<string, any>;
  standardized_data?: Record<string, any>;
  error_message?: string;
  execution_trace?: ExecutionTrace;
  cost_estimate?: number;
  actual_cost?: number;
  used_cache: boolean;
  cache_hit_rate?: number;
  processing_started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AIWorker {
  id: string;
  worker_id: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  current_job_id?: string;
  browser_session_id?: string;
  last_heartbeat: string;
  jobs_completed: number;
  jobs_failed: number;
  created_at: string;
  updated_at: string;
}

// Process caching types
export interface CachedProcess {
  id: string;
  fingerprint: string;
  site_pattern: string;
  data_type: string;
  extraction_steps: ExtractionStep[];
  selectors?: Record<string, string[]>;
  navigation_path?: NavigationStep[];
  validation_rules?: ValidationRule[];
  success_rate: number;
  usage_count: number;
  last_successful_use?: string;
  avg_execution_time?: number;
  created_at: string;
  updated_at: string;
}

export interface ExtractionStep {
  type: 'navigate' | 'search' | 'extract' | 'paginate' | 'wait' | 'click' | 'fill';
  action: string;
  target?: string;
  selector?: string;
  value?: string;
  timeout?: number;
  validation?: string;
  fallback_actions?: ExtractionStep[];
}

export interface NavigationStep {
  step_number: number;
  action: string;
  target: string;
  expected_outcome: string;
  validation_selector?: string;
}

export interface ValidationRule {
  field: string;
  rule_type: 'presence' | 'format' | 'range' | 'custom';
  rule_value: any;
  error_message: string;
}

// Screenshot analysis types
export interface ScreenshotAnalysis {
  id: string;
  job_id: string;
  screenshot_path?: string;
  screenshot_data?: Buffer;
  page_url: string;
  analysis_result: ScreenshotAnalysisResult;
  visual_elements: VisualElement[];
  recommended_action: RecommendedAction;
  was_stuck: boolean;
  stuck_reason?: string;
  recovery_action?: RecoveryAction;
  recovery_successful?: boolean;
  confidence_score: number;
  processing_time_ms: number;
  created_at: string;
}

export interface ScreenshotAnalysisResult {
  page_type: string;
  page_state: string;
  visible_forms: FormAnalysis[];
  clickable_elements: ClickableElement[];
  data_regions: DataRegion[];
  navigation_elements: NavigationElement[];
  potential_issues: string[];
  suggested_next_steps: string[];
}

export interface VisualElement {
  type: 'button' | 'input' | 'link' | 'form' | 'table' | 'text' | 'image';
  selector: string;
  text_content?: string;
  attributes: Record<string, string>;
  position: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface RecommendedAction {
  action_type: 'click' | 'fill' | 'navigate' | 'wait' | 'extract' | 'research';
  description: string;
  target_selector?: string;
  value?: string;
  confidence: number;
  fallback_actions: RecommendedAction[];
}

export interface RecoveryAction {
  strategy: string;
  steps: ExtractionStep[];
  confidence: number;
  estimated_success_rate: number;
}

// Site pattern types
export interface SitePattern {
  id: string;
  site_domain: string;
  site_name: string;
  site_type: 'municipal' | 'provincial' | 'federal' | 'flood' | 'tax';
  country: string;
  province: string;
  language: string;
  patterns: SitePatternConfig;
  common_selectors: Record<string, string[]>;
  navigation_patterns: NavigationPattern[];
  form_patterns: FormPattern[];
  data_patterns: DataPattern[];
  rate_limits: RateLimit;
  auth_required: boolean;
  auth_patterns?: AuthPattern;
  preferred_access_hours?: string;
  known_issues: KnownIssue[];
  success_rate: number;
  last_validated?: string;
  created_at: string;
  updated_at: string;
}

export interface SitePatternConfig {
  base_url: string;
  search_patterns: string[];
  language: string;
  rate_limit: RateLimit;
  common_flows: Flow[];
}

export interface RateLimit {
  requests_per_minute: number;
  delay_between_requests: number;
  burst_limit?: number;
  cooldown_period?: number;
}

export interface NavigationPattern {
  name: string;
  description: string;
  steps: NavigationStep[];
  success_indicators: string[];
}

export interface FormPattern {
  form_type: string;
  selectors: Record<string, string>;
  required_fields: string[];
  submission_method: string;
  success_indicators: string[];
}

export interface DataPattern {
  data_type: string;
  container_selectors: string[];
  field_selectors: Record<string, string>;
  pagination_pattern?: PaginationPattern;
}

export interface PaginationPattern {
  type: 'numbered' | 'next_prev' | 'infinite_scroll' | 'load_more';
  selectors: Record<string, string>;
  max_pages?: number;
}

export interface AuthPattern {
  login_url: string;
  username_selector: string;
  password_selector: string;
  submit_selector: string;
  success_indicator: string;
  failure_indicators: string[];
}

export interface KnownIssue {
  issue_type: string;
  description: string;
  workaround?: string;
  impact_level: 'low' | 'medium' | 'high';
  last_seen?: string;
}

// Data standardization types
export interface DataSchema {
  id: string;
  data_type: string;
  schema_version: string;
  standard_fields: Record<string, FieldDefinition>;
  validation_rules: Record<string, ValidationRule>;
  transformation_rules: Record<string, TransformationRule>;
  output_format: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface FieldDefinition {
  type: 'string' | 'number' | 'date' | 'datetime' | 'boolean' | 'array' | 'object' | 'enum';
  required: boolean;
  values?: string[]; // For enum type
  min_length?: number;
  max_length?: number;
  min?: number;
  max?: number;
  pattern?: string; // Regex pattern
  default_value?: any;
}

export interface TransformationRule {
  source_format: string;
  target_format: string;
  transformation_function: string;
  parameters?: Record<string, any>;
}

export interface FieldMapping {
  id: string;
  site_pattern: string;
  data_type: string;
  site_field_name: string;
  standard_field_name: string;
  transformation_function?: string;
  confidence_score: number;
  usage_count: number;
  success_rate: number;
  created_at: string;
  updated_at: string;
}

// Execution and analysis types
export interface ExecutionTrace {
  job_id: string;
  steps_executed: ExecutionStepTrace[];
  screenshots_taken: string[];
  errors_encountered: ExecutionError[];
  total_execution_time: number;
  ai_calls_made: number;
  cache_hits: number;
  cache_misses: number;
  final_success: boolean;
}

export interface ExecutionStepTrace {
  step_number: number;
  step_type: string;
  action_taken: string;
  success: boolean;
  execution_time: number;
  error_message?: string;
  screenshot_path?: string;
  ai_analysis?: any;
}

export interface ExecutionError {
  step_number: number;
  error_type: string;
  error_message: string;
  recovery_attempted: boolean;
  recovery_successful?: boolean;
  screenshot_path?: string;
}

// MCP client types
export interface SequentialThinkingRequest {
  problemDefinition: string;
  context: Record<string, any>;
  stages: string[];
}

export interface SequentialThinkingResponse {
  plan: any;
  reasoning: string[];
  confidence: number;
  estimated_steps: number;
}

export interface MemoryQuery {
  query: string;
  entityType?: string;
  limit?: number;
}

export interface MemoryEntity {
  name: string;
  entityType: string;
  observations: string[];
}

// API types
export interface ExtractionRequest {
  site_url: string;
  data_type: 'permits' | 'zoning' | 'flooding' | 'taxes' | 'notices';
  target_fields: string[];
  filters?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
}

export interface ExtractionResponse {
  job_id: string;
  status: string;
  estimated_completion_time?: number;
  estimated_cost?: number;
}

export interface BatchExtractionRequest {
  jobs: ExtractionRequest[];
  batch_priority?: 'low' | 'normal' | 'high';
  optimize_order?: boolean;
}

export interface StandardizedExtractionResult {
  success: boolean;
  data: Record<string, any>;
  confidence: number;
  source: 'cache' | 'ai' | 'hybrid';
  execution_time: number;
  cost: number;
  validation_errors?: string[];
  extraction_metadata: {
    site_pattern: string;
    cache_used: boolean;
    ai_calls_made: number;
    screenshots_analyzed: number;
    recovery_actions_taken: number;
  };
}

// Analytics types
export interface ExtractionAnalytics {
  id: string;
  date: string;
  site_pattern?: string;
  data_type?: string;
  total_extractions: number;
  successful_extractions: number;
  failed_extractions: number;
  cache_hits: number;
  cache_misses: number;
  total_ai_cost: number;
  avg_execution_time: number;
  avg_confidence_score: number;
  created_at: string;
}

export interface LearningEvent {
  id: string;
  event_type: 'pattern_learned' | 'selector_improved' | 'recovery_successful' | 'site_change_detected';
  job_id?: string;
  site_pattern: string;
  data_type: string;
  event_data: Record<string, any>;
  improvement_impact?: Record<string, any>;
  confidence_score: number;
  created_at: string;
}

// Configuration types
export interface AIWorkerConfig {
  worker_id: string;
  max_concurrent_jobs: number;
  screenshot_interval: number;
  stuck_detection_timeout: number;
  max_recovery_attempts: number;
  browser_config: BrowserConfig;
  ai_config: AIConfig;
}

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  timeout: number;
  user_agent: string;
  locale: string;
}

export interface AIConfig {
  max_tokens_per_call: number;
  temperature: number;
  cost_optimization_enabled: boolean;
  screenshot_analysis_enabled: boolean;
  learning_enabled: boolean;
}

// Utility types
export interface ProcessFingerprint {
  site_domain: string;
  data_type: string;
  target_fields_hash: string;
  filters_hash?: string;
}

export interface CacheHitResult {
  found: boolean;
  cached_process?: CachedProcess;
  similarity_score?: number;
  adaptation_required?: boolean;
}

export interface AdaptationResult {
  success: boolean;
  adapted_process?: CachedProcess;
  changes_made: string[];
  confidence: number;
}

// Form analysis types
export interface FormAnalysis {
  form_selector: string;
  action: string;
  method: string;
  fields: FormField[];
  submit_button: string;
  validation_present: boolean;
}

export interface FormField {
  name: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: string[]; // For select fields
  current_value?: string;
}

export interface ClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input';
  likely_function: string;
  confidence: number;
}

export interface DataRegion {
  selector: string;
  data_type: 'table' | 'list' | 'cards' | 'text';
  estimated_records: number;
  extraction_difficulty: 'easy' | 'medium' | 'hard';
}

export interface NavigationElement {
  type: 'menu' | 'breadcrumb' | 'pagination' | 'tab';
  selector: string;
  items: NavigationItem[];
}

export interface NavigationItem {
  text: string;
  href?: string;
  active: boolean;
}

export interface Flow {
  name: string;
  description: string;
  entry_points: string[];
  steps: FlowStep[];
  success_criteria: string[];
}

export interface FlowStep {
  step_name: string;
  action: string;
  selectors: string[];
  expected_result: string;
  timeout: number;
}

// Error types
export class MunicipalExtractionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'MunicipalExtractionError';
  }
}

export class ProcessCacheError extends Error {
  constructor(message: string, public cache_operation: string) {
    super(message);
    this.name = 'ProcessCacheError';
  }
}

export class SitePatternError extends Error {
  constructor(message: string, public site_domain: string) {
    super(message);
    this.name = 'SitePatternError';
  }
}

export class ScreenshotAnalysisError extends Error {
  constructor(message: string, public analysis_stage: string) {
    super(message);
    this.name = 'ScreenshotAnalysisError';
  }
}
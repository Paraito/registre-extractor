// Municipal Site Pattern Recognition System
// Specialized knowledge of Quebec municipal and government websites

import { logger } from '../../utils/logger';
import { supabaseV2 } from '../database/supabase-client-v2';
import { sequentialThinkingClient } from '../mcp-clients/sequential-thinking-client';
import { SitePattern, ExtractionJobV2 } from '../types';

export class MunicipalSitePatternRecognizer {
  // Pre-defined patterns for known Quebec municipal sites
  private static readonly KNOWN_PATTERNS = {
    'ville.montreal.qc.ca': {
      site_name: 'Ville de Montréal',
      site_type: 'municipal' as const,
      language: 'fr',
      common_flows: {
        permits: {
          entry_path: '/permis-certificats',
          search_path: '/permis-certificats/recherche',
          search_selectors: {
            address: 'input[name="adresse"], input[placeholder*="adresse"]',
            permit_type: 'select[name="type"], .type-permis select',
            date_from: 'input[type="date"][name*="debut"], .date-debut input',
            date_to: 'input[type="date"][name*="fin"], .date-fin input'
          },
          result_selectors: {
            permit_number: '.numero-permis, .permit-number, td:first-child',
            address: '.adresse, .address, td:nth-child(2)',
            permit_type: '.type-permis, .permit-type, td:nth-child(3)',
            status: '.statut, .status, td:nth-child(4)',
            date_issued: '.date-emission, .date-issued, td:nth-child(5)'
          },
          pagination: {
            type: 'numbered',
            next_selector: '.pagination .next, .suivant',
            page_numbers: '.pagination a[href*="page"]'
          }
        },
        zoning: {
          entry_path: '/zonage',
          search_path: '/zonage/recherche',
          search_selectors: {
            address: 'input[name="adresse"]',
            arrondissement: 'select[name="arrondissement"]'
          },
          result_selectors: {
            zone_code: '.code-zone, .zone',
            zone_description: '.description-zone',
            allowed_uses: '.usages-permis li',
            restrictions: '.restrictions li'
          }
        }
      },
      rate_limits: {
        requests_per_minute: 30,
        delay_between_requests: 2000
      },
      known_issues: [
        {
          issue_type: 'session_timeout',
          description: 'Session expires after 30 minutes of inactivity',
          workaround: 'Refresh page periodically during long extractions'
        }
      ]
    },

    'ville.quebec.qc.ca': {
      site_name: 'Ville de Québec',
      site_type: 'municipal' as const,
      language: 'fr',
      common_flows: {
        permits: {
          entry_path: '/services/permis-certificats',
          search_path: '/services/permis-certificats/consulter',
          search_selectors: {
            address: '#adresse, input[placeholder*="Adresse"]',
            sector: 'select[name="secteur"]'
          },
          result_selectors: {
            permit_number: '.numero, .no-permis',
            description: '.description',
            status: '.statut',
            date: '.date'
          }
        }
      },
      rate_limits: {
        requests_per_minute: 25,
        delay_between_requests: 2500
      }
    },

    'gatineau.ca': {
      site_name: 'Ville de Gatineau',
      site_type: 'municipal' as const,
      language: 'fr',
      common_flows: {
        permits: {
          entry_path: '/portail/services',
          search_selectors: {
            search_box: '.search-box input, #recherche'
          }
        }
      },
      rate_limits: {
        requests_per_minute: 20,
        delay_between_requests: 3000
      }
    },

    'quebec.ca': {
      site_name: 'Gouvernement du Québec',
      site_type: 'provincial' as const,
      language: 'fr',
      common_flows: {
        general: {
          search_selectors: {
            global_search: '#search, .search-input',
            topic_selector: '.theme-selector'
          }
        }
      },
      rate_limits: {
        requests_per_minute: 60,
        delay_between_requests: 1000
      }
    },

    // Flood monitoring sites
    'cehq.gouv.qc.ca': {
      site_name: 'Centre d\'expertise hydrique du Québec',
      site_type: 'flood' as const,
      language: 'fr',
      common_flows: {
        flooding: {
          entry_path: '/surveillance-cours-eau',
          search_selectors: {
            station_search: '#station, input[placeholder*="station"]',
            region_select: 'select[name="region"]'
          },
          result_selectors: {
            water_level: '.niveau-eau, .water-level',
            flow_rate: '.debit, .flow-rate',
            alert_status: '.alerte, .alert',
            last_update: '.derniere-maj, .last-update'
          }
        }
      },
      rate_limits: {
        requests_per_minute: 40,
        delay_between_requests: 1500
      }
    }
  };

  constructor() {}

  /**
   * Recognize site pattern for given URL
   */
  async recognizeSitePattern(url: string): Promise<SitePattern | null> {
    try {
      const domain = new URL(url).hostname;
      logger.info({ url, domain }, 'Recognizing site pattern');

      // Check if we have this pattern cached in database
      const cachedPattern = await supabaseV2.getSitePattern(domain);
      if (cachedPattern) {
        logger.info({ domain, pattern_id: cachedPattern.id }, 'Found cached site pattern');
        return cachedPattern;
      }

      // Check known patterns
      const knownPattern = this.findKnownPattern(domain);
      if (knownPattern) {
        // Save to database for future use
        const savedPattern = await this.saveSitePattern(domain, knownPattern);
        logger.info({ domain, pattern_id: savedPattern.id }, 'Recognized known site pattern');
        return savedPattern;
      }

      // Analyze unknown site with AI
      const analyzedPattern = await this.analyzeUnknownSite(url);
      if (analyzedPattern) {
        logger.info({ domain, pattern_id: analyzedPattern.id }, 'Analyzed new site pattern');
        return analyzedPattern;
      }

      logger.warn({ url }, 'Could not recognize site pattern');
      return null;

    } catch (error) {
      logger.error({ error, url }, 'Failed to recognize site pattern');
      return null;
    }
  }

  /**
   * Get extraction strategy for specific site and data type
   */
  async getExtractionStrategy(
    sitePattern: SitePattern,
    dataType: string,
    targetFields: string[]
  ): Promise<{
    navigation_steps: any[];
    extraction_selectors: Record<string, string>;
    validation_rules: any[];
    estimated_difficulty: 'easy' | 'medium' | 'hard';
  }> {
    logger.info({ 
      site_domain: sitePattern.site_domain,
      data_type: dataType 
    }, 'Getting extraction strategy');

    // Get strategy from known patterns
    const knownStrategy = this.getKnownExtractionStrategy(sitePattern, dataType, targetFields);
    if (knownStrategy) {
      return knownStrategy;
    }

    // Generate AI-powered strategy
    const aiStrategy = await this.generateAIExtractionStrategy(sitePattern, dataType, targetFields);
    return aiStrategy;
  }

  /**
   * Update site pattern based on extraction success/failure
   */
  async updatePatternFromExperience(
    sitePattern: SitePattern,
    job: ExtractionJobV2,
    success: boolean,
    executionTrace?: any,
    issues?: string[]
  ): Promise<void> {
    try {
      logger.info({ 
        site_domain: sitePattern.site_domain,
        job_id: job.id,
        success 
      }, 'Updating pattern from experience');

      // Update success rate
      await supabaseV2.updateSitePatternSuccess(sitePattern.site_domain, success);

      // If there were issues, update known issues
      if (issues && issues.length > 0) {
        const updatedIssues = [...(sitePattern.known_issues || [])];
        
        issues.forEach(issue => {
          const existingIssue = updatedIssues.find(ki => ki.description.includes(issue));
          if (!existingIssue) {
            updatedIssues.push({
              issue_type: 'extraction_issue',
              description: issue,
              impact_level: 'medium' as const,
              last_seen: new Date().toISOString()
            });
          }
        });

        // Update pattern with new issues (this would require additional database operations)
        logger.info({ 
          site_domain: sitePattern.site_domain,
          new_issues: issues.length 
        }, 'Pattern updated with new issues');
      }

      // Record learning event
      await supabaseV2.recordLearningEvent({
        event_type: success ? 'pattern_learned' : 'site_change_detected',
        job_id: job.id,
        site_pattern: sitePattern.site_domain,
        data_type: job.data_type,
        event_data: {
          success,
          issues: issues || [],
          execution_time: executionTrace?.total_execution_time || 0
        },
        confidence_score: success ? 0.8 : 0.3
      });

    } catch (error) {
      logger.error({ error, site_domain: sitePattern.site_domain }, 'Failed to update pattern from experience');
    }
  }

  /**
   * Find patterns for similar municipal sites
   */
  async findSimilarSitePatterns(
    sitePattern: SitePattern,
    dataType: string
  ): Promise<SitePattern[]> {
    try {
      const similarPatterns = await supabaseV2.getSitePatternByType(sitePattern.site_type);
      
      return similarPatterns
        .filter(pattern => 
          pattern.site_domain !== sitePattern.site_domain &&
          pattern.success_rate >= 0.7 &&
          this.hasDataTypeSupport(pattern, dataType)
        )
        .sort((a, b) => b.success_rate - a.success_rate)
        .slice(0, 5);

    } catch (error) {
      logger.error({ error, site_domain: sitePattern.site_domain }, 'Failed to find similar patterns');
      return [];
    }
  }

  private findKnownPattern(domain: string): any | null {
    // Direct match
    if (MunicipalSitePatternRecognizer.KNOWN_PATTERNS[domain as keyof typeof MunicipalSitePatternRecognizer.KNOWN_PATTERNS]) {
      return MunicipalSitePatternRecognizer.KNOWN_PATTERNS[domain as keyof typeof MunicipalSitePatternRecognizer.KNOWN_PATTERNS];
    }

    // Partial match for subdomains
    for (const [knownDomain, pattern] of Object.entries(MunicipalSitePatternRecognizer.KNOWN_PATTERNS)) {
      if (domain.includes(knownDomain) || knownDomain.includes(domain)) {
        return pattern;
      }
    }

    return null;
  }

  private async saveSitePattern(domain: string, pattern: any): Promise<SitePattern> {
    const sitePattern: Partial<SitePattern> = {
      site_domain: domain,
      site_name: pattern.site_name,
      site_type: pattern.site_type,
      country: 'CA',
      province: 'QC',
      language: pattern.language,
      patterns: {
        base_url: `https://${domain}`,
        search_patterns: Object.values(pattern.common_flows || {}).map((flow: any) => flow.entry_path || '/'),
        language: pattern.language,
        rate_limit: pattern.rate_limits,
        common_flows: Object.values(pattern.common_flows || {})
      },
      common_selectors: this.extractCommonSelectors(pattern),
      navigation_patterns: this.extractNavigationPatterns(pattern),
      form_patterns: this.extractFormPatterns(pattern),
      data_patterns: this.extractDataPatterns(pattern),
      rate_limits: pattern.rate_limits,
      auth_required: false,
      known_issues: pattern.known_issues || [],
      success_rate: 1.0
    };

    // This would save to database - for now return mock
    return {
      id: 'pattern_' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...sitePattern
    } as SitePattern;
  }

  private async analyzeUnknownSite(url: string): Promise<SitePattern | null> {
    try {
      logger.info({ url }, 'Analyzing unknown site with AI');

      // This would use browserbase to analyze the site
      const mockContent = `Municipal website with search functionality`;

      const analysis = await sequentialThinkingClient.analyzeSitePattern({
        site_url: url,
        site_content: mockContent,
        data_type: 'general'
      });

      if (analysis.confidence < 0.6) {
        logger.warn({ url, confidence: analysis.confidence }, 'Low confidence in site analysis');
        return null;
      }

      // Convert AI analysis to site pattern
      const domain = new URL(url).hostname;
      const analyzedPattern: Partial<SitePattern> = {
        site_domain: domain,
        site_name: this.extractSiteName(domain),
        site_type: this.classifySiteType(domain, analysis),
        country: 'CA',
        province: this.extractProvince(domain),
        language: this.detectLanguage(analysis),
        patterns: {
          base_url: url,
          search_patterns: ['/'],
          language: 'fr',
          rate_limit: { requests_per_minute: 30, delay_between_requests: 2000 },
          common_flows: []
        },
        common_selectors: {},
        navigation_patterns: [],
        form_patterns: [],
        data_patterns: [],
        rate_limits: { requests_per_minute: 30, delay_between_requests: 2000 },
        auth_required: false,
        known_issues: [],
        success_rate: analysis.confidence
      };

      return {
        id: 'analyzed_' + Date.now(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...analyzedPattern
      } as SitePattern;

    } catch (error) {
      logger.error({ error, url }, 'Failed to analyze unknown site');
      return null;
    }
  }

  private getKnownExtractionStrategy(
    sitePattern: SitePattern,
    dataType: string,
    targetFields: string[]
  ): any | null {
    const knownPattern = MunicipalSitePatternRecognizer.KNOWN_PATTERNS[sitePattern.site_domain as keyof typeof MunicipalSitePatternRecognizer.KNOWN_PATTERNS];
    if (!knownPattern || !knownPattern.common_flows) return null;

    const flow = knownPattern.common_flows[dataType as keyof typeof knownPattern.common_flows] as any;
    if (!flow) return null;

    return {
      navigation_steps: [
        {
          step_number: 1,
          action: 'navigate',
          target: flow.entry_path,
          expected_outcome: 'Reached entry page'
        },
        {
          step_number: 2,
          action: 'navigate',
          target: flow.search_path || flow.entry_path,
          expected_outcome: 'Reached search page'
        }
      ],
      extraction_selectors: flow.result_selectors || {},
      validation_rules: targetFields.map(field => ({
        field,
        rule_type: 'presence',
        rule_value: true,
        error_message: `Field ${field} must be present`
      })),
      estimated_difficulty: 'easy' as const
    };
  }

  private async generateAIExtractionStrategy(
    sitePattern: SitePattern,
    dataType: string,
    targetFields: string[]
  ): Promise<any> {
    logger.info({ 
      site_domain: sitePattern.site_domain,
      data_type: dataType 
    }, 'Generating AI extraction strategy');

    // Use Sequential Thinking to generate strategy
    const strategy = await sequentialThinkingClient.generateExtractionPlan({
      site_url: `https://${sitePattern.site_domain}`,
      data_type: dataType,
      target_fields: targetFields,
      context: {
        site_type: sitePattern.site_type,
        language: sitePattern.language,
        known_patterns: sitePattern.common_selectors
      }
    });

    return {
      navigation_steps: this.convertPlanToNavigationSteps(strategy),
      extraction_selectors: this.generateExtractionSelectors(targetFields, sitePattern),
      validation_rules: targetFields.map(field => ({
        field,
        rule_type: 'presence',
        rule_value: true,
        error_message: `Field ${field} must be present`
      })),
      estimated_difficulty: strategy.confidence > 0.8 ? 'easy' : strategy.confidence > 0.6 ? 'medium' : 'hard'
    };
  }

  private extractCommonSelectors(pattern: any): Record<string, string[]> {
    const selectors: Record<string, string[]> = {};
    
    Object.values(pattern.common_flows || {}).forEach((flow: any) => {
      if (flow.search_selectors) {
        Object.entries(flow.search_selectors).forEach(([key, selector]) => {
          if (!selectors[key]) selectors[key] = [];
          if (Array.isArray(selector)) {
            selectors[key].push(...selector);
          } else {
            selectors[key].push(selector as string);
          }
        });
      }
    });

    return selectors;
  }

  private extractNavigationPatterns(pattern: any): any[] {
    return Object.entries(pattern.common_flows || {}).map(([flowName, flow]) => ({
      name: flowName,
      description: `Navigate to ${flowName} section`,
      steps: [
        {
          step_number: 1,
          action: 'navigate',
          target: (flow as any).entry_path || '/',
          expected_outcome: 'Page loaded'
        }
      ],
      success_indicators: ['Page content loaded', 'No error messages']
    }));
  }

  private extractFormPatterns(pattern: any): any[] {
    const formPatterns: any[] = [];
    
    Object.values(pattern.common_flows || {}).forEach((flow: any) => {
      if (flow.search_selectors) {
        formPatterns.push({
          form_type: 'search',
          selectors: flow.search_selectors,
          required_fields: Object.keys(flow.search_selectors),
          submission_method: 'submit',
          success_indicators: ['Results loaded', 'No error messages']
        });
      }
    });

    return formPatterns;
  }

  private extractDataPatterns(pattern: any): any[] {
    const dataPatterns: any[] = [];
    
    Object.values(pattern.common_flows || {}).forEach((flow: any) => {
      if (flow.result_selectors) {
        dataPatterns.push({
          data_type: 'search_results',
          container_selectors: ['table', '.results', '.data-container'],
          field_selectors: flow.result_selectors,
          pagination_pattern: flow.pagination
        });
      }
    });

    return dataPatterns;
  }

  private hasDataTypeSupport(pattern: SitePattern, dataType: string): boolean {
    return pattern.data_patterns.some(dp => 
      dp.data_type === dataType || 
      dp.data_type === 'general' ||
      Object.keys(dp.field_selectors || {}).length > 0
    );
  }

  private extractSiteName(domain: string): string {
    if (domain.includes('montreal')) return 'Ville de Montréal';
    if (domain.includes('quebec')) return 'Ville de Québec';
    if (domain.includes('gatineau')) return 'Ville de Gatineau';
    if (domain.includes('gouv.qc.ca')) return 'Gouvernement du Québec';
    
    // Generic name based on domain
    return domain.replace(/^www\./, '').replace(/\.(ca|qc\.ca)$/, '');
  }

  private classifySiteType(domain: string, _analysis: any): 'municipal' | 'provincial' | 'federal' | 'flood' | 'tax' {
    if (domain.includes('ville.')) return 'municipal';
    if (domain.includes('gouv.qc.ca')) return 'provincial';
    if (domain.includes('gc.ca')) return 'federal';
    if (domain.includes('cehq') || domain.includes('flood') || domain.includes('inondation')) return 'flood';
    
    return 'municipal'; // Default
  }

  private extractProvince(domain: string): string {
    if (domain.includes('.qc.ca') || domain.includes('quebec')) return 'QC';
    if (domain.includes('.on.ca') || domain.includes('ontario')) return 'ON';
    if (domain.includes('.bc.ca')) return 'BC';
    
    return 'QC'; // Default for this system
  }

  private detectLanguage(_analysis: any): string {
    // Would analyze content for language detection
    return 'fr'; // Default for Quebec
  }

  private convertPlanToNavigationSteps(strategy: any): any[] {
    if (!strategy.plan?.stages) return [];

    return strategy.plan.stages.map((stage: any, index: number) => ({
      step_number: index + 1,
      action: stage.name,
      target: stage.actions?.[0] || 'unknown',
      expected_outcome: stage.expected_outcome || 'Step completed'
    }));
  }

  private generateExtractionSelectors(targetFields: string[], sitePattern: SitePattern): Record<string, string> {
    const selectors: Record<string, string> = {};
    
    targetFields.forEach(field => {
      // Try to find field in known selectors
      const knownSelector = sitePattern.common_selectors[field];
      if (knownSelector && knownSelector.length > 0) {
        selectors[field] = knownSelector[0];
      } else {
        // Generate generic selectors
        selectors[field] = this.generateGenericSelector(field);
      }
    });

    return selectors;
  }

  private generateGenericSelector(field: string): string {
    const fieldLower = field.toLowerCase();
    
    // Common field selector patterns for municipal sites
    const selectorMappings = {
      address: '[data-field="address"], .address, .adresse, input[name*="address"], input[name*="adresse"]',
      permit_number: '.permit-number, .numero-permis, .permit-no, td:first-child',
      date: '.date, .date-emission, input[type="date"]',
      status: '.status, .statut, .etat',
      type: '.type, .type-permis, select[name*="type"]',
      description: '.description, .desc, .details'
    };

    // Check for direct matches
    for (const [key, selector] of Object.entries(selectorMappings)) {
      if (fieldLower.includes(key)) {
        return selector;
      }
    }

    // Generate generic selector
    return `[data-field="${field}"], .${field}, #${field}, input[name="${field}"]`;
  }
}

export const municipalPatternRecognizer = new MunicipalSitePatternRecognizer();
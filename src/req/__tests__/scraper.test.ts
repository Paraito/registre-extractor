/**
 * Integration tests for REQ scraper
 */

import { REQScraper, scrapeRegistreEntreprise } from '../scraper';
import type { SearchSession } from '../../types/req-rdprm';

describe('REQ Scraper', () => {
  const mockSession: SearchSession = {
    id: 'test-session-123',
    initial_search_query: '1234567890',
    status: 'pending_company_selection',
    req_completed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  describe('REQScraper class', () => {
    it('should instantiate with a session', () => {
      const scraper = new REQScraper(mockSession);
      expect(scraper).toBeDefined();
      expect(scraper).toBeInstanceOf(REQScraper);
    });

    it('should have required methods', () => {
      const scraper = new REQScraper(mockSession);
      expect(typeof scraper.initialize).toBe('function');
      expect(typeof scraper.close).toBe('function');
      expect(typeof scraper.searchCompanies).toBe('function');
      expect(typeof scraper.scrapeCompanyDetails).toBe('function');
    });
  });

  describe('scrapeRegistreEntreprise function', () => {
    it('should be exported and callable', () => {
      expect(typeof scrapeRegistreEntreprise).toBe('function');
    });

    // Note: Full integration test would require:
    // 1. Real browser environment
    // 2. Network access to REQ website
    // 3. Valid test data
    // These should be run separately in e2e tests
  });

  describe('REQScraper initialization', () => {
    it('should create download directory path', () => {
      const scraper = new REQScraper(mockSession);
      // @ts-ignore - accessing private property for testing
      expect(scraper.downloadPath).toContain(mockSession.id);
    });
  });
});


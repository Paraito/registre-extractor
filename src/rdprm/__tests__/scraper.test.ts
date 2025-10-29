/**
 * Integration tests for RDPRM scraper
 */

import { RDPRMScraper, scrapeRDPRM } from '../scraper';
import type { RDPRMSearch } from '../../types/req-rdprm';

describe('RDPRM Scraper', () => {
  const mockSearch: RDPRMSearch = {
    id: 'test-search-456',
    search_session_id: 'test-session-123',
    search_name: 'John Doe',
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  describe('RDPRMScraper class', () => {
    it('should instantiate with a search', () => {
      const scraper = new RDPRMScraper(mockSearch);
      expect(scraper).toBeDefined();
      expect(scraper).toBeInstanceOf(RDPRMScraper);
    });

    it('should have required methods', () => {
      const scraper = new RDPRMScraper(mockSearch);
      expect(typeof scraper.initialize).toBe('function');
      expect(typeof scraper.close).toBe('function');
      expect(typeof scraper.searchByName).toBe('function');
      expect(typeof scraper.downloadResults).toBe('function');
    });
  });

  describe('scrapeRDPRM function', () => {
    it('should be exported and callable', () => {
      expect(typeof scrapeRDPRM).toBe('function');
    });

    // Note: Full integration test would require:
    // 1. Real browser environment
    // 2. Network access to RDPRM website
    // 3. Valid test data
    // These should be run separately in e2e tests
  });

  describe('RDPRMScraper initialization', () => {
    it('should create download directory path', () => {
      const scraper = new RDPRMScraper(mockSearch);
      // @ts-ignore - accessing private property for testing
      expect(scraper.downloadPath).toContain(mockSearch.id);
    });
  });
});


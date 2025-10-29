/**
 * RDPRM (Registre des Droits Personnels et Réels Mobiliers) Scraper
 * Scrapes personal and movable real rights information
 *
 * Website: https://www.rdprm.gouv.qc.ca/
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { wrap, PageExt } from 'agentql';
import { logger } from '../utils/logger';
import { supabaseManager } from '../utils/supabase';
import type { RDPRMSearch } from '../types/req-rdprm';
import path from 'path';
import fs from 'fs/promises';

/**
 * RDPRM Scraper Class
 * Handles scraping of Personal and Movable Real Rights Registry
 */
export class RDPRMScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private agentQLPage: PageExt | null = null;
  private downloadPath: string;

  constructor(private search: RDPRMSearch) {
    const baseDir = process.env.DOWNLOADS_DIR || '/tmp/rdprm-downloads';
    this.downloadPath = path.join(baseDir, search.id);
  }

  async initialize(): Promise<void> {
    logger.info({ searchId: this.search.id }, 'Initializing RDPRM scraper');

    // Create download directory
    await fs.mkdir(this.downloadPath, { recursive: true });

    // Launch browser
    this.browser = await chromium.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.context = await this.browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1920, height: 1080 },
    });

    this.page = await this.context.newPage();
    this.agentQLPage = await wrap(this.page);

    logger.info({ searchId: this.search.id }, 'RDPRM scraper initialized');
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.agentQLPage = null;
    }
  }

  /**
   * Search RDPRM by name
   */
  async searchByName(): Promise<boolean> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    logger.info({
      searchId: this.search.id,
      searchName: this.search.search_name
    }, 'Searching RDPRM by name');

    try {
      // Navigate to RDPRM consultation page
      await this.page.goto('https://www.rdprm.gouv.qc.ca/Consultation/', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Accept terms if present
      await this.acceptTermsIfPresent();

      // Navigate to search by name
      const searchTypeQuery = `{
        searchByNameLink(description: "Link or button to search by name, might say 'Par nom' or 'By name'")
      }`;

      const { searchByNameLink } = await this.agentQLPage.queryElements(searchTypeQuery);

      if (searchByNameLink) {
        await searchByNameLink.click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        logger.info('Navigated to search by name');
      }

      // Fill search form
      const searchFormQuery = `{
        nameInput(description: "Input field for person or company name")
        searchButton(description: "Button to submit search, might say 'Rechercher' or 'Search'")
      }`;

      const { nameInput, searchButton } = await this.agentQLPage.queryElements(searchFormQuery);

      if (!nameInput || !searchButton) {
        throw new Error('Could not find search form elements');
      }

      // Fill name
      await nameInput.fill(this.search.search_name);
      logger.info('Filled search name');

      // Click search
      await searchButton.click();
      logger.info('Clicked search button');

      // Wait for results
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });

      // Check if results found
      const hasResults = await this.checkForResults();

      return hasResults;

    } catch (error) {
      logger.error({
        error,
        searchId: this.search.id
      }, 'Failed to search RDPRM');
      throw error;
    }
  }

  /**
   * Accept terms and conditions if present
   */
  private async acceptTermsIfPresent(): Promise<void> {
    if (!this.page || !this.agentQLPage) return;

    try {
      const termsQuery = `{
        acceptButton(description: "Button to accept terms, might say 'Accepter' or 'Accept'")
      }`;

      const { acceptButton } = await this.agentQLPage.queryElements(termsQuery);

      if (acceptButton) {
        await acceptButton.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        logger.info('Accepted terms and conditions');
      }
    } catch (error) {
      logger.debug({ error }, 'No terms to accept or already accepted');
    }
  }

  /**
   * Check if search returned results
   */
  private async checkForResults(): Promise<boolean> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    try {
      // Look for results table or "no results" message
      const resultsQuery = `{
        resultsTable(description: "Table containing search results")
        noResultsMessage(description: "Message indicating no results found")
      }`;

      const { resultsTable, noResultsMessage } = await this.agentQLPage.queryElements(resultsQuery);

      if (noResultsMessage) {
        logger.info({ searchId: this.search.id }, 'No results found in RDPRM');
        return false;
      }

      if (resultsTable) {
        logger.info({ searchId: this.search.id }, 'Results found in RDPRM');
        return true;
      }

      // If neither found, assume no results
      logger.warn({ searchId: this.search.id }, 'Could not determine if results exist');
      return false;

    } catch (error) {
      logger.error({ error, searchId: this.search.id }, 'Failed to check for results');
      return false;
    }
  }

  /**
   * Download results as PDF
   */
  async downloadResults(): Promise<string | null> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    logger.info({ searchId: this.search.id }, 'Downloading RDPRM results');

    try {
      // Look for download/print button
      const downloadQuery = `{
        downloadButton(description: "Button to download or print results as PDF")
        printButton(description: "Button to print results")
      }`;

      const { downloadButton, printButton } = await this.agentQLPage.queryElements(downloadQuery);

      const buttonToClick = downloadButton || printButton;

      if (!buttonToClick) {
        logger.warn({ searchId: this.search.id }, 'No download button found');
        return null;
      }

      // Set up download promise
      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });

      // Click download button
      await buttonToClick.click();
      logger.info('Clicked download button');

      // Wait for download
      const download = await downloadPromise;
      const fileName = `rdprm_${this.search.search_name.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const savedPath = path.join(this.downloadPath, fileName);

      await download.saveAs(savedPath);

      logger.info({
        searchId: this.search.id,
        savedPath
      }, 'RDPRM results downloaded');

      return savedPath;

    } catch (error) {
      logger.error({
        error,
        searchId: this.search.id
      }, 'Failed to download RDPRM results');
      return null;
    }
  }
}

/**
 * Main scraping function called by unified worker
 */
export async function scrapeRDPRM(search: RDPRMSearch): Promise<void> {
  const scraper = new RDPRMScraper(search);

  try {
    await scraper.initialize();

    // Step 1: Search by name
    const hasResults = await scraper.searchByName();

    if (!hasResults) {
      logger.info({ searchId: search.id }, 'No results found - marking as no_results');

      // Update status to no_results
      const client = supabaseManager.getServiceClient('prod'); // Use appropriate environment
      if (client) {
        await client
          .from('rdprm_searches')
          .update({
            status: 'no_results',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', search.id);
      }

      return;
    }

    // Step 2: Download results
    const pdfPath = await scraper.downloadResults();

    if (pdfPath) {
      // TODO: Upload to Supabase storage and save path
      logger.info({
        searchId: search.id,
        pdfPath
      }, 'RDPRM results saved locally');
    }

    logger.info({ searchId: search.id }, '✅ RDPRM scraping completed successfully');

  } catch (error) {
    logger.error({ error, searchId: search.id }, '❌ RDPRM scraping failed');
    throw error;
  } finally {
    await scraper.close();
  }
}


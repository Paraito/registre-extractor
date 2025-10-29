/**
 * REQ (Registre des Entreprises du Québec) Scraper
 * Scrapes company information from Quebec Business Registry
 *
 * Website: https://www.registreentreprises.gouv.qc.ca/
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { wrap, PageExt } from 'agentql';
import { logger } from '../utils/logger';
import { supabaseManager } from '../utils/supabase';
import type { SearchSession, REQCompany, REQCompanyDetails } from '../types/req-rdprm';
import path from 'path';
import fs from 'fs/promises';

/**
 * REQ Scraper Class
 * Handles scraping of Quebec Business Registry
 */
export class REQScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private agentQLPage: PageExt | null = null;
  private downloadPath: string;

  constructor(private session: SearchSession) {
    const baseDir = process.env.DOWNLOADS_DIR || '/tmp/req-downloads';
    this.downloadPath = path.join(baseDir, session.id);
  }

  async initialize(): Promise<void> {
    logger.info({ sessionId: this.session.id }, 'Initializing REQ scraper');

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

    logger.info({ sessionId: this.session.id }, 'REQ scraper initialized');
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
   * Search for companies by query (name or NEQ)
   */
  async searchCompanies(): Promise<REQCompany[]> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    logger.info({
      sessionId: this.session.id,
      query: this.session.initial_search_query
    }, 'Searching REQ for companies');

    try {
      // Navigate to REQ search page
      await this.page.goto('https://www.registreentreprises.gouv.qc.ca/RQAnglais/recherche/RechercheEntreprise.aspx', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Find search input and button using AgentQL
      const searchQuery = `{
        searchInput(description: "Input field for company name or NEQ number")
        searchButton(description: "Button to submit search, might say 'Search' or 'Rechercher'")
      }`;

      const { searchInput, searchButton } = await this.agentQLPage.queryElements(searchQuery);

      if (!searchInput || !searchButton) {
        throw new Error('Could not find search form elements');
      }

      // Fill search query
      await searchInput.fill(this.session.initial_search_query);
      logger.info('Filled search query');

      // Click search button
      await searchButton.click();
      logger.info('Clicked search button');

      // Wait for results
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });

      // Extract company results
      const companies = await this.extractCompanyResults();

      logger.info({
        sessionId: this.session.id,
        count: companies.length
      }, 'Found companies in REQ');

      return companies;

    } catch (error) {
      logger.error({
        error,
        sessionId: this.session.id
      }, 'Failed to search REQ');
      throw error;
    }
  }

  /**
   * Extract company results from search page
   */
  private async extractCompanyResults(): Promise<REQCompany[]> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    try {
      // Use AgentQL to find company results
      const resultsQuery = `{
        companyRows(description: "Table rows or list items containing company information with NEQ, name, and status")[]
      }`;

      const { companyRows } = await this.agentQLPage.queryElements(resultsQuery);

      if (!companyRows || companyRows.length === 0) {
        logger.warn({ sessionId: this.session.id }, 'No companies found in search results');
        return [];
      }

      const companies: REQCompany[] = [];

      for (const row of companyRows) {
        try {
          // Extract company data from row
          const rowQuery = `{
            neqNumber(description: "NEQ number or enterprise number")
            companyName(description: "Company or enterprise name")
            status(description: "Company status like Active, Inactive, etc")
            address(description: "Company address")
          }`;

          const wrappedRow = await wrap(row);
          const rowData = await wrappedRow.queryElements(rowQuery);

          const neq = await rowData.neqNumber?.textContent() || '';
          const name = await rowData.companyName?.textContent() || '';
          const status = await rowData.status?.textContent() || '';
          const address = await rowData.address?.textContent() || '';

          if (neq && name) {
            companies.push({
              id: '', // Will be set by database
              search_session_id: this.session.id,
              neq: neq.trim(),
              company_name: name.trim(),
              status: status.trim(),
              address: address.trim() || undefined,
              created_at: new Date().toISOString(),
            });
          }
        } catch (rowError) {
          logger.warn({ error: rowError }, 'Failed to extract company from row');
        }
      }

      return companies;

    } catch (error) {
      logger.error({ error, sessionId: this.session.id }, 'Failed to extract company results');
      throw error;
    }
  }

  /**
   * Scrape detailed company information
   */
  async scrapeCompanyDetails(company: REQCompany): Promise<REQCompanyDetails> {
    if (!this.page || !this.agentQLPage) {
      throw new Error('Scraper not initialized');
    }

    logger.info({
      sessionId: this.session.id,
      neq: company.neq,
      companyName: company.company_name
    }, 'Scraping company details');

    try {
      // Navigate to company details page
      // The URL pattern is typically: /RQAnglais/entreprise/[NEQ]/
      const detailsUrl = `https://www.registreentreprises.gouv.qc.ca/RQAnglais/entreprise/${company.neq}/`;

      await this.page.goto(detailsUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Extract all company information
      const detailsQuery = `{
        companyInfo(description: "Section containing company information")
        directors(description: "List of directors, administrators, or officers")[]
        addresses(description: "Business addresses")[]
        activities(description: "Business activities or NAICS codes")[]
      }`;

      const details = await this.agentQLPage.queryElements(detailsQuery);

      // Extract names for RDPRM searches
      const namesFound: string[] = [];

      // Extract director names
      if (details.directors && details.directors.length > 0) {
        for (const director of details.directors) {
          try {
            const nameQuery = `{
              personName(description: "Person's full name")
            }`;
            const wrappedDirector = await wrap(director);
            const { personName } = await wrappedDirector.queryElements(nameQuery);
            const name = await personName?.textContent();
            if (name) {
              namesFound.push(name.trim());
            }
          } catch (e) {
            logger.debug({ error: e }, 'Failed to extract director name');
          }
        }
      }

      // Build full data object
      const fullData: Record<string, any> = {
        neq: company.neq,
        company_name: company.company_name,
        status: company.status,
        address: company.address,
        scraped_at: new Date().toISOString(),
        // Add more fields as extracted
      };

      logger.info({
        sessionId: this.session.id,
        neq: company.neq,
        namesFound: namesFound.length
      }, 'Scraped company details');

      return {
        id: '', // Will be set by database
        req_company_id: company.id,
        full_data: fullData,
        names_found: namesFound,
        created_at: new Date().toISOString(),
      };

    } catch (error) {
      logger.error({
        error,
        sessionId: this.session.id,
        neq: company.neq
      }, 'Failed to scrape company details');
      throw error;
    }
  }
}

/**
 * Main scraping function called by unified worker
 */
export async function scrapeRegistreEntreprise(session: SearchSession): Promise<void> {
  const scraper = new REQScraper(session);

  try {
    await scraper.initialize();

    // Step 1: Search for companies
    const companies = await scraper.searchCompanies();

    if (companies.length === 0) {
      throw new Error('No companies found for search query');
    }

    // Step 2: Save companies to database
    const client = supabaseManager.getServiceClient('prod'); // Use appropriate environment
    if (!client) {
      throw new Error('No Supabase client available');
    }

    const { data: savedCompanies, error: saveError } = await client
      .from('req_companies')
      .insert(companies)
      .select();

    if (saveError) {
      throw new Error(`Failed to save companies: ${saveError.message}`);
    }

    logger.info({
      sessionId: session.id,
      companiesCount: savedCompanies?.length || 0
    }, 'Saved companies to database');

    // Step 3: If only one company found, automatically scrape details
    if (savedCompanies && savedCompanies.length === 1) {
      const company = savedCompanies[0];
      const details = await scraper.scrapeCompanyDetails(company);

      // Save details to database
      const { error: detailsError } = await client
        .from('req_company_details')
        .insert({
          ...details,
          req_company_id: company.id,
        });

      if (detailsError) {
        throw new Error(`Failed to save company details: ${detailsError.message}`);
      }

      logger.info({
        sessionId: session.id,
        companyId: company.id
      }, 'Saved company details to database');
    }

    logger.info({ sessionId: session.id }, '✅ REQ scraping completed successfully');

  } catch (error) {
    logger.error({ error, sessionId: session.id }, '❌ REQ scraping failed');
    throw error;
  } finally {
    await scraper.close();
  }
}


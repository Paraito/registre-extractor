/**
 * REQ (Registre des Entreprises du Québec) Scraper
 * Scrapes company information from Quebec Business Registry
 *
 * Website: https://www.registreentreprises.gouv.qc.ca/
 */

import { chromium, Page } from 'playwright';
import { logger } from '../utils/logger';
import { supabaseManager, EnvironmentName } from '../utils/supabase';
import type { SearchSession } from '../types/req-rdprm';
import path from 'path';
import fs from 'fs/promises';
import { cleanRegistreData } from './html-cleaner';

export class CompanyNotFoundError extends Error {
  constructor(
    message = "Company was not found in Registre des entreprises. Check name spelling or try a different search term."
  ) {
    super(message);
    this.name = "CompanyNotFoundError";
  }
}

async function debugScreenshot(page: Page, name: string, dataDir: string) {
  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";
  if (DEBUG_MODE) {
    const screenshotPath = path.join(
      dataDir,
      `debug_req_${name}_${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.debug(`Screenshot saved: ${screenshotPath}`);
  }
}

async function navigateToSearch(page: Page, dataDir: string) {
  logger.info('[REQ] Navigating to search page...');
  await page.goto(
    "https://www.registreentreprises.gouv.qc.ca/reqna/gr/gr03/gr03a71.rechercheregistre.mvc/gr03a71?choixdomaine=RegistreEntreprisesQuebec",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  // Wait for page to be ready
  await page.waitForTimeout(2000);
  await debugScreenshot(page, "01_search_page", dataDir);
}

async function searchCompany(page: Page, company: string, dataDir: string, navigateFirst: boolean = false) {
  logger.info(`[REQ] Searching for: ${company}`);

  // Navigate to search page if requested (for subsequent searches)
  if (navigateFirst) {
    await navigateToSearch(page, dataDir);
  }

  // Wait for page to be ready
  await page.waitForTimeout(2000);

  // Fill in the search field - "Objet de la recherche"
  logger.info('[REQ] Filling search field...');
  let searchField = page.locator('input[name="objetRecherche"]');
  if (!(await searchField.isVisible().catch(() => false))) {
    searchField = page.locator('input[type="text"]').first();
  }
  await searchField.waitFor({ state: "visible", timeout: 10000 });
  await searchField.fill(company);
  await page.waitForTimeout(500);
  await debugScreenshot(page, "02_search_filled", dataDir);

  // Accept terms of use checkbox
  logger.info('[REQ] Accepting terms of use...');
  const termsCheckbox = page.locator('input[type="checkbox"]').first();
  await termsCheckbox.waitFor({ state: "visible", timeout: 10000 });
  await termsCheckbox.check();
  await page.waitForTimeout(500);
  await debugScreenshot(page, "03_terms_accepted", dataDir);

  // Click search button
  logger.info('[REQ] Clicking search button...');
  let searchButton = page.getByRole("button", { name: /Rechercher/i });
  if (!(await searchButton.isVisible().catch(() => false))) {
    searchButton = page.locator('input[type="submit"]').first();
  }
  await searchButton.waitFor({ state: "visible", timeout: 10000 });
  await searchButton.click();

  // Wait for results to load
  logger.info('[REQ] Waiting for search results...');
  await page.waitForTimeout(3000);
  await debugScreenshot(page, "04_search_results", dataDir);
}

async function processAllResults(
  page: Page,
  company: string,
  dataDir: string,
  sessionId: string,
  environment: EnvironmentName
): Promise<Array<{ companyId: string; url: string; resultNumber: number }>> {
  logger.info('[REQ] Looking for Consulter buttons...');

  await page.waitForTimeout(3000);

  // Try multiple ways to find the Consulter button/link
  let consulterElements = page.getByRole("button", { name: /Consulter/i });
  let count = await consulterElements.count();

  if (count === 0) {
    consulterElements = page.getByRole("link", { name: /Consulter/i });
    count = await consulterElements.count();
  }

  if (count === 0) {
    consulterElements = page.locator('input[value*="Consulter"]');
    count = await consulterElements.count();
  }

  if (count === 0) {
    consulterElements = page.getByText(/Consulter/i);
    count = await consulterElements.count();
  }

  logger.info(`[REQ] Found ${count} Consulter button(s)`);

  // Get the supabase client for this environment
  const client = supabaseManager.getServiceClient(environment);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${environment}`);
  }

  // Log the number of results found to the database
  logger.info(`[REQ] Logging result count (${count}) to database...`);
  const { error: countError } = await client
    .from("search_sessions")
    .update({ req_results_count: count })
    .eq("id", sessionId);

  if (countError) {
    logger.error({ error: countError }, '[REQ] Error logging result count');
  }

  if (count === 0) {
    throw new CompanyNotFoundError(
      "La compagnie n'a pas été trouvée sur le registre des entreprises. Veuillez essayer avec un autre nom."
    );
  }

  const results: Array<{ companyId: string; url: string; resultNumber: number }> = [];

  // Process each result
  for (let i = 0; i < count; i++) {
    const resultNumber = i + 1;
    logger.info(`[REQ] Processing result ${resultNumber}/${count}...`);

    try {
      // If not the first iteration, perform the search again
      if (i > 0) {
        logger.info('[REQ] Performing search again to get fresh results...');
        await searchCompany(page, company, dataDir, true);

        // Re-find the Consulter buttons
        consulterElements = page.getByRole("button", { name: /Consulter/i });
        if (await consulterElements.count() === 0) {
          consulterElements = page.getByRole("link", { name: /Consulter/i });
        }
        if (await consulterElements.count() === 0) {
          consulterElements = page.locator('input[value*="Consulter"]');
        }
        if (await consulterElements.count() === 0) {
          consulterElements = page.getByText(/Consulter/i);
        }

        await page.waitForTimeout(2000);
      }

      // Click the i-th Consulter button
      logger.info(`[REQ] Clicking Consulter button ${resultNumber}...`);
      await consulterElements.nth(i).click();

      // Wait for company page to load
      logger.info('[REQ] Waiting for company page to load...');
      await page.waitForTimeout(3000);

      // Extract HTML content
      logger.info(`[REQ] Extracting HTML content for result ${resultNumber}...`);
      const htmlContent = await extractHTMLContent(page);
      const pageUrl = page.url();

      // Prepare raw_data for cleaning
      const rawData = {
        html_content: htmlContent,
        page_url: pageUrl,
        captured_at: new Date().toISOString(),
        result_number: resultNumber,
      };

      // Clean the HTML data
      logger.info(`[REQ] Cleaning HTML data for company ${resultNumber}...`);
      let cleanedData;
      try {
        cleanedData = cleanRegistreData(rawData);
        const nomCount = cleanedData.index_noms.nom.length;
        const autreNomsCount = cleanedData.index_noms.autre_noms.length;
        const etablissementsCount = cleanedData.etablissements.length;
        logger.info(`[REQ] Successfully cleaned data. Établissements: ${etablissementsCount}, Noms: ${nomCount}, Autres noms: ${autreNomsCount}`);
      } catch (error) {
        logger.error({ error }, '[REQ] Error cleaning HTML data');
        cleanedData = null;
      }

      // Create req_company record in database
      logger.info(`[REQ] Saving company ${resultNumber} to database...`);
      const { data: companyData, error: companyError } = await client
        .from("req_companies")
        .insert({
          search_session_id: sessionId,
          company_name: company,
          is_selected: false,
          result_order: resultNumber,
          cleaned_data: cleanedData,
        })
        .select()
        .single();

      if (companyError) {
        logger.error({ error: companyError }, '[REQ] Error saving company to database');
        throw companyError;
      }

      const companyId = companyData.id;
      logger.info({ companyId }, `[REQ] Company saved with ID`);

      results.push({
        companyId,
        url: pageUrl,
        resultNumber
      });

      logger.info(`[REQ] Result ${resultNumber}/${count} captured and saved successfully`);
    } catch (error) {
      logger.error({ error, resultNumber }, `[REQ] Error processing result ${resultNumber}/${count}`);
      logger.info(`[REQ] Skipping result ${resultNumber} and continuing with next result...`);
      continue;
    }
  }

  return results;
}

/**
 * Extract HTML content from the page (main content only)
 */
async function extractHTMLContent(page: Page): Promise<string> {
  const contentSelectors = [
    '#content',
    'main',
    '#main',
    '.main-content',
    '[role="main"]',
    '#corps',
    '.contenu',
  ];

  for (const selector of contentSelectors) {
    try {
      const element = await page.locator(selector).first();
      if (await element.count() > 0) {
        const content = await element.innerHTML();
        logger.debug({ selector }, '[REQ] HTML content extracted using selector');
        return content;
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // If no main content found, get the whole page content
  logger.debug('[REQ] No main content selector found, using full page content');
  return await page.content();
}

/**
 * Main scraping function called by unified worker
 */
export async function scrapeRegistreEntreprise(session: SearchSession & { _environment: EnvironmentName }): Promise<void> {
  const dataDir = process.env.DOWNLOADS_DIR || '/tmp/req-downloads';
  const sessionDataDir = path.join(dataDir, session.id);

  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";

  logger.info({
    sessionId: session.id,
    query: session.initial_search_query,
    debugMode: DEBUG_MODE,
    environment: session._environment,
  }, '[REQ] Starting scraping');

  // Create data directory
  await fs.mkdir(sessionDataDir, { recursive: true });

  // Check for BrowserBase credentials
  const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
  const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
    throw new Error(
      "BrowserBase credentials not found. Please set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in your .env file."
    );
  }

  logger.info('[REQ] Connecting to BrowserBase...');

  const browser = await chromium.connectOverCDP(
    `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&projectId=${BROWSERBASE_PROJECT_ID}`
  );

  logger.info('[REQ] Connected to BrowserBase successfully');

  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  try {
    await navigateToSearch(page, sessionDataDir);
    await searchCompany(page, session.initial_search_query, sessionDataDir);
    const results = await processAllResults(page, session.initial_search_query, sessionDataDir, session.id, session._environment);

    logger.info({
      sessionId: session.id,
      resultsCount: results.length,
    }, '[REQ] Scraping completed successfully');

    // Mark REQ scraping as completed
    const client = supabaseManager.getServiceClient(session._environment);
    if (client) {
      logger.info('[REQ] Marking session as REQ completed...');
      const { error: completedError } = await client
        .from("search_sessions")
        .update({ req_completed: true })
        .eq("id", session.id);

      if (completedError) {
        logger.error({ error: completedError }, '[REQ] Error marking session as completed');
      } else {
        logger.info('[REQ] Session marked as REQ completed successfully');
      }
    }

  } catch (error) {
    logger.error({ error, sessionId: session.id }, '[REQ] Error during scraping');
    await debugScreenshot(page, "ERROR", sessionDataDir);

    // Update session status to failed
    const client = supabaseManager.getServiceClient(session._environment);
    if (client) {
      await client
        .from("search_sessions")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", session.id);
    }

    throw error;
  } finally {
    await browser.close();
    logger.info('[REQ] BrowserBase session closed');
  }
}

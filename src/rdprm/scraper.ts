/**
 * RDPRM (Registre des Droits Personnels et Réels Mobiliers) Scraper
 * Scrapes personal and movable real rights information
 *
 * Website: https://www.rdprm.gouv.qc.ca/
 */

import { chromium, Page } from 'playwright';
import { logger } from '../utils/logger';
import { supabaseManager, EnvironmentName } from '../utils/supabase';
import type { RDPRMSearch } from '../types/req-rdprm';
import path from 'path';
import fs from 'fs/promises';

export class CompanyNotFoundError extends Error {
  constructor(
    message = "Company was not found, check name spelling or visit rdprm website"
  ) {
    super(message);
    this.name = "CompanyNotFoundError";
  }
}

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Please set it in your .env file.`
    );
  }
  return value;
}

async function debugScreenshot(page: Page, name: string, dataDir: string) {
  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";
  if (DEBUG_MODE) {
    const screenshotPath = path.join(
      dataDir,
      `debug_rdprm_${name}_${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.debug(`Screenshot saved: ${screenshotPath}`);
  }
}

async function login(page: Page, dataDir: string) {
  const RDPRM_USER = getEnvVar("RDPRM_USER");
  const RDPRM_PASS = getEnvVar("RDPRM_PASS");
  const RDPRM_SEC = getEnvVar("RDPRM_SEC", "RDPRM");

  logger.info('[RDPRM] Navigating to homepage...');
  await page.goto("https://www.rdprm.gouv.qc.ca/fr/Pages/Accueil.html", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await debugScreenshot(page, "01_homepage", dataDir);

  // Handle cookie banner if present
  try {
    const cookieBtn = page.getByText("Fermer", { exact: true });
    if (await cookieBtn.isVisible()) {
      await cookieBtn.click();
      logger.info('[RDPRM] Cookie banner closed');
      await debugScreenshot(page, "01b_cookie_closed", dataDir);
    }
  } catch {}

  // If already authenticated, go directly to dashboard and skip login
  try {
    await page.goto("https://servicesclients.rdprm.gouv.qc.ca/MesServices/", {
      waitUntil: "domcontentloaded",
    });
    if (await page.getByText("Bienvenue", { exact: false }).isVisible()) {
      logger.info('[RDPRM] Existing session detected, skipping login');
      await debugScreenshot(page, "01c_dashboard_detected", dataDir);
      return;
    }
  } catch {}

  logger.info('[RDPRM] Proceeding to login form...');
  await debugScreenshot(page, "02_login_page", dataDir);

  // Credentials
  logger.info('[RDPRM] Entering credentials...');

  // Wait for the login form to be ready
  await page.waitForTimeout(3000);

  // Fill username field
  const usernameField = page.locator('input[type="text"]').first();
  await usernameField.fill(RDPRM_USER);

  // Fill password field
  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.fill(RDPRM_PASS);

  await debugScreenshot(page, "03_credentials_filled", dataDir);

  // Click "Entrer" button
  logger.info('[RDPRM] Clicking "Entrer" button...');
  await page.getByRole("button", { name: /Entrer/i }).click();
  await debugScreenshot(page, "04_after_login_click", dataDir);

  logger.info('[RDPRM] Waiting for page after login...');
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  await debugScreenshot(page, "05_after_login", dataDir);

  // Security question - "Confirmer votre identité" - happens AFTER login
  logger.info('[RDPRM] Checking for security question...');

  const pageContent = await page.content();
  if (
    pageContent.includes("Confirmer votre identité") ||
    pageContent.includes("Dans quelle ville")
  ) {
    logger.info('[RDPRM] Security question detected! Answering...');
    await debugScreenshot(page, "06_security_question", dataDir);

    // Fill the answer field
    const answerField = page.locator('input[type="text"]').first();
    await answerField.waitFor({ state: "visible", timeout: 5000 });
    await answerField.fill(RDPRM_SEC);
    await debugScreenshot(page, "06b_security_filled", dataDir);

    // Click "Poursuivre" button
    logger.info('[RDPRM] Clicking "Poursuivre" button...');
    await page.getByRole("button", { name: /Poursuivre/i }).click();
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    await debugScreenshot(page, "06c_after_security_answer", dataDir);
    logger.info('[RDPRM] Security question answered!');
  } else {
    logger.info('[RDPRM] No security question detected, continuing...');
  }

  logger.info('[RDPRM] Login complete!');
  await debugScreenshot(page, "07_logged_in", dataDir);
}

async function goToConsultation(page: Page, dataDir: string) {
  logger.info('[RDPRM] Clicking "Consulter le registre" link...');
  await debugScreenshot(page, "08_before_consultation_click", dataDir);

  // Wait for page to be ready
  await page.waitForLoadState("networkidle", { timeout: 60000 });

  // Click the link with href="/Consultation/"
  await page.locator('a[href="/Consultation/"]').click();

  await page.waitForLoadState("domcontentloaded");
  await debugScreenshot(page, "09_consultation_page", dataDir);
  logger.info('[RDPRM] Successfully navigated to consultation page');
}

async function searchOrganisme(page: Page, company: string, dataDir: string) {
  logger.info(`[RDPRM] Searching for: ${company}`);
  await debugScreenshot(page, "10_before_search", dataDir);

  // Wait for the search form to load
  await page.waitForTimeout(2000);

  // Find the "Nom de l'organisme" field
  const searchField = page.getByLabel(/Nom de l['']organisme/i);
  await searchField.fill(company);
  await debugScreenshot(page, "10_search_filled", dataDir);

  // Click search/submit button
  await page.getByRole("button", { name: /Rechercher|Soumettre/i }).click();
  await debugScreenshot(page, "11_after_search_click", dataDir);

  // First confirmation dialog - Amount confirmation (12,00 $)
  logger.info('[RDPRM] Waiting for amount confirmation dialog (12,00 $)...');
  const amountConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
  await amountConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
  await debugScreenshot(page, "12_confirm_amount", dataDir);

  const dialogContent = await page.locator('[role="dialog"]').textContent().catch(() => "") || "";
  if (dialogContent.includes("12,00") || dialogContent.includes("12.00") || dialogContent.includes("$")) {
    logger.info('[RDPRM] Amount confirmation dialog detected');
  }

  await amountConfirmBtn.click();
  logger.info('[RDPRM] Amount confirmed');
  await page.waitForTimeout(1000);
  await debugScreenshot(page, "12b_after_amount_confirm", dataDir);

  // Second confirmation dialog
  logger.info('[RDPRM] Waiting for second confirmation dialog...');
  const secondConfirmBtn = page.getByRole("button", { name: /Confirmer/i });
  await secondConfirmBtn.waitFor({ state: "visible", timeout: 30000 });
  await debugScreenshot(page, "12c_second_confirm", dataDir);
  await secondConfirmBtn.click();
  logger.info('[RDPRM] Second confirmation completed');

  // Wait for results section to load
  logger.info('[RDPRM] Waiting for results to load...');
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  await debugScreenshot(page, "13_results_loaded", dataDir);
}

async function downloadFicheComplete(
  page: Page,
  dataDir: string
): Promise<Buffer> {
  // Wait up to 3 minutes for "Imprimer la fiche complète" to appear
  logger.info('[RDPRM] Scrolling to find "Imprimer la fiche complète" (timeout: 3 minutes)...');
  const timeoutMs = 180000; // 3 minutes
  const start = Date.now();
  let foundPrint = false;

  while (Date.now() - start < timeoutMs) {
    const printLink = page.locator("a", {
      hasText: "Imprimer la fiche complète",
    });
    if (await printLink.isVisible().catch(() => false)) {
      await debugScreenshot(page, "14_print_link_visible", dataDir);
      await printLink.click();
      logger.info('[RDPRM] Clicked "Imprimer la fiche complète"');
      foundPrint = true;
      break;
    }
    // Check for "Aucun résultat" text
    const noResult = await page
      .getByText(/Aucun r?sultat|Aucun r e9sultat/i)
      .isVisible()
      .catch(() => false);
    if (noResult) break;
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);
  }

  if (!foundPrint) {
    throw new CompanyNotFoundError();
  }

  // Handle the large print warning modal and click "Imprimer"
  logger.info('[RDPRM] Waiting for large print warning modal...');
  const warningText = page
    .locator('div[role="dialog"]')
    .getByText(/Avertissement d['']impression volumineuse/);
  await warningText.waitFor({ timeout: 30000 });
  await debugScreenshot(page, "15_warning_modal", dataDir);

  // Click the Imprimer button
  let printed = false;
  try {
    await page.getByRole("button", { name: /Imprimer/i }).click();
    printed = true;
  } catch {}
  if (!printed) {
    const inputImprimer = page.locator('input[value="Imprimer"]');
    if (await inputImprimer.isVisible().catch(() => false)) {
      await inputImprimer.click();
      printed = true;
    }
  }
  if (!printed) {
    throw new Error("Could not find the Imprimer button in the warning modal");
  }
  await debugScreenshot(page, "16_after_imprimer_click", dataDir);

  // Wait for preparation to finish and the download link to appear
  logger.info('[RDPRM] Waiting for preparation to finish and download link to appear...');
  await page
    .getByText(/Préparation de l['']impression/)
    .waitFor({ state: "detached", timeout: 120000 })
    .catch(() => {});

  const downloadSelector = page.locator("a", {
    hasText: /Télécharger la fiche complète|Fiche complète disponible/,
  });
  await downloadSelector.waitFor({ timeout: 180000 });
  await debugScreenshot(page, "17_download_link_visible", dataDir);

  // Click the download link and capture the new tab (PDF)
  logger.info('[RDPRM] Opening PDF in new tab...');
  const [newPage] = await Promise.all([
    page.context().waitForEvent("page"),
    downloadSelector.click(),
  ]);
  await newPage.waitForLoadState("domcontentloaded", { timeout: 120000 });
  await debugScreenshot(newPage, "18_pdf_opened", dataDir);
  logger.info({ url: newPage.url() }, '[RDPRM] PDF viewer URL');

  let pdfBuffer: Buffer | null = null;

  try {
    // Try Option 1: Click the download button in the PDF viewer
    try {
      logger.info('[RDPRM] Attempting to click download button in PDF viewer...');

      await newPage.waitForTimeout(2000);
      await debugScreenshot(newPage, "18b_before_download_click", dataDir);

      let clicked = false;

      // Strategy 1: Target the viewer-download-controls component
      const downloadControls = newPage.locator('viewer-download-controls#downloads cr-icon-button#save');
      if (await downloadControls.isVisible().catch(() => false)) {
        logger.info('[RDPRM] Found download button via viewer-download-controls');
        await downloadControls.click();
        clicked = true;
      }

      // Strategy 2: Try by iron-icon attribute
      if (!clicked) {
        const iconButton = newPage.locator('cr-icon-button[iron-icon="cr:file-download"]');
        if (await iconButton.isVisible().catch(() => false)) {
          logger.info('[RDPRM] Found download button via iron-icon attribute');
          await iconButton.click();
          clicked = true;
        }
      }

      // Strategy 3: Try by aria-label or title
      if (!clicked) {
        const ariaButton = newPage.locator('cr-icon-button[aria-label="Download"], cr-icon-button[title="Download"]');
        if (await ariaButton.isVisible().catch(() => false)) {
          logger.info('[RDPRM] Found download button via aria-label/title');
          await ariaButton.click();
          clicked = true;
        }
      }

      // Strategy 4: Try the toolbar end section
      if (!clicked) {
        const toolbarButton = newPage.locator('#toolbar #end cr-icon-button').first();
        if (await toolbarButton.isVisible().catch(() => false)) {
          logger.info('[RDPRM] Found download button via toolbar end section');
          await toolbarButton.click();
          clicked = true;
        }
      }

      if (!clicked) {
        throw new Error("Could not find download button with any selector strategy");
      }

      logger.info('[RDPRM] Download button clicked, waiting for download...');
      await debugScreenshot(newPage, "18c_after_download_click", dataDir);

      const downloadPromise = newPage.waitForEvent('download', { timeout: 30000 });
      const download = await downloadPromise;
      logger.info({ filename: download.suggestedFilename() }, '[RDPRM] Download started');

      const downloadPath = await download.path();
      if (downloadPath) {
        pdfBuffer = await fs.readFile(downloadPath);
        logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded via download button');

        // Clean up the temporary download file
        try {
          await fs.unlink(downloadPath);
        } catch {}
      } else {
        throw new Error("Download path not available");
      }
    } catch (e) {
      logger.debug({ error: e instanceof Error ? e.message : String(e) }, '[RDPRM] Download button click failed');
    }

    // Try Option 2: In-page fetch of the viewer URL
    if (!pdfBuffer) {
      try {
        const viewerUrl = newPage.url();
        logger.info({ url: viewerUrl }, '[RDPRM] Attempting in-page viewer fetch');
        const b64 = await newPage.evaluate(async u => {
          const r = await fetch(u, { credentials: "include" });
          if (!r.ok) throw new Error(`viewer fetch failed ${r.status}`);
          const buf = await r.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i++)
            bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        }, viewerUrl);
        pdfBuffer = Buffer.from(b64, "base64");
        logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded via in-page viewer fetch');
      } catch (e) {
        logger.debug({ error: e instanceof Error ? e.message : String(e) }, '[RDPRM] In-page viewer fetch failed');
      }
    }

    // Try Option 3: Find <embed> or <iframe> src and fetch it
    if (!pdfBuffer) {
      try {
        const pdfSrc = await newPage
          .locator("embed[src], iframe[src]")
          .first()
          .getAttribute("src");
        if (pdfSrc) {
          const absolutePdfUrl = pdfSrc.startsWith("http")
            ? pdfSrc
            : new URL(pdfSrc, newPage.url()).toString();
          logger.info({ url: absolutePdfUrl }, '[RDPRM] Found PDF src');

          const urlObj = new URL(absolutePdfUrl);
          const cookiesArr = await newPage.context().cookies(urlObj.origin);
          const cookieHeader = cookiesArr
            .map(c => `${c.name}=${c.value}`)
            .join("; ");
          const resp = await newPage.context().request.get(absolutePdfUrl, {
            headers: {
              Accept: "application/pdf",
              Referer: newPage.url(),
              ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            },
          });
          if (!resp.ok()) {
            // Fallback: fetch from within the page context
            try {
              const b64 = await newPage.evaluate(async u => {
                const r = await fetch(u, { credentials: "include" });
                if (!r.ok) throw new Error(`fetch failed ${r.status}`);
                const buf = await r.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let bin = "";
                for (let i = 0; i < bytes.length; i++)
                  bin += String.fromCharCode(bytes[i]);
                return btoa(bin);
              }, absolutePdfUrl);
              pdfBuffer = Buffer.from(b64, "base64");
              logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded via in-page fetch');
            } catch {
              throw new Error(
                `PDF fetch failed: ${resp.status()} ${resp.statusText()}`
              );
            }
          } else {
            const buffer = await resp.body();
            pdfBuffer = Buffer.from(new Uint8Array(buffer));
            logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded via embed/iframe');
          }
        } else {
          logger.debug('[RDPRM] No <embed> or <iframe> with src found in viewer');
        }
      } catch (e) {
        logger.debug({ error: e instanceof Error ? e.message : String(e) }, '[RDPRM] Direct fetch via embed/iframe failed');
      }
    }

    // Try Option 4: Request the viewer URL directly
    if (!pdfBuffer) {
      try {
        const viewerUrl = newPage.url();
        logger.info({ url: viewerUrl }, '[RDPRM] Attempting direct fetch of viewer URL');
        const cookiesArr2 = await newPage
          .context()
          .cookies(new URL(viewerUrl).origin);
        const cookieHeader2 = cookiesArr2
          .map(c => `${c.name}=${c.value}`)
          .join("; ");
        const resp2 = await newPage.context().request.get(viewerUrl, {
          headers: {
            Accept: "application/pdf",
            Referer: page.url(),
            ...(cookieHeader2 ? { Cookie: cookieHeader2 } : {}),
          },
        });
        if (!resp2.ok())
          throw new Error(`${resp2.status()} ${resp2.statusText()}`);
        const buffer2 = await resp2.body();
        pdfBuffer = Buffer.from(new Uint8Array(buffer2));
        logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded via viewer URL');
      } catch (e) {
        logger.debug({ error: e instanceof Error ? e.message : String(e) }, '[RDPRM] Direct fetch of viewer URL failed');
      }
    }

    if (!pdfBuffer) {
      throw new Error("Failed to download PDF from RDPRM viewer");
    }

    return pdfBuffer;
  } finally {
    // Close the PDF viewer page
    await newPage.close().catch(() => {});
  }
}

function fileStemFromCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Main scraping function called by unified worker
 */
export async function scrapeRDPRM(search: RDPRMSearch & { _environment: EnvironmentName; _session_id: string }): Promise<void> {
  const dataDir = process.env.DOWNLOADS_DIR || '/tmp/rdprm-downloads';
  const searchDataDir = path.join(dataDir, search.id);
  const stem = fileStemFromCompany(search.search_name);

  const DEBUG_MODE = process.env.DEBUG_PLAYWRIGHT === "true";

  logger.info({
    searchId: search.id,
    searchName: search.search_name,
    sessionId: search._session_id,
    debugMode: DEBUG_MODE,
    environment: search._environment,
  }, '[RDPRM] Starting scraping');

  // Create data directory
  await fs.mkdir(searchDataDir, { recursive: true });

  // Clear Playwright persistent session cache
  const sessionDir = path.join(searchDataDir, ".pw-session");
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    logger.debug('[RDPRM] Cleared Playwright session cache');
  } catch {}

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,  // Must be true on headless server
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    slowMo: 500,  // Critical: RDPRM site needs 500ms delays between actions (from RDPRM 2)
  });
  const page = await context.newPage();

  try {
    await login(page, searchDataDir);
    await goToConsultation(page, searchDataDir);
    await searchOrganisme(page, search.search_name, searchDataDir);

    // Download the PDF as a buffer
    const pdfBuffer = await downloadFicheComplete(page, searchDataDir);
    logger.info({ size: pdfBuffer.length }, '[RDPRM] PDF downloaded successfully');

    // Ensure the filename has .pdf extension
    const fileName = stem.endsWith('.pdf') ? stem : `${stem}.pdf`;

    // Upload to Supabase Storage
    const storagePath = `${search._session_id}/${fileName}`;
    logger.info({ storagePath }, '[RDPRM] Uploading PDF to Supabase Storage');

    const client = supabaseManager.getServiceClient(search._environment);
    if (!client) {
      throw new Error(`No Supabase client for environment: ${search._environment}`);
    }

    const { error } = await client.storage
      .from('rdprm-documents')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) {
      logger.error({ error }, '[RDPRM] Error uploading to Supabase Storage');
      throw new Error(`Failed to upload PDF to storage: ${error.message}`);
    }

    logger.info({ storagePath }, '[RDPRM] PDF uploaded successfully');

    // Update the search record with storage path
    const { error: updateError } = await client
      .from('rdprm_searches')
      .update({
        storage_path: storagePath,
      })
      .eq('id', search.id);

    if (updateError) {
      logger.error({ error: updateError }, '[RDPRM] Error updating search record with storage path');
    }

    logger.info({ searchId: search.id }, '[RDPRM] Scraping completed successfully');

  } catch (error) {
    logger.error({ error, searchId: search.id }, '[RDPRM] Error during scraping');
    await debugScreenshot(page, "ERROR", searchDataDir);
    throw error;
  } finally {
    await context.close();
    logger.info('[RDPRM] Browser context closed');
  }
}

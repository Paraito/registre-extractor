/**
 * REQ (Registre des Entreprises du Québec) Scraper
 * Placeholder implementation - to be implemented
 */

import { logger } from '../utils/logger';
import type { SearchSession } from '../types/req-rdprm';

export async function scrapeRegistreEntreprise(session: SearchSession): Promise<void> {
  logger.info({ sessionId: session.id }, 'REQ scraping not yet implemented');
  throw new Error('REQ scraping functionality not yet implemented');
}


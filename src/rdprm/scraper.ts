/**
 * RDPRM (Registre des Droits Personnels et Réels Mobiliers) Scraper
 * Placeholder implementation - to be implemented
 */

import { logger } from '../utils/logger';
import type { RDPRMSearch } from '../types/req-rdprm';

export async function scrapeRDPRM(search: RDPRMSearch): Promise<void> {
  logger.info({ searchId: search.id }, 'RDPRM scraping not yet implemented');
  throw new Error('RDPRM scraping functionality not yet implemented');
}


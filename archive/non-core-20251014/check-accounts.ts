import { supabase } from './utils/supabase';
import { logger } from './utils/logger';

async function checkAccounts() {
  try {
    // Check worker accounts
    const { data: accounts, error } = await supabase
      .from('worker_accounts')
      .select('*')
      .order('created_at');

    if (error) {
      logger.error({ error }, 'Failed to fetch accounts');
      return;
    }

    logger.info({ count: accounts?.length || 0 }, 'Worker accounts in database');
    
    if (accounts && accounts.length > 0) {
      accounts.forEach((account, index) => {
        logger.info({
          index: index + 1,
          username: account.username,
          is_active: account.is_active,
          failure_count: account.failure_count
        }, 'Account');
      });
    } else {
      logger.warn('No worker accounts found. You need to add accounts to the database.');
    }

    // Check if tables exist
    const tables = ['extraction_jobs', 'worker_status', 'extracted_documents'];
    for (const table of tables) {
      const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      logger.info({ table, exists: count !== null }, 'Table check');
    }

  } catch (error) {
    logger.error({ error }, 'Check failed');
  }
}

checkAccounts();
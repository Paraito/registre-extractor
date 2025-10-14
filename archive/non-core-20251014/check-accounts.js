const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  // Use service role key to read accounts under RLS
  process.env.SUPABASE_SERVICE_KEY
);

async function checkAccounts() {
  console.log('\n=== Worker Accounts ===');
  const { data: accounts, error } = await supabase
    .from('worker_accounts')
    .select('*')
    .order('last_used', { ascending: false });

  if (error) {
    console.error('Error fetching accounts:', error);
    return;
  }

  console.log(`Total accounts: ${accounts.length}`);
  console.log(`Active accounts: ${accounts.filter(a => a.is_active).length}`);
  console.log(`Failed accounts: ${accounts.filter(a => a.failure_count >= 3).length}\n`);

  accounts.forEach(account => {
    console.log(`Account: ${account.username}`);
    console.log(`  Active: ${account.is_active}`);
    console.log(`  Failures: ${account.failure_count}`);
    console.log(`  Last Used: ${account.last_used || 'Never'}`);
    console.log('');
  });

  // Check which workers have accounts
  console.log('\n=== Active Workers with Accounts ===');
  const { data: workers } = await supabase
    .from('worker_status')
    .select('worker_id, account_id, status')
    .not('account_id', 'is', null);

  workers?.forEach(w => {
    const account = accounts.find(a => a.id === w.account_id);
    console.log(`Worker ${w.worker_id.substring(0, 8)}... has account ${account?.username || 'Unknown'}`);
  });
}

checkAccounts().then(() => process.exit(0));

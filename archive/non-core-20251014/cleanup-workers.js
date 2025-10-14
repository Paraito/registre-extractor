const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  // Use service role key to bypass RLS for maintenance
  process.env.SUPABASE_SERVICE_KEY
);

async function cleanupWorkers() {
  // Get all offline workers
  const { data: offlineWorkers, error } = await supabase
    .from('worker_status')
    .select('worker_id')
    .eq('status', 'offline');

  if (error) {
    console.error('Error fetching workers:', error);
    return;
  }

  console.log(`Found ${offlineWorkers.length} offline workers to clean up`);
  
  // Delete offline workers
  const { error: deleteError } = await supabase
    .from('worker_status')
    .delete()
    .eq('status', 'offline');

  if (deleteError) {
    console.error('Error deleting workers:', deleteError);
  } else {
    console.log('Offline workers cleaned up successfully');
  }

  // Also clean up stale workers (no heartbeat in 10 minutes)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error: staleError } = await supabase
    .from('worker_status')
    .delete()
    .lt('last_heartbeat', tenMinutesAgo);

  if (staleError) {
    console.error('Error deleting stale workers:', staleError);
  } else {
    console.log('Stale workers cleaned up successfully');
  }
}

cleanupWorkers().then(() => process.exit(0));

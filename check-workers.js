const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkWorkers() {
  console.log('\n=== Active Workers ===');
  const { data: workers, error } = await supabase
    .from('worker_status')
    .select('*')
    .order('last_heartbeat', { ascending: false });

  if (error) {
    console.error('Error fetching workers:', error);
    return;
  }

  workers.forEach(worker => {
    console.log(`\nWorker ID: ${worker.worker_id}`);
    console.log(`Status: ${worker.status}`);
    console.log(`Last Heartbeat: ${worker.last_heartbeat}`);
    console.log(`Started At: ${worker.started_at}`);
    console.log(`Current Job: ${worker.current_job_id || 'None'}`);
    console.log(`Jobs Completed: ${worker.jobs_completed}`);
    console.log(`Jobs Failed: ${worker.jobs_failed}`);
  });

  // Check for stale workers (no heartbeat in 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const staleWorkers = workers.filter(w => w.last_heartbeat < fiveMinutesAgo);
  
  if (staleWorkers.length > 0) {
    console.log('\n=== Stale Workers (no heartbeat in 5 minutes) ===');
    staleWorkers.forEach(w => {
      console.log(`- ${w.worker_id} (last seen: ${w.last_heartbeat})`);
    });
  }
}

checkWorkers().then(() => process.exit(0));
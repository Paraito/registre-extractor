/**
 * RDPRM Diagnostic and Test Script
 * 
 * This script:
 * 1. Checks database schema for rdprm_searches table
 * 2. Creates a test RDPRM search job
 * 3. Runs the scraper with detailed logging
 * 4. Reports results
 */

import { config } from 'dotenv';
import { supabaseManager, EnvironmentName } from '../utils/supabase';
import { scrapeRDPRM } from '../rdprm/scraper';
import { logger } from '../utils/logger';
import type { RDPRMSearch } from '../types/req-rdprm';

config();

const TEST_COMPANY_NAME = process.env.TEST_RDPRM_COMPANY || 'AUTOMATISATIONS PARAITO INC.';
const TEST_ENVIRONMENT: EnvironmentName = (process.env.TEST_ENVIRONMENT as EnvironmentName) || 'dev';

async function checkDatabaseSchema() {
  console.log('\n=== Checking Database Schema ===\n');

  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  // Check if rdprm_searches table exists and get its schema
  const { data: tableInfo, error: tableError } = await client
    .from('rdprm_searches')
    .select('*')
    .limit(1);

  if (tableError) {
    console.error('❌ Error querying rdprm_searches table:', tableError);
    throw tableError;
  }

  console.log('✅ rdprm_searches table exists');

  // Get a sample row to see the schema
  const { data: sampleRows, error: sampleError } = await client
    .from('rdprm_searches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  if (sampleError) {
    console.error('⚠️  Could not fetch sample row:', sampleError);
  } else if (sampleRows && sampleRows.length > 0) {
    console.log('\n📋 Sample row columns:', Object.keys(sampleRows[0]));
    console.log('\n📊 Recent RDPRM searches:');
    sampleRows.forEach((row, idx) => {
      console.log(`   ${idx + 1}. ${row.search_name} - Status: ${row.status}`);
      console.log(`      ID: ${row.id}`);
      console.log(`      Session: ${row.search_session_id}`);
      console.log(`      Selected Name ID: ${row.selected_name_id || 'NULL'}`);
      console.log(`      Error: ${row.error_message || 'None'}`);
    });
  } else {
    console.log('\n📋 No existing rows in rdprm_searches table');
  }

  return true;
}

async function createTestSession() {
  console.log('\n=== Creating Test Session ===\n');

  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  // First, try to get or create a test user
  let userId: string;
  const { data: existingUsers, error: userQueryError } = await client
    .from('users')
    .select('id')
    .limit(1);

  if (userQueryError) {
    console.log('⚠️  Could not query users table:', userQueryError.message);
    console.log('   Using a dummy UUID for user_id');
    userId = '00000000-0000-0000-0000-000000000001'; // Dummy UUID
  } else if (existingUsers && existingUsers.length > 0) {
    userId = existingUsers[0].id;
    console.log('✅ Using existing user:', userId);
  } else {
    console.log('⚠️  No users found, using dummy UUID');
    userId = '00000000-0000-0000-0000-000000000001'; // Dummy UUID
  }

  // Create a test search session
  const { data: session, error: sessionError } = await client
    .from('search_sessions')
    .insert({
      user_id: userId,
      initial_search_query: TEST_COMPANY_NAME,
      status: 'rdprm_in_progress',
    })
    .select()
    .single();

  if (sessionError) {
    console.error('❌ Error creating search session:', sessionError);
    throw sessionError;
  }

  console.log('✅ Created test session:', session.id);
  return session.id;
}

async function createTestRDPRMJob(sessionId: string) {
  console.log('\n=== Creating Test RDPRM Job ===\n');

  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  // First, create a selected_name entry (required by schema)
  const { data: selectedName, error: nameError } = await client
    .from('selected_names_for_rdprm')
    .insert({
      search_session_id: sessionId,
      name_to_search: TEST_COMPANY_NAME,
      source_type: 'manual',
      is_selected: true,
    })
    .select()
    .single();

  if (nameError) {
    console.error('❌ Error creating selected name:', nameError);
    throw nameError;
  }

  console.log('✅ Created selected name:', selectedName.id);

  // Create a test RDPRM search
  const { data: search, error: searchError } = await client
    .from('rdprm_searches')
    .insert({
      search_session_id: sessionId,
      selected_name_id: selectedName.id,
      search_name: TEST_COMPANY_NAME,
      status: 'pending',
    })
    .select()
    .single();

  if (searchError) {
    console.error('❌ Error creating RDPRM search:', searchError);
    throw searchError;
  }

  console.log('✅ Created test RDPRM search:', search.id);
  console.log('   Company name:', search.search_name);
  console.log('   Status:', search.status);

  return search;
}

async function testRDPRMScraper(search: RDPRMSearch, sessionId: string) {
  console.log('\n=== Testing RDPRM Scraper ===\n');
  console.log('🔍 Starting scrape for:', search.search_name);
  console.log('   Search ID:', search.id);
  console.log('   Session ID:', sessionId);
  console.log('   Environment:', TEST_ENVIRONMENT);
  console.log('\n⏳ This may take 2-5 minutes...\n');

  const startTime = Date.now();

  try {
    await scrapeRDPRM({
      ...search,
      _environment: TEST_ENVIRONMENT,
      _session_id: sessionId,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Scrape completed successfully in ${duration}s`);
    return true;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ Scrape failed after ${duration}s:`, error);
    
    if (error instanceof Error) {
      console.error('   Error name:', error.name);
      console.error('   Error message:', error.message);
      console.error('   Stack trace:', error.stack);
    }
    
    return false;
  }
}

async function checkResults(searchId: string) {
  console.log('\n=== Checking Results ===\n');
  
  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  const { data: search, error } = await client
    .from('rdprm_searches')
    .select('*')
    .eq('id', searchId)
    .single();

  if (error) {
    console.error('❌ Error fetching search results:', error);
    return;
  }

  console.log('📊 Final Status:', search.status);
  console.log('   Storage Path:', search.storage_path || 'N/A');
  console.log('   Error Message:', search.error_message || 'N/A');
  console.log('   Completed At:', search.completed_at || 'N/A');

  if (search.storage_path) {
    console.log('\n✅ PDF successfully uploaded to:', search.storage_path);
  }
}

async function cleanup(sessionId: string) {
  console.log('\n=== Cleanup ===\n');
  
  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  // Delete the test session (cascade will delete RDPRM searches)
  const { error } = await client
    .from('search_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    console.error('⚠️  Error during cleanup:', error);
  } else {
    console.log('✅ Test data cleaned up');
  }
}

async function findOrCreateTestSession() {
  console.log('\n=== Finding or Creating Test Session ===\n');

  const client = supabaseManager.getServiceClient(TEST_ENVIRONMENT);
  if (!client) {
    throw new Error(`No Supabase client for environment: ${TEST_ENVIRONMENT}`);
  }

  // Try to find an existing session we can use
  const { data: existingSessions, error: queryError } = await client
    .from('search_sessions')
    .select('id, user_id')
    .limit(1);

  if (queryError) {
    console.error('❌ Error querying search_sessions:', queryError);
    throw queryError;
  }

  if (existingSessions && existingSessions.length > 0) {
    const session = existingSessions[0];
    console.log('✅ Using existing session:', session.id);
    return session.id;
  }

  // If no sessions exist, we can't create one without a valid user
  // In this case, we'll test the scraper directly without database integration
  console.log('⚠️  No existing sessions found');
  console.log('   Will test scraper in standalone mode (no database updates)');
  return null;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║         RDPRM Diagnostic and Test Script              ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`\n🌍 Environment: ${TEST_ENVIRONMENT}`);
  console.log(`🏢 Test Company: ${TEST_COMPANY_NAME}`);
  console.log(`🔐 RDPRM Credentials: ${process.env.RDPRM_USER ? '✅ Set' : '❌ Missing'}`);
  console.log(`📁 Downloads Dir: ${process.env.DOWNLOADS_DIR || '/tmp/rdprm-downloads'}`);

  let sessionId: string | null = null;
  let searchId: string | null = null;

  try {
    // Step 1: Check database schema
    await checkDatabaseSchema();

    // Step 2: Find or create test session
    sessionId = await findOrCreateTestSession();

    if (!sessionId) {
      console.log('\n⚠️  Cannot create test session without valid user');
      console.log('   Please create a session manually in the database or use an existing one');
      console.log('\n   To test the scraper standalone, you can:');
      console.log('   1. Create a user in the database');
      console.log('   2. Create a search_session for that user');
      console.log('   3. Run this script again');
      process.exit(1);
    }

    // Step 3: Create test RDPRM job
    const search = await createTestRDPRMJob(sessionId);
    searchId = search.id;

    // Step 4: Run the scraper
    const success = await testRDPRMScraper(search, sessionId);

    // Step 5: Check results
    if (searchId) {
      await checkResults(searchId);
    }

    // Step 6: Cleanup
    if (sessionId) {
      const shouldCleanup = process.env.KEEP_TEST_DATA !== 'true';
      if (shouldCleanup) {
        await cleanup(sessionId);
      } else {
        console.log('\n⚠️  Skipping cleanup (KEEP_TEST_DATA=true)');
        console.log('   Session ID:', sessionId);
      }
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    if (success) {
      console.log('║                  ✅ TEST PASSED                        ║');
    } else {
      console.log('║                  ❌ TEST FAILED                        ║');
    }
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error('\n💥 Fatal error:', error);

    // Attempt cleanup on error
    if (sessionId) {
      try {
        await cleanup(sessionId);
      } catch (cleanupError) {
        console.error('⚠️  Cleanup failed:', cleanupError);
      }
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                  ❌ TEST FAILED                        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(1);
  }
}

main();


import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkFileContentIssue() {
  const supabaseUrl = process.env.PROD_SUPABASE_URL;
  const supabaseKey = process.env.PROD_SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    console.error('PROD_SUPABASE_URL:', supabaseUrl ? 'set' : 'missing');
    console.error('PROD_SUPABASE_SERVICE_KEY:', supabaseKey ? 'set' : 'missing');
    process.exit(1);
  }

  const client = createClient(supabaseUrl, supabaseKey);
  
  const rowIds = [
    '872e9238-683b-47ae-8720-a68cc543f564',
    'f4af9e3f-27ab-474c-a8a4-d0570af847ef',
    '06948d34-2778-415e-acc7-9271ad21af6d',
    '083671f1-5e81-455c-9adb-f98fc16296c4'
  ];
  
  for (const id of rowIds) {
    console.log('\n' + '='.repeat(80));
    console.log(`Checking row: ${id}`);
    console.log('='.repeat(80));
    
    const { data, error } = await client
      .from('extraction_queue')
      .select('id, document_number, document_source, status_id, file_content')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error:', error);
      continue;
    }
    
    if (!data) {
      console.log('No data found');
      continue;
    }
    
    console.log(`Document Number: ${data.document_number}`);
    console.log(`Document Source: ${data.document_source}`);
    console.log(`Status ID: ${data.status_id}`);
    
    console.log(`\n📄 file_content:`);
    console.log(`  - Length: ${data.file_content?.length || 0} chars`);
    
    if (data.file_content) {
      try {
        const parsed = JSON.parse(data.file_content);
        console.log(`  - Valid JSON: ✅`);
        console.log(`  - Type: ${typeof parsed}`);
        console.log(`  - Is Array: ${Array.isArray(parsed)}`);
        const keys = Object.keys(parsed);
        console.log(`  - Keys (first 20): ${keys.slice(0, 20).join(', ')}`);

        if (parsed.pages) {
          console.log(`  - Has 'pages' property: ✅`);
          console.log(`  - Pages: ${parsed.pages.length}`);
          const totalInscriptions = parsed.pages.reduce((sum: number, p: any) => sum + (p.inscriptions?.length || 0), 0);
          console.log(`  - Total inscriptions: ${totalInscriptions}`);

          if (totalInscriptions === 0) {
            console.log(`  - ⚠️  WARNING: JSON is valid but has ZERO inscriptions!`);
          }
        } else if (Array.isArray(parsed)) {
          console.log(`  - ⚠️  Data is an ARRAY, not an object with 'pages' property`);
          console.log(`  - Array length: ${parsed.length}`);
          console.log(`  - First element type: ${typeof parsed[0]}`);
          if (parsed[0]) {
            console.log(`  - First element keys: ${Object.keys(parsed[0]).join(', ')}`);
            console.log(`  - First element preview: ${JSON.stringify(parsed[0]).substring(0, 200)}`);
          }
        } else {
          console.log(`  - ⚠️  Data structure is unexpected (not array, no 'pages' property)`);
          console.log(`  - Sample: ${JSON.stringify(parsed).substring(0, 300)}`);
        }
      } catch (e) {
        console.log(`  - Valid JSON: ❌`);
        console.log(`  - Error: ${e instanceof Error ? e.message : e}`);
        console.log(`  - Preview: ${data.file_content.substring(0, 200)}`);
      }
    } else {
      console.log(`  - ❌ NULL or empty`);
    }
    

  }
}

checkFileContentIssue().catch(console.error);


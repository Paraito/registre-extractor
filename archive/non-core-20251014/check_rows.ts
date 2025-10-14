import { supabaseManager } from './src/utils/supabase';

async function checkRows() {
  const client = supabaseManager.getClient('production');
  
  const rowIds = [
    '872e9238-683b-47ae-8720-a68cc543f564',
    'f4af9e3f-27ab-474c-a8a4-d0570af847ef',
    '06948d34-2778-415e-acc7-9271ad21af6d',
    '083671f1-5e81-455c-9adb-f98fc16296c4'
  ];
  
  for (const id of rowIds) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Checking row: ${id}`);
    console.log('='.repeat(80));
    
    const { data, error } = await client
      .from('extraction_queue')
      .select('id, document_number, document_source, status_id, file_content, boosted_file_content')
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
    console.log(`\nfile_content:`);
    console.log(`  - Type: ${typeof data.file_content}`);
    console.log(`  - Length: ${data.file_content?.length || 0}`);
    console.log(`  - Preview: ${data.file_content?.substring(0, 200) || '(empty)'}`);
    
    console.log(`\nboosted_file_content:`);
    console.log(`  - Type: ${typeof data.boosted_file_content}`);
    console.log(`  - Length: ${data.boosted_file_content?.length || 0}`);
    console.log(`  - Preview: ${data.boosted_file_content?.substring(0, 200) || '(empty)'}`);
    
    // Try to parse file_content as JSON
    if (data.file_content) {
      try {
        const parsed = JSON.parse(data.file_content);
        console.log(`\nfile_content parsed as JSON:`);
        console.log(`  - Type: ${typeof parsed}`);
        console.log(`  - Keys: ${Object.keys(parsed).join(', ')}`);
        if (parsed.pages) {
          console.log(`  - Pages: ${parsed.pages.length}`);
          console.log(`  - Total inscriptions: ${parsed.pages.reduce((sum: number, p: any) => sum + (p.inscriptions?.length || 0), 0)}`);
        }
      } catch (e) {
        console.log(`\nfile_content is NOT valid JSON: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

checkRows().catch(console.error);

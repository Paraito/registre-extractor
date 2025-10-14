#!/usr/bin/env tsx

import fs from 'fs/promises';
import path from 'path';

async function generateResults() {
  const runId = 'gemini-1760398520339';
  const artifactsDir = `./artifacts/${runId}`;
  const resultsFile = `./results/extraction_${runId}.txt`;

  try {
    // Load document JSON
    const docPath = path.join(artifactsDir, 'json', 'document.json');
    const docData = await fs.readFile(docPath, 'utf-8');
    const doc = JSON.parse(docData);

    // Build results text
    let fullResults = `OCR EXTRACTION RESULTS\n`;
    fullResults += `======================\n`;
    fullResults += `Date: ${new Date().toISOString()}\n`;
    fullResults += `PDF: https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/sign/index/856-Shefford-Canton_d_Ely-1756990434100.pdf\n`;
    fullResults += `Total Pages: ${doc.pages.length}\n`;
    fullResults += `Total Lines Extracted: ${doc.totalLines}\n\n`;

    // Process each page
    for (const page of doc.pages) {
      if (page.lines && page.lines.length > 0) {
        fullResults += `\n${'='.repeat(80)}\n`;
        fullResults += `PAGE ${page.page} - ${page.lines.length} INSCRIPTIONS\n`;
        fullResults += `${'='.repeat(80)}\n\n`;

        page.lines.forEach((line: any, index: number) => {
          fullResults += `${index + 1}. ${line.rawLine || 'N/A'}\n`;
          fullResults += `   - Parties: ${line.party || 'N/A'}\n`;
          fullResults += `   - Nature: ${line.nature || 'N/A'}\n`;
          fullResults += `   - Date: ${line.date || 'N/A'}\n`;
          fullResults += `   - Publication: ${line.publicationNo || 'N/A'}\n`;
          fullResults += `   - Radiation: ${line.radiation || 'N/A'}\n`;
          fullResults += `   - Remarks: ${line.remarks || 'N/A'}\n`;
          fullResults += `   - Confidence: ${line.confidence}\n\n`;
        });
      }
    }

    // Save results
    await fs.mkdir('./results', { recursive: true });
    await fs.writeFile(resultsFile, fullResults);

    console.log(`\n✅ **RESULTS FILE GENERATED**`);
    console.log(`📄 Full results saved to: ${resultsFile}`);
    console.log(`📊 Total lines extracted: ${doc.totalLines}`);

    // Show summary
    console.log(`\n📋 **PAGE BREAKDOWN:**`);
    for (const page of doc.pages) {
      const count = page.lines?.length || 0;
      const status = count > 0 ? '✅' : '❌';
      console.log(`   ${status} Page ${page.page}: ${count} inscriptions`);
    }

  } catch (error) {
    console.error('❌ Error generating results:', error);
  }
}

generateResults();
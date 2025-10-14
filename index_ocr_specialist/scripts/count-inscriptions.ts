#!/usr/bin/env tsx
/**
 * Simple inscription counter for Page 3
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `count-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2];
    if (!testUrl) {
      console.log('❌ Please provide a PDF URL');
      return;
    }
    
    console.log('\n📊 **COUNTING INSCRIPTIONS**');
    console.log(`📄 URL: ${testUrl.substring(0, 80)}...`);
    
    // Get PDF and convert
    console.log('\n📥 Fetching PDF...');
    const fetchResult = await fetchPDF(testUrl, logger);
    
    console.log('🔄 Converting to images...');
    const pdfResult = await pdfToImages(fetchResult.buffer, logger);
    const pages = pdfResult.pages;
    
    // Find Page 3
    const page3 = pages.find(p => p.pageNumber === 3);
    if (!page3) {
      console.log('❌ Page 3 not found');
      return;
    }
    
    console.log(`✅ Page 3 found: ${(page3.content.length / 1024 / 1024).toFixed(2)}MB`);
    
    // Simple counting prompt
    const countPrompt = `Compte le nombre total d'inscriptions dans ce tableau d'Index aux Immeubles.

Une inscription = une ligne qui contient:
- Une date d'enregistrement (année/mois/jour)
- Une nature d'acte (Vente, Hypothèque, etc.)
- Un numéro de publication

Compte TOUTES les inscriptions, même celles avec des guillemets (") qui indiquent la répétition d'une date.

Réponds seulement avec le nombre total d'inscriptions.`;

    // Use Gemini
    console.log('\n🤖 Counting with Gemini 2.5 Pro...');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    try {
      const response = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: page3.content.toString('base64')
              }
            },
            { text: countPrompt }
          ]
        }]
      });
      
      const result = response.response.text();
      console.log(`\n🎉 **RÉSULTAT:**`);
      console.log(`📊 Gemini 2.5 Pro compte: **${result.trim()}** inscriptions`);
      
      // Extract number from response
      const numberMatch = result.match(/\d+/);
      if (numberMatch) {
        const count = parseInt(numberMatch[0]);
        console.log(`\n📈 **ANALYSE:**`);
        console.log(`   🔢 Nombre détecté: ${count}`);
        console.log(`   🎯 Qualité: ${count >= 20 ? '✅ EXCELLENT (20+)' : count >= 15 ? '⚠️ BON (15+)' : count >= 10 ? '🔶 MODÉRÉ (10+)' : '❌ FAIBLE (<10)'}`);
      }
      
    } catch (error) {
      console.log(`\n❌ **ERREUR:**`);
      console.log(`   ${(error as Error).message}`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env tsx

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { execSync } from 'child_process';

const GEMINI_API_KEY = 'AIzaSyA7QtddkAsDqsomdxDY1s5iXYACrIrcGbI';
const PDF_URL = 'https://tmidwbceewlgqyfmuboq.supabase.co/storage/v1/object/sign/index/856-Shefford-Canton_d_Ely-1756990434100.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85MzgyN2Y2MS04OGM3LTRkN2MtYWEyZi00NzlhZTc2YWE3MjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbmRleC84NTYtU2hlZmZvcmQtQ2FudG9uX2RfRWx5LTE3NTY5OTA0MzQxMDAucGRmIiwiaWF0IjoxNzYwMjAxNTYxLCJleHAiOjE3NjI3OTM1NjF9.pw4g89W86VUJLlEtNzMP6uKUZUcy3RBxEsNhKwsx7gc';

async function main() {
  console.log('🎯 ULTRA SIMPLE TEST - GET 20 LINES FROM PAGE 3');
  
  try {
    // 1. Download PDF
    console.log('📥 Downloading PDF...');
    const response = await fetch(PDF_URL);
    const pdfBuffer = await response.arrayBuffer();
    const tempPdfPath = '/tmp/test.pdf';
    fs.writeFileSync(tempPdfPath, Buffer.from(pdfBuffer));
    console.log(`✅ PDF saved: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
    
    // 2. Convert Page 3 to PNG using pdftoppm
    console.log('🔄 Converting Page 3 to PNG...');
    const tempPngPath = '/tmp/page3.png';
    execSync(`pdftoppm -png -f 3 -l 3 -r 200 "${tempPdfPath}" /tmp/page && mv /tmp/page-3.png "${tempPngPath}"`);
    
    const imageBuffer = fs.readFileSync(tempPngPath);
    console.log(`✅ Page 3 PNG: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    
    // 3. Send to Gemini with simple extraction prompt
    console.log('🤖 Sending to Gemini 2.5 Pro...');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    const prompt = `Extrais TOUTES les inscriptions de ce tableau d'Index aux Immeubles.

Format de sortie: une ligne par inscription avec format:
PARTIES | NATURE | DATE | NUM_PUB | RADIATION | REMARQUES

Extrais TOUT - ne rate aucune ligne qui contient une inscription avec date et nature d'acte.`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageBuffer.toString('base64')
            }
          },
          { text: prompt }
        ]
      }]
    });
    
    const output = result.response.text();
    console.log('\n🎉 GEMINI RESPONSE:');
    console.log('='.repeat(80));
    console.log(output);
    console.log('='.repeat(80));
    
    // Count lines with |
    const lines = output.split('\n').filter(line => line.includes('|') && line.trim().length > 10);
    console.log(`\n📊 LINES EXTRACTED: ${lines.length}`);
    console.log(`🎯 TARGET: 20 lines`);
    console.log(`✅ SUCCESS: ${lines.length >= 20 ? 'YES!' : 'NO - missing ' + (20 - lines.length) + ' lines'}`);
    
    // Cleanup
    fs.unlinkSync(tempPdfPath);
    fs.unlinkSync(tempPngPath);
    
  } catch (error) {
    console.error('❌ ERROR:', error);
  }
}

main();

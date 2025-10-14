#!/usr/bin/env tsx
/**
 * SIMPLE PAGE 3 EXTRACTION TEST
 * 
 * Bypass all the complex pipeline - just extract Page 3 directly
 */

import { CONFIG, validateConfig } from '../config/runtime.js';
import { createLogger } from '../src/util/log.js';
import { fetchPDF } from '../src/pipeline/fetch.js';
import { pdfToImages } from '../src/pipeline/pdf_to_images.js';
import { GeminiClient } from '../src/clients/gemini.js';

async function main() {
  try {
    validateConfig();
    
    const runId = `simple-page3-${Date.now()}`;
    const logger = createLogger(runId);
    await logger.init();
    
    const testUrl = process.argv[2] || CONFIG.testPdfUrl;
    
    console.log('\n🎯 **SIMPLE PAGE 3 EXTRACTION TEST**');
    console.log('📄 Direct extraction - no complex pipeline\n');
    
    // Step 1: Get the PDF and convert to images
    console.log('📥 Fetching PDF...');
    const fetchResult = await fetchPDF(testUrl, logger);
    
    console.log('🔄 Converting to images...');
    const pdfResult = await pdfToImages(fetchResult.buffer, logger);
    const pages = pdfResult.pages;
    
    // Step 2: Find Page 3
    const page3 = pages.find(p => p.pageNumber === 3);
    if (!page3) {
      console.log('❌ Page 3 not found');
      return;
    }
    
    console.log(`✅ Page 3 found: ${(page3.content.length / 1024 / 1024).toFixed(2)}MB`);

    // Step 2.5: Downscale the image for better OCR quality (like browser)
    console.log('\n🔍 Downscaling image for better OCR...');
    const sharp = await import('sharp');
    const optimizedImage = await sharp.default(page3.content)
      .resize(3000, null, {
        kernel: 'lanczos3',
        withoutEnlargement: true
      })
      .png({ compressionLevel: 6 })
      .toBuffer();

    console.log(`   📏 Optimized: ${(page3.content.length / 1024 / 1024).toFixed(2)}MB → ${(optimizedImage.length / 1024 / 1024).toFixed(2)}MB`);

    // Step 3: Simplified prompt - no JSON requirements
    const simplePrompt = `[ROLE]
Tu es un extracteur OCR de tableaux. Tu ignores tout contexte juridique sauf que le champ NATURE doit être une nature d'acte juridique (ex.: Vente, Hypothèque, Servitude, Quittance/Mainlevée, Donation, Correction). Ta mission: lire une image de tableau d'inscriptions, exploiter la logique **temporelle**, **graphique** (écriture manuscrite) et **ordinalité** (numéros de publication croissants).

[OBJECTIF]
Extraire uniquement les lignes qui comportent un numéro de publication à 6 chiffres. Chaque ligne extraite devient une string compacte:
\`[PARTIES] | [NATURE] | [DATE] | [NUM_PUB] | [RADIATION] | [REMARQUES]\`

[CONTRAINTES GÉNÉRALES]
- Zéro hallucination. Tu n'inventes jamais de données.
- Séparateur strict: \`|\` entre 6 champs; interdit dans REMARQUES.
- Si un champ est illisible: \`null\` (sauf NUM_PUB, obligatoire pour extraire la ligne).
- \`NUM_PUB\` doit correspondre à \`\\b\\d{6}\\b\` (une ou deux hypothèses max avec confidences).

[LOGIQUE D'EXTRACTION — LES 3 PILIERS]
A) **Temporalité (fenêtre d'années + ordre chronologique)**
   1. Les tableaux couvrent typiquement **30–40 ans** max et sont **ordonnés chronologiquement de haut en bas**.
   2. Construis une **fenêtre temporelle locale** en lisant plusieurs dates déjà sûres (par ex. « 92/04/03 », « 93/10/27 », etc.). Convertis au format ISO:
      - \`YY/MM/DD\` → si \`YY ∈ [00..21]\` ⇒ \`20YY\`; si \`YY ∈ [22..99]\` ⇒ \`19YY\`.
   3. Pour toute date ambiguë (ex.: « 71/02/05 » vs « 11/02/05 »), **aligne l'année** avec la fenêtre locale: si la majorité des lignes avoisinantes sont années 70–90, interprète \`71\` comme **1971** (et non 1911).
   4. **Cohérence d'ordre**: en descendant, les dates doivent progresser globalement vers le présent; détecte/rectifie les inversions isolées si l'écriture suggère une confusion (ex.: « 1977 » lu « 1911 »).

B) **Apprentissage des graphies manuscrites (propagation de motifs)**
   1. À partir de dates **validées** (année/mois/jour), **apprends le style local des chiffres**: comment l'auteur écrit \`1\`, \`4\`, \`7\`, \`9\`, etc. (barre du 7, empattements du 1, boucle du 9…).
   2. **Propages ce modèle** aux zones plus difficiles (NUM_PUB et autres dates):
      - Si le \`7\` local possède une barre horizontale, privilégie \`7\` vs \`1\` en cas d'ambiguïté identique ailleurs.
      - Si le \`9\` local se confond avec \`4\`, utilise les traits appris (boucle vs angle) pour trancher.
   3. Mets à jour les **scores de confiance** en fonction de cet apprentissage: plus un chiffre concorde avec le motif appris, plus la confiance augmente.

C) **Ordinalité des numéros de publication (croissants de haut en bas)**
   1. Les **NUM_PUB (6 chiffres)** augmentent **globalement** en descendant le tableau.
   2. Utilise cette contrainte pour résoudre les hésitations:
      - Si deux lectures concurrencent (ex.: \`361292\` vs \`361262\`), compare-les au **contexte des NUM_PUB proches** (au-dessus/dessous). Choisis celle qui **préserve la monotonie croissante** (avec petites exceptions locales tolérées).
   3. Si une rupture forte apparaît (nombre nettement inférieur à ceux du haut), réévalue les digits ambigus (\`4\` vs \`9\`, \`1\` vs \`7\`, etc.) via le **modèle de graphies** (pilier B) et le **rythme temporel** (pilier A).

[FLUX D'EXÉCUTION]
1) **Segmentation de lignes** du tableau.
2) **Détection précoce** des dates « faciles » pour poser la **fenêtre temporelle** (A.2).
3) **Extraction brute** des 6 champs (sans correction).
4) **Normalisation progressive**:
   - Applique **A (Temporalité)** pour fixer les années ambiguës et convertir toutes les dates en ISO \`YYYY-MM-DD\` (sinon \`null\`).
   - Applique **B (Graphies)** pour corriger les digits incertains dans **DATE** et surtout **NUM_PUB**.
   - Applique **C (Ordinalité NUM_PUB)** pour départager les hypothèses et lisser la séquence.
5) **NATURE**: doit être une **nature d'acte juridique** plausible; si abréviation, normalise (ex.: \`Hyp\`→\`Hypothèque\`, \`Vte\`→\`Vente\`, \`Serv.\`→\`Servitude\`, \`Quit.\`→\`Quittance\`, \`Don.\`→\`Donation\`, \`Corr.\`→\`Correction\`). Si impossible à lire: \`null\`.
6) **PARTIES**: \`Nom(s) & Nom(s)\`; variantes séparées par \`;\` avec pourcentages si utile; \`null\` si illisible.
7) **RADIATION**: \`T123456\` / \`P123456\` si présent, sinon vide.
8) **REMARQUES**: court texte libre (pas de \`|\`), sinon vide.
9) **Comptage & complétion**:
   - \`inscriptions_detected\` = nombre de lignes avec **au moins un** \`\\b\\d{6}\\b\`.
   - \`inscriptions_extracted\` = nombre de strings produites.
   - \`is_completed = true\` si et seulement si les deux sont égaux; sinon \`false\`.

[VALIDATIONS FINALES]
- Chaque string contient exactement **5 pipes** ⇒ 6 champs.
- **DATE** est en ISO ou \`null\`; **NUM_PUB** = 6 chiffres (1–2 hypothèses max, avec confidences).
- La **séquence des NUM_PUB** est globalement croissante; si non, réexaminer les digits ambigus avec (A) et (B).
- Le JSON est **strictement valide**; aucun texte hors JSON.

Retourne simplement les lignes extraites, une par ligne.`;

    // Step 4: Extract with Gemini
    console.log('\n🤖 Extracting with Gemini 2.5 Pro...');
    const geminiClient = new GeminiClient(logger);
    
    try {
      // Use Gemini directly with raw response
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

      const response = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: optimizedImage.toString('base64')
              }
            },
            { text: simplePrompt }
          ]
        }]
      });

      const rawResponse = response.response.text();
      console.log(`\n🎉 **GEMINI 2.5 PRO EXTRACTION RESULTS:**`);
      console.log(`📄 Raw response length: ${rawResponse.length} characters`);
      console.log(`\n📋 **FULL OUTPUT:**`);
      console.log('='.repeat(80));
      console.log(rawResponse);
      console.log('='.repeat(80));

      // Count lines that look like extractions (contain |)
      const lines = rawResponse.split('\n').filter(line => line.includes('|') && line.trim().length > 10);
      console.log(`\n📊 **QUICK ANALYSIS:**`);
      console.log(`   📝 Lines with | separator: ${lines.length}`);
      console.log(`   🎯 Success: ${lines.length >= 20 ? '✅ EXCELLENT (20+ lines)' : lines.length >= 15 ? '⚠️ GOOD (15+ lines)' : lines.length >= 10 ? '🔶 MODERATE (10+ lines)' : '❌ LOW (<10 lines)'}`);

      if (lines.length > 0) {
        console.log(`\n📋 **SAMPLE EXTRACTED LINES:**`);
        lines.slice(0, 5).forEach((line, i) => {
          console.log(`   ${i + 1}. ${line.trim()}`);
        });
        if (lines.length > 5) {
          console.log(`   ... and ${lines.length - 5} more lines`);
        }
      }
      
    } catch (error) {
      console.log(`\n❌ **EXTRACTION FAILED**`);
      console.log(`   Error: ${(error as Error).message}`);
      
      // Try with Claude as backup
      console.log(`\n🔄 Trying Claude as backup...`);
      try {
        const { ClaudeClient } = await import('../src/clients/claude.js');
        const claudeClient = new ClaudeClient(logger);
        
        // Resize image for Claude first
        const sharp = await import('sharp');
        const metadata = await sharp.default(page3.content).metadata();
        const resizeFactor = Math.min(1, 3000 / Math.max(metadata.width || 0, metadata.height || 0));
        
        const resizedImage = await sharp.default(page3.content)
          .resize(Math.floor((metadata.width || 0) * resizeFactor), Math.floor((metadata.height || 0) * resizeFactor))
          .png({ compressionLevel: 9 })
          .toBuffer();
        
        console.log(`   📏 Resized: ${(page3.content.length / 1024 / 1024).toFixed(2)}MB → ${(resizedImage.length / 1024 / 1024).toFixed(2)}MB`);
        
        const claudeResult = await claudeClient.extractText(resizedImage, simplePrompt, page3.pageNumber);
        
        console.log(`\n🎉 **CLAUDE BACKUP RESULTS**`);
        console.log(`📊 Lines extracted: ${claudeResult.lines.length}`);
        
        if (claudeResult.lines.length > 0) {
          claudeResult.lines.slice(0, 5).forEach((line, i) => {
            console.log(`   ${i + 1}. ${line.party || 'N/A'} | ${line.nature || 'N/A'} | ${line.date || 'N/A'}`);
          });
        }
        
      } catch (claudeError) {
        console.log(`   ❌ Claude also failed: ${(claudeError as Error).message}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    process.exit(1);
  }
}

main();

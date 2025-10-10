/**
 * Integration test for OCR sanitizer with realistic data
 * This test uses the actual sample data from the user's example
 */

import { sanitizeOCRResult } from '../sanitizer';

describe('OCR Sanitizer - Integration Test', () => {
  it('should sanitize the real-world example from the user', () => {
    // This is the actual verbose output from the user's example
    const verboseText = `
--- Page 1 ---

ÉTAPE PRÉLIMINAIRE CRITIQUE : DESCRIPTION DÉTAILLÉE

*   **Type de document:** Formulaire pré-imprimé (index des immeubles)
*   **Qualité de l'écriture:** Principalement lisible, avec quelques variations dans la clarté des chiffres.
*   **Langue du document:** Français
*   **Structure visible:** Tableau avec colonnes (Date de présentation d'inscription, Numéro, Nature de l'acte, Qualité, Nom des parties, Remarques, Avis d'adresse, Radiations) et lignes.
*   **Nombre approximatif de lignes visibles:** 9 lignes de données.
*   **Éléments particuliers:** En-têtes de colonnes pré-imprimés, texte informatif au-dessus du tableau, abréviations dans les remarques, et une section numérisée mentionnée.

Type de Modèle Identifié : Type Old 2 (basé sur la structure des colonnes)

Métadonnées de l'En-tête :

*   Circonscription foncière: Montréal
*   Cadastre: Cité de Montréal (quartier Sainte-Marie)
*   Lot: 1358-176
*   Date d'établissement: 1924-10-28
*   Plan: Liste des plans

Dates de mise à jour du Registre:

*   Droits: 2025-10-09 14:54
*   Radiations: 2025-07-22 14:34

Données du Tableau :

Ligne 1:

*   Date de présentation d'inscription: 1986-09-12
*   Numéro: 3 770 292
*   Nature de l'acte: Testament
*   Qualité: Décédé
*   Nom des parties: BEAUREGARD, ADRIEN
*   Remarques: PERMIS DE DISPOSER
*   Avis d'adresse: [Vide]
*   Radiations: [Vide]

Ligne 2:

*   Date de présentation d'inscription: 1986-09-17
*   Numéro: 3 772 020
*   Nature de l'acte: Déclaration de transmission
*   Qualité: Légataire
*   Nom des parties: LAVOIE, JULIETTE
*   Remarques: PERMIS DE DISPOSER Porter: 3 770 292
*   Avis d'adresse: [Vide]
*   Radiations: [Vide]

Ligne 3:

*   Date de présentation d'inscription: 1987-02-06
*   Numéro: 3 826 865
*   Nature de l'acte: Testament
*   Qualité: Décédé
*   Nom des parties: LAVOIE, JULIETTE
*   Remarques: [Vide]
*   Avis d'adresse: [Vide]
*   Radiations: [Vide]

Ligne 4:

*   Date de présentation d'inscription: 1987-02-06
*   Numéro: 3 826 866
*   Nature de l'acte: Déclaration de transmission
*   Qualité: Légataire
*   Nom des parties: BEAUREGARD, ANDRE
*   Remarques: Porter: 3 826 865
*   Avis d'adresse: [Vide]
*   Radiations: [Vide]

Ligne 5:

*   Date de présentation d'inscription: 1989-05-19
*   Numéro: 4 155 383
*   Nature de l'acte: Servitude
*   Qualité: 1ere partie 2ième partie
*   Nom des parties: THIBODEAU, GUY BEAUREGARD, ANDRE
*   Remarques: 2EME IMMEUBLE
*   Avis d'adresse: [Vide]
*   Radiations: [Vide]

Ligne 6:

*   Date de présentation d'inscription: 1990-05-25
*   Numéro: 4 282 991
*   Nature de l'acte: Hypothèque
*   Qualité: Créancier Débiteur
*   Nom des parties: CSSE POP ST EUSEBE BEAUREGARD, ANDRE
*   Remarques: 75 000,00 $ avec intérêts
*   Avis d'adresse: 1 067 734
*   Radiations: T 14 454 660

Résumé :

*   Nombre total de lignes extraites: 6
*   Lignes avec haute confiance (>90%): 6
*   Lignes avec confiance moyenne (70-90%): 0
*   Lignes avec faible confiance (<70%) nécessitant révision manuelle: 0

✅ EXTRACTION_COMPLETE: [6] lignes traitées sur [6] lignes visibles.
`;

    const result = sanitizeOCRResult(verboseText);

    // Verify structure
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(1);

    // Verify metadata
    const metadata = result.pages[0].metadata;
    expect(metadata.circonscription).toBe('Montréal');
    expect(metadata.cadastre).toBe('Cité de Montréal (quartier Sainte-Marie)');
    expect(metadata.lot_number).toBe('1358-176');

    // Verify inscriptions count
    const inscriptions = result.pages[0].inscriptions;
    expect(inscriptions).toHaveLength(6);

    // Verify Ligne 1 (single party)
    expect(inscriptions[0].acte_publication_date).toBe('1986-09-12');
    expect(inscriptions[0].acte_publication_number).toBe('3 770 292');
    expect(inscriptions[0].acte_nature).toBe('Testament');
    expect(inscriptions[0].parties).toHaveLength(1);
    expect(inscriptions[0].parties[0].name).toBe('BEAUREGARD, ADRIEN');
    expect(inscriptions[0].parties[0].role).toBe('Décédé');
    expect(inscriptions[0].remarques).toBe('PERMIS DE DISPOSER');
    expect(inscriptions[0].radiation_number).toBeNull();

    // Verify Ligne 2
    expect(inscriptions[1].acte_publication_number).toBe('3 772 020');
    expect(inscriptions[1].acte_nature).toBe('Déclaration de transmission');
    expect(inscriptions[1].parties[0].name).toBe('LAVOIE, JULIETTE');
    expect(inscriptions[1].parties[0].role).toBe('Légataire');

    // Verify Ligne 5 (multiple parties with role indicators)
    expect(inscriptions[4].acte_publication_number).toBe('4 155 383');
    expect(inscriptions[4].acte_nature).toBe('Servitude');
    expect(inscriptions[4].parties).toHaveLength(2);
    expect(inscriptions[4].parties[0].name).toBe('THIBODEAU, GUY');
    expect(inscriptions[4].parties[0].role).toBe('1ere partie');
    expect(inscriptions[4].parties[1].name).toBe('BEAUREGARD, ANDRE');
    expect(inscriptions[4].parties[1].role).toBe('2ième partie');
    expect(inscriptions[4].remarques).toBe('2EME IMMEUBLE');

    // Verify Ligne 6 (compound role + radiation)
    expect(inscriptions[5].acte_publication_number).toBe('4 282 991');
    expect(inscriptions[5].acte_nature).toBe('Hypothèque');
    expect(inscriptions[5].parties).toHaveLength(1);
    expect(inscriptions[5].parties[0].role).toBe('Créancier Débiteur');
    expect(inscriptions[5].remarques).toBe('75 000,00 $ avec intérêts');
    expect(inscriptions[5].radiation_number).toBe('T 14 454 660');

    // Verify JSON is serializable
    const jsonString = JSON.stringify(result, null, 2);
    expect(jsonString).toBeTruthy();
    expect(jsonString.length).toBeGreaterThan(0);

    // Verify no verbose fluff in the output
    expect(jsonString).not.toContain('ÉTAPE PRÉLIMINAIRE');
    expect(jsonString).not.toContain('Type de document');
    expect(jsonString).not.toContain('Qualité de l\'écriture');
    expect(jsonString).not.toContain('EXTRACTION_COMPLETE');

    // Log the clean JSON for visual inspection
    console.log('\n=== CLEAN JSON OUTPUT ===');
    console.log(jsonString);
    console.log('\n=== SIZE COMPARISON ===');
    console.log(`Verbose input: ${verboseText.length} characters`);
    console.log(`Clean JSON: ${jsonString.length} characters`);
    console.log(`Reduction: ${Math.round((1 - jsonString.length / verboseText.length) * 100)}%`);
  });

  it('should handle multi-page documents', () => {
    const verboseText = `
--- Page 1 ---

Circonscription foncière: Montréal
Cadastre: Test 1
Lot: 123-456

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Vente
Qualité: Vendeur
Nom des parties: SMITH, JOHN
Remarques: Page 1
Radiations: [Vide]

--- Page 2 ---

Circonscription foncière: Québec
Cadastre: Test 2
Lot: 789-012

Ligne 1:
Date de présentation d'inscription: 2020-02-01
Numéro: 2000000
Nature de l'acte: Hypothèque
Qualité: Créancier
Nom des parties: BANK, ROYAL
Remarques: Page 2
Radiations: [Vide]

--- Page 3 ---

Circonscription foncière: Laval
Cadastre: Test 3
Lot: 345-678

Ligne 1:
Date de présentation d'inscription: 2020-03-01
Numéro: 3000000
Nature de l'acte: Servitude
Qualité: Propriétaire
Nom des parties: HYDRO, QUEBEC
Remarques: Page 3
Radiations: [Vide]
`;

    const result = sanitizeOCRResult(verboseText);

    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].metadata.circonscription).toBe('Montréal');
    expect(result.pages[1].metadata.circonscription).toBe('Québec');
    expect(result.pages[2].metadata.circonscription).toBe('Laval');
    expect(result.pages[0].inscriptions[0].remarques).toBe('Page 1');
    expect(result.pages[1].inscriptions[0].remarques).toBe('Page 2');
    expect(result.pages[2].inscriptions[0].remarques).toBe('Page 3');
  });
});


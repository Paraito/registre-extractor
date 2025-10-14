/**
 * Unit tests for OCR sanitizer
 */

import { sanitizeOCRResult } from '../sanitizer';

describe('OCR Sanitizer', () => {
  describe('sanitizeOCRResult', () => {
    it('should parse single page with single inscription', () => {
      const verboseText = `
--- Page 1 ---

ÉTAPE PRÉLIMINAIRE CRITIQUE : DESCRIPTION DÉTAILLÉE
Type de document: Formulaire pré-imprimé

Métadonnées de l'En-tête :
Circonscription foncière: Montréal
Cadastre: Cité de Montréal (quartier Sainte-Marie)
Lot: 1358-176

Données du Tableau :

Ligne 1:
Date de présentation d'inscription: 1986-09-12
Numéro: 3 770 292
Nature de l'acte: Testament
Qualité: Décédé
Nom des parties: BEAUREGARD, ADRIEN
Remarques: PERMIS DE DISPOSER
Radiations: [Vide]

✅ EXTRACTION_COMPLETE: 1 lignes traitées sur 1 lignes visibles.
`;

      const result = sanitizeOCRResult(verboseText);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].metadata.circonscription).toBe('Montréal');
      expect(result.pages[0].metadata.cadastre).toBe('Cité de Montréal (quartier Sainte-Marie)');
      expect(result.pages[0].metadata.lot_number).toBe('1358-176');
      expect(result.pages[0].inscriptions).toHaveLength(1);

      const inscription = result.pages[0].inscriptions[0];
      expect(inscription.acte_publication_date).toBe('1986-09-12');
      expect(inscription.acte_publication_number).toBe('3 770 292');
      expect(inscription.acte_nature).toBe('Testament');
      expect(inscription.parties).toHaveLength(1);
      expect(inscription.parties[0].name).toBe('BEAUREGARD, ADRIEN');
      expect(inscription.parties[0].role).toBe('Décédé');
      expect(inscription.remarques).toBe('PERMIS DE DISPOSER');
      expect(inscription.radiation_number).toBeNull();
    });

    it('should parse multiple pages', () => {
      const verboseText = `
--- Page 1 ---

Métadonnées de l'En-tête :
Circonscription foncière: Montréal
Cadastre: Test Cadastre 1
Lot: 123-456

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Vente
Qualité: Vendeur
Nom des parties: SMITH, JOHN
Remarques: Test
Radiations: [Vide]

--- Page 2 ---

Métadonnées de l'En-tête :
Circonscription foncière: Québec
Cadastre: Test Cadastre 2
Lot: 789-012

Ligne 1:
Date de présentation d'inscription: 2020-02-01
Numéro: 2000000
Nature de l'acte: Hypothèque
Qualité: Créancier
Nom des parties: BANK, ROYAL
Remarques: 50000$
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);

      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].metadata.circonscription).toBe('Montréal');
      expect(result.pages[1].pageNumber).toBe(2);
      expect(result.pages[1].metadata.circonscription).toBe('Québec');
    });

    it('should handle missing metadata', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Vente
Qualité: Vendeur
Nom des parties: SMITH, JOHN
Remarques: Test
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);

      expect(result.pages[0].metadata.circonscription).toBeNull();
      expect(result.pages[0].metadata.cadastre).toBeNull();
      expect(result.pages[0].metadata.lot_number).toBeNull();
    });

    it('should parse single party', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Testament
Qualité: Décédé
Nom des parties: BEAUREGARD, ADRIEN
Remarques: [Vide]
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);
      const parties = result.pages[0].inscriptions[0].parties;

      expect(parties).toHaveLength(1);
      expect(parties[0].name).toBe('BEAUREGARD, ADRIEN');
      expect(parties[0].role).toBe('Décédé');
    });

    it('should parse multiple parties with role indicators', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Servitude
Qualité: 1ere partie 2ième partie
Nom des parties: THIBODEAU, GUY BEAUREGARD, ANDRE
Remarques: [Vide]
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);
      const parties = result.pages[0].inscriptions[0].parties;

      expect(parties).toHaveLength(2);
      expect(parties[0].name).toBe('THIBODEAU, GUY');
      expect(parties[0].role).toBe('1ere partie');
      expect(parties[1].name).toBe('BEAUREGARD, ANDRE');
      expect(parties[1].role).toBe('2ième partie');
    });

    it('should handle compound roles', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Hypothèque
Qualité: Créancier Débiteur
Nom des parties: BEAUREGARD, ANDRE
Remarques: [Vide]
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);
      const parties = result.pages[0].inscriptions[0].parties;

      expect(parties).toHaveLength(1);
      expect(parties[0].name).toBe('BEAUREGARD, ANDRE');
      expect(parties[0].role).toBe('Créancier Débiteur');
    });

    it('should select highest confidence option', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: Option 1: 1986-09-12 (Confiance: 95%)
Option 2: 1986-09-13 (Confiance: 5%)
Numéro: Option 1: 3 770 292 (Confiance: 99%)
Option 2: 3 770 293 (Confiance: 1%)
Nature de l'acte: Option 1: Testament (Confiance: 98%)
Option 2: Vente (Confiance: 2%)
Qualité: Décédé
Nom des parties: BEAUREGARD, ADRIEN
Remarques: [Vide]
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);
      const inscription = result.pages[0].inscriptions[0];

      expect(inscription.acte_publication_date).toBe('1986-09-12');
      expect(inscription.acte_publication_number).toBe('3 770 292');
      expect(inscription.acte_nature).toBe('Testament');
    });

    it('should handle [Vide] fields as null', () => {
      const verboseText = `
--- Page 1 ---

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Vente
Qualité: [Vide]
Nom des parties: SMITH, JOHN
Remarques: [Vide]
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);
      const inscription = result.pages[0].inscriptions[0];

      expect(inscription.remarques).toBeNull();
      expect(inscription.radiation_number).toBeNull();
    });

    it('should handle malformed input gracefully', () => {
      const verboseText = 'This is not valid OCR output';

      const result = sanitizeOCRResult(verboseText);

      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].inscriptions).toHaveLength(0);
    });

    it('should handle multiple inscriptions on same page', () => {
      const verboseText = `
--- Page 1 ---

Circonscription foncière: Montréal
Cadastre: Test
Lot: 123

Ligne 1:
Date de présentation d'inscription: 2020-01-01
Numéro: 1000000
Nature de l'acte: Vente
Qualité: Vendeur
Nom des parties: SMITH, JOHN
Remarques: First
Radiations: [Vide]

Ligne 2:
Date de présentation d'inscription: 2020-02-01
Numéro: 2000000
Nature de l'acte: Hypothèque
Qualité: Créancier
Nom des parties: BANK, ROYAL
Remarques: Second
Radiations: [Vide]
`;

      const result = sanitizeOCRResult(verboseText);

      expect(result.pages[0].inscriptions).toHaveLength(2);
      expect(result.pages[0].inscriptions[0].acte_publication_number).toBe('1000000');
      expect(result.pages[0].inscriptions[1].acte_publication_number).toBe('2000000');
    });
  });
});


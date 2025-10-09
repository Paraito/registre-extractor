/**
 * OCR Extraction Prompt for Quebec Land Registry Index Documents
 * This prompt guides Gemini to extract structured data from index images
 */
export const EXTRACT_PROMPT = `Schéma de Pensées Dynamique pour l'Analyse d'Index aux Immeubles

ÉTAPE PRÉLIMINAIRE CRITIQUE : DESCRIPTION DÉTAILLÉE
Avant de commencer l'extraction structurée, tu DOIS d'abord décrire en détail ce que tu vois dans l'image :
- Type de document (registre manuscrit, formulaire pré-imprimé, etc.)
- Qualité de l'écriture (lisible, difficile, partiellement effacée, etc.)
- Langue du document
- Structure visible (colonnes, en-têtes, lignes, etc.)
- Nombre approximatif de lignes visibles
- Éléments particuliers (annotations, tampons, corrections, etc.)

Cette description préliminaire t'aidera à mieux comprendre le contexte avant l'extraction.

---

Ce processus est conçu pour être appliqué à n'importe quelle image de registre foncier, en suivant une séquence logique allant du général au particulier, et en séparant l'observation visuelle de l'inférence contextuelle.
Étape 0 : Amorçage du Modèle de Connaissances (Pré-analyse)
Avant d'examiner l'image, j'active une base de données interne des "Natures d'Actes" possibles, organisée par fréquence et par catégorie fonctionnelle. Cette liste est une heuristique qui guide l'analyse, et non une contrainte.
Catalogue Priorisé des Natures d'Actes (Top 30 sur 100+)
Groupe 1 : Transferts de Propriété (Très Haute Fréquence)
Vente (Sale)
Donation (Gift)
Déclaration de Transmission (Suite à un décès)
Échange (Exchange)
Cession (Assignment)
Dation en Paiement (Donner un bien pour régler une dette)
Jugement (Qui transfère le titre de propriété)
Groupe 2 : Charges et Sûretés (Très Haute Fréquence)
8. Hypothèque (Mortgage / Hypothec)
9. Obligation (Obligation - souvent liée à une hypothèque)
10. Quittance / Mainlevée (Discharge / Release - annulation d'une charge)
11. Privilège (Lien - ex: privilège de construction)
Groupe 3 : Droits et Restrictions (Haute Fréquence)
12. Servitude (Easement)
13. Déclaration de Copropriété (Divise / Indivise)
14. Bail (Lease - surtout à long terme comme le bail emphytéotique)
15. Droit d'Usage / Usufruit (Right of Use / Usufruct)
Groupe 4 : Actes Administratifs et Correctifs (Fréquence Moyenne)
16. Avis d'Adresse (Notice of Address)
17. Correction / Acte Rectificatif (Corrective Deed)
18. Préavis d'Exercice (d'un droit hypothécaire)
19. Renonciation (Waiver)
20. Pacte de Préférence (Right of First Refusal)
Groupe 5 : Actes Familiaux et de Partage (Fréquence Moyenne)
21. Contrat de Mariage (Marriage Contract)
22. Testament (Will)
23. Partage (Partition - fin de l'indivision)
24. Pacte de Vie Commune (Civil Union)
Groupe 6 : Moins Fréquents mais Possibles
25. Procuration (Power of Attorney)
26. Résolution (Corporate Resolution)
27. Acquiescement (Acquiescence)
28. Vente pour Taxes (Tax Sale)
29. Sûreté (Security)
30. Résiliation (Resiliation / Termination)
(Cette liste mentale se poursuit avec 70+ autres types d'actes plus rares...)
Instructions pour l'Analyse d'une Nouvelle Image (Application du Processus)
Face à l'image fournie, je suis rigoureusement les étapes suivantes :
Étape 1 : Classification du Modèle
Analyse de la Structure Visuelle :
Apparence : Le document est un formulaire pré-imprimé avec des champs remplis à la main. Il n'est pas entièrement manuscrit.
Langue : Les en-têtes imprimés (NOMS DES PARTIES, Nature de l'Acte, ENREGISTREMENT, etc.) sont en français.
Titres des Colonnes : Je lis les en-têtes exacts : NOMS DES PARTIES, Nature de l'Acte, ENREGISTREMENT (avec Date, Reg., Vol., N°), Radiation, REMARQUES.
Correspondance et Décision :
Type Old 1 est une possibilité, mais les colonnes d'enregistrement ne correspondent pas (Reg. et Vol. sont présents ici).
Type Old 2 correspond parfaitement. Bien que ce ne soit pas un registre entièrement manuscrit, la structure des colonnes est identique à ce modèle.
Les autres modèles sont clairement incompatibles (langue, colonnes différentes).
Conclusion de l'Étape 1 : Je classifie le document avec une haute confiance.
Type de Modèle Identifié : Type Old 2
Étape 2 : Extraction des Métadonnées de l'En-tête
Je scanne la zone supérieure du document, au-dessus du tableau.
Je localise Lot no et je lis la valeur manuscrite : 283-359.
Je lis le titre principal à droite : PAROISSE DE STE-JULIE.
Je repère la mention manuscrite subdivisé le et je lis la date : 79-01-09.
Je note également 151 en haut à gauche (numéro de page) et Allen 894 (possiblement une référence interne ou de l'employé).
Étape 3 : Extraction Structurée des Données du Tableau (Ligne par Ligne)
Je me concentre maintenant sur la première ligne de données, en appliquant le processus de déchiffrage dynamique pour TOUTES les colonnes critiques.

Analyse Visuelle de "NOMS DES PARTIES" :
Isolation : J'isole les noms manuscrits.
Décomposition : J'identifie chaque partie en analysant l'écriture cursive, les abréviations possibles, et les noms d'organismes.
Génération d'Hypothèses : Pour les noms d'organismes (Hydro-Québec, banques, ministères), je compare avec ma base de données d'entités connues.
Confrontation : J'évalue la correspondance visuelle et contextuelle pour chaque partie.
Validation Croisée : Je valide avec Nature de l'Acte, Remarques, et montants éventuels.

Analyse Visuelle de "Nature de l'Acte" :
Isolation : J'isole le mot manuscrit.
Décomposition : Il commence par un 'S' majuscule, suivi de plusieurs lettres cursives, dont au moins une lettre haute (t ou d), et se termine par un e. La longueur totale est d'environ 8-10 lettres.
Génération d'Hypothèses (Filtrage du Catalogue) :
Je filtre mon catalogue de l'Étape 0 pour les mots commençant par 'S'. Les candidats principaux sont : Servitude, Sûreté. "Vente" (Sale en anglais) est rejeté car le document est en français.
Confrontation et Évaluation :
Servitude : Je superpose ce mot à l'écriture. La correspondance est excellente. La séquence S-e-r-v et le groupe t-u-d-e s'alignent très bien avec les formes visibles. Score de correspondance visuelle : 9.5/10.
Sûreté : La correspondance est moins bonne. Le mot est plus court et la structure des lettres centrales ne correspond pas aussi bien. Score de correspondance visuelle : 3/10.
Validation Croisée (avec les colonnes adjacentes) :
NOMS DES PARTIES : Je lis S. Pronovost et Hydro Québec. Je me pose la question : "Quel est l'acte le plus courant entre un individu et Hydro-Québec ?". La réponse est Servitude. Cela valide fortement mon hypothèse visuelle principale.
REMARQUES : Je lis p S. O.. Cela peut signifier "pour Service Officiel" ou une abréviation similaire, ce qui est cohérent avec une servitude d'utilité publique.

Analyse Visuelle de "Date" :
Isolation : J'isole la date manuscrite (format YY-MM-DD ou autres formats possibles).
Décomposition : J'analyse chaque chiffre individuellement, en tenant compte des écritures cursives où certains chiffres peuvent être ambigus (1/7, 3/8, 5/6, 0/6).
Génération d'Hypothèses : Pour chaque chiffre ambigu, je génère des options plausibles.
Validation Contextuelle : Je vérifie la cohérence temporelle (la date est-elle logique par rapport aux autres dates du registre, aux événements historiques, etc.).

Analyse Visuelle de "N° (Numéro de Publication)" - CRITIQUE :
Isolation : J'isole le numéro manuscrit. C'est LA donnée la plus importante du registre.
Décomposition : J'analyse chaque chiffre avec une attention extrême. Les numéros de publication sont généralement séquentiels et suivent des patterns prévisibles.
Génération d'Hypothèses : Pour CHAQUE chiffre ambigu, je fournis des options avec scores de confiance. Par exemple :
  - Un "3" mal formé peut ressembler à un "8" ou un "5"
  - Un "1" peut ressembler à un "7"
  - Un "0" peut ressembler à un "6" ou un "9"
Validation Croisée : Je compare avec les numéros adjacents dans le registre (séquentialité), la date (cohérence temporelle), et le format attendu pour l'époque.
IMPORTANT : Si plusieurs options sont viables, je les liste TOUTES avec leurs scores de confiance respectifs.

Extraction des Autres Colonnes :
Reg., Vol., Radiation : Je note s'ils sont vides ou contiennent des données.

Étape 4 : Présentation des Résultats
Je structure ma réponse finale en suivant le format demandé, avec OPTIONS DE CONFIANCE pour les colonnes critiques.

Type de Modèle Identifié : Type Old 2
Métadonnées de l'En-tête :
Lot no : 283-359
Paroisse : STE-JULIE
Subdivisé le : 79-01-09
Page : 151

Données du Tableau (Ligne 1) :
NOMS DES PARTIES :
Option 1 : S. Pronovost et Hydro Québec (Confiance : 85%)
Option 2 : S. Pronovost et Hydro-Québec (Confiance : 10%)
Option 3 : S. Provencher et Hydro Québec (Confiance : 5%)

Nature de l'Acte :
Option 1 : Servitude (Confiance : 95%)
Option 2 : Sûreté (Confiance : 5%)

ENREGISTREMENT - Date :
Option 1 : 78-01-29 (Confiance : 90%)
Option 2 : 78-01-28 (Confiance : 7%)
Option 3 : 78-07-29 (Confiance : 3%)

ENREGISTREMENT - Reg. : [Vide]
ENREGISTREMENT - Vol. : [Vide]

ENREGISTREMENT - N° (NUMÉRO DE PUBLICATION - CRITIQUE) :
Option 1 : 146828 (Confiance : 80%)
Option 2 : 146823 (Confiance : 12%)
Option 3 : 146829 (Confiance : 8%)
Analyse : Le dernier chiffre est légèrement ambigu, pourrait être un "8" ou un "3" ou un "9" selon l'angle de lecture.

Radiation : [Vide]
REMARQUES : p S. O.

INSTRUCTIONS IMPORTANTES :
- TOUJOURS fournir des options de confiance pour : PARTIES, Nature, Date, et surtout N° (numéro de publication)
- Le numéro de publication est LA donnée la plus critique - fournir au moins 2-3 options si incertain
- Expliquer brièvement pourquoi certains chiffres/lettres sont ambigus
- Utiliser validation croisée entre colonnes pour améliorer la confiance

RÈGLE ABSOLUE - EXTRACTION COMPLÈTE :
Tu DOIS extraire TOUTES les lignes visibles dans le tableau sans exception.
Ne t'arrête JAMAIS à mi-chemin. Ne demande JAMAIS de confirmation pour continuer.
Continue ligne par ligne jusqu'à ce que TOUTES les entrées du registre visible soient extraites.
Si tu vois 10 lignes, extrais les 10. Si tu vois 50 lignes, extrais les 50.
Ceci est un processus AUTOMATIQUE - tu ne peux PAS demander si l'utilisateur veut que tu continues.

FORMAT DE SORTIE FINAL :
Présente TOUTES les lignes extraites dans un format structuré et cohérent (Markdown recommandé).
À la fin, fournis un résumé :
- Nombre total de lignes extraites
- Lignes avec haute confiance (>90%)
- Lignes avec confiance moyenne (70-90%)
- Lignes avec faible confiance (<70%) nécessitant révision manuelle

MARQUEUR DE COMPLÉTION OBLIGATOIRE :
Tu DOIS terminer ta réponse avec EXACTEMENT cette ligne :
✅ EXTRACTION_COMPLETE: [X] lignes traitées sur [X] lignes visibles.

Si cette ligne n'apparaît pas, cela signifie que la réponse a été tronquée.`;

/**
 * OCR Boost Prompt for Quebec Land Registry Index Documents
 * This prompt applies 60+ domain-specific correction rules to raw OCR text
 */
export const BOOST_PROMPT = `Tu es un expert en analyse de registres fonciers québécois. Tu dois appliquer les règles de boost suivantes au texte brut fourni pour produire un résultat en Markdown bien formaté et facile à lire.

RÈGLES DE BOOST À APPLIQUER :

**Utilités / électricité (servitudes & co.)**
1. Hydro-Québec détecté (même faible) et Nature hésite Vente vs Servitude → boost Servitude, downrank Vente.
2. Jetons proches de « Hydro », « H-Québec », « HQ » dans colonne Parties + tokens « serv. », « poteau », « ligne » en Remarques → boost Servitude.
3. Hydro-Québec + Nature lue « Modification » (incertaine) → privilégier Modification de servitude plutôt que « Modification de vente ».
4. Hydro-Québec présent + #publi valide dans même ligne d'index → boost Servitude même si Nature OCR = « Vente » (prob. faible).
5. Partie = fournisseur d'électricité municipal (p. ex. « Service d'électricité [Ville] ») + indices « ligne/mesurage » → boost Servitude.
6. Tokens « conditions de service d'électricité », « mesurage », « équipements » dans Remarques → boost Servitude et Parties→Hydro-Québec si fuzzy ≈ « Hydro ».

**Transports, emprises, corridors**
7. Ministère des Transports détecté + Nature ≈ « Servitude/Emprise/Accès » incertaine → boost Servitude.
8. Chemins de fer (CN/CP) dans Parties + Nature hésite Vente/Servitude → boost Servitude (corridor ferroviaire).
9. Mots-clés « emprise », « passage », « rail », « voie » en Remarques + organisme public/para-public → boost Servitude.

**Banques & finance (hypothèques, mainlevées, cessions de rang)**
10. Banque Royale du Canada / RBC dans Parties + Nature ambiguë Hypothèque/Autre → boost Hypothèque.
11. RBC + Remarques contiennent un montant → fort boost Hypothèque.
12. RBC comme seule Partie « institution » et une autre Partie « personne physique » → boost Hypothèque.
13. Radiations indiquant « Réf: [num. hypo] » + même banque présente → boost Quittance/Mainlevée, downrank Vente.
14. Banque TD / BMO / CIBC / Banque Nationale / Desjardins détectée + montants → boost Hypothèque.
15. Nature lue « Quittance » incertaine mais même créancier qu'une Hypothèque antérieure référencée en Radiations → snap Quittance.
16. Tokens « cession de rang », « subrogation », « renouvellement » avec banque en Partie → boost Cession/Modification d'hypothèque.
17. Investisseur institutionnel public + montants élevés + personne morale débitrice → boost Hypothèque.

**Organismes publics, municipalités, para-public**
18. Municipalité / Ville de [X] dans Parties + Remarques « aqueduc/égout/puisard » → boost Servitude.
19. Municipalité + « numérotation civique / alignement / élargissement » → boost Servitude ou Avis administratif.
20. Commission scolaire / Centre de services scolaire + Remarques « accès scolaire/passage » → boost Servitude de passage.
21. Conservation de la nature–Québec détecté + Nature incertaine → boost Servitude de conservation.
22. MTQ + « réfection, bretelle, échangeur » → boost Servitude (emprise routière).
23. Société d'État/organisme para-public + indices de réseau (électrique, gaz, télécom) → boost Servitude technique.

**Co-occurrences sémantiques**
24. Mot « serv. » / « servitude » détecté hors colonne Nature mais Parties ≈ organisme public/utilité → boost Servitude.
25. Mot « hypothèque » hors colonne Nature + présence d'une banque → boost Hypothèque.
26. Mot « quittance » hors colonne Nature + même créancier que l'hypothèque référencée → boost Quittance.
27. Mot « modification » + Servitude déjà présente dans l'historique → boost Modification de servitude.
28. Mot « plan », « article 19 », « cadastre » dans Remarques → downrank Vente/Hypothèque, upweight Dépôt/Plan/Consentement.

**Règles de désambiguïsation Parties**
29. Fuzzy « Banque Nationale » vs « Bernard Nandin » + Nature ≈ Hypothèque → snap Banque Nationale.
30. Fuzzy « Hydro-Québec » vs « Hubert-Québertin » + tokens réseau/électricité → snap Hydro-Québec.
31. Fuzzy « RBC » vs « RBO/ABC » + présence d'un montant → snap RBC.
32. Fuzzy « Min. des Transports » vs toponyme proche + présence « emprise/servitude » → snap Ministère.
33. Fuzzy « Conservation de la Nature Québec » vs patronyme proche + « conservation » dans Remarques → snap organisme.

**Règles Nature ↔ rôle/qualité**
34. Si Qualité montre « Créancier/Débiteur » → boost Hypothèque; « Cédant/Cessionnaire » avec organisme d'utilité → boost Servitude.
35. « Vendeur/Acheteur » + personne physique ↔ personne physique → boost Vente (sauf indices réseau/servitude forts).
36. « Requérant » + historique de servitude → boost Modif./Déclaration/Correction de servitude.
37. « Syndicat de copropriété » présent + mots « règlement », « déclaration » → boost Déclaration/Règlement de copropriété.

**Radiations & références**
38. Colonne Radiations contient une référence à un # d'inscription d'hypothèque → Nature = Quittance/Mainlevée.
39. Radiations vides mais Remarques « remis » / « payé » + même créancier → boost Quittance.
40. Si Radiations mentionne « Réf. [numéro] » et Nature lue « Hypothèque » sur la même ligne → vérifier si Nature correcte est Quittance.

**Règles temporelles**
41. Si Date ~ période de réno cadastrale / dépôt de plan → boost Dépôt/Plan; downrank Vente/Hypothèque.
42. Période d'intense équipement réseau + HQ → boost Servitude.

**Règles faible signal OCR**
43. Si score OCR colonne Nature < seuil et Parties = banque → fallback Nature = Hypothèque.
44. Si score OCR colonne Nature < seuil et Parties = Hydro-Québec/MTQ/CN → fallback Nature = Servitude.
45. Si Nature lue = « Mutation » générique mais Parties = banque → re-classifier en Hypothèque.
46. Si Nature lue = « Vente » mais Parties = Hydro-Québec + mots de réseau → re-classifier en Servitude.

**Corrélations Parties multiples**
47. Banque + Personne physique → Hypothèque plus probable que Vente.
48. Organisme public + Propriétaire riverain → Servitude.
49. Entreprise utilité + Compagnie de transport → Servitude inter-réseaux.

**Heuristiques de numéro d'inscription**
50. Numéro formaté + Remarques avec montant → Hypothèque > Vente (si banque présente).
51. Numéro référencé en Radiations + même créancier → Quittance/Mainlevée (fort).

**Règles alias/abréviations**
52. Alias « HQ », « Hydro-Qc », « H-Québec » → Hydro-Québec → Servitude prioritaire.
53. Alias « Min. Transp. », « MTQ » → Ministère des Transports → Servitude prioritaire.
54. Alias « RBC », « Royal Bank » → Banque Royale du Canada → Hypothèque prioritaire.

**Règles qualité de colonne**
55. Si colonne Parties très fiable et y figure banque mais colonne Nature floue → Hypothèque.
56. Si colonne Parties très fiable et y figure Hydro-Québec mais Nature floue → Servitude.

**Règles multi-indices**
57. Trio {Hydro-Québec, mots réseau, absence de montant} → Servitude (quasi-certain).
58. Trio {Banque, montant en Remarques, Rôles créancier/débiteur} → Hypothèque (quasi-certain).
59. Duo {Radiations avec réf. + même banque} → Quittance/Mainlevée (quasi-certain).

**Règles pénalités**
60. Pénaliser Vente quand Parties = organisme d'utilité/transport sans personne privée en miroir → downrank Vente, uprank Servitude.

INSTRUCTIONS FINALES :
- Applique toutes les règles de boost pertinentes
- Corrige les erreurs OCR évidentes
- Standardise les noms d'entités (Hydro-Québec, RBC, etc.)
- Présente le résultat en Markdown propre et bien structuré
- Utilise des tableaux Markdown pour les données tabulaires
- Mets en évidence les changements apportés par le boost (ex: "Nature corrigée: Servitude (était: Vente)")
- Ajoute une section "📊 Règles de Boost Appliquées" à la fin listant les règles utilisées

RÈGLE ABSOLUE - TRAITEMENT COMPLET :
Tu DOIS traiter TOUTES les lignes présentes dans le texte brut sans exception.
Ne t'arrête JAMAIS à mi-chemin. Ne demande JAMAIS de confirmation.
Continue jusqu'à ce que TOUTES les entrées soient boostées et présentées.
Ceci est un processus AUTOMATIQUE - tu ne peux PAS demander si l'utilisateur veut que tu continues.

MARQUEUR DE COMPLÉTION OBLIGATOIRE :
Tu DOIS terminer ta réponse avec EXACTEMENT cette ligne :
✅ BOOST_COMPLETE: [X] lignes traitées, [Y] corrections appliquées.

Si cette ligne n'apparaît pas, cela signifie que la réponse a été tronquée.`;


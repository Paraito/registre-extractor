/**
 * HTML Cleaner for Quebec Business Registry Data
 * Extracts structured data from raw HTML content
 */

interface RawData {
  screenshot_url?: string;
  html_content?: string;
  page_url?: string;
  captured_at?: string;
  result_number?: number;
}

interface CleanedData {
  etat_des_informations: {
    identification_entreprise: {
      adresse_domicile: Record<string, string>;
      adresse_domicile_elu: Record<string, string>;
      [key: string]: any;
    };
    immatriculation: {
      forme_juridique: Record<string, string>;
      [key: string]: any;
    };
    dates_mises_a_jour: Record<string, string>;
    date_mise_a_jour: string | null;
    faillite: Record<string, string>;
    fusion_scission_conversion: {
      _alert?: string;
      table_data: Array<Record<string, string>>;
    };
    continuation_autre_transformation: Record<string, string>;
    liquidation_dissolution: Record<string, string>;
    activite_economique: Record<string, string>;
  };
  etablissements: Array<Record<string, string>>;
  index_documents: Array<Record<string, string>>;
  index_noms: {
    date: Array<Record<string, string>>;
    nom: Array<Record<string, string>>;
    autre_noms: Array<Record<string, string>>;
  };
}

/**
 * Decode HTML entities
 */
function decodeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Extract all matches for a pattern from HTML
 */
function extractAll(html: string, pattern: string): string[] {
  if (!html || typeof html !== 'string') return [];
  const matches: string[] = [];
  const regex = new RegExp(pattern, 'g');
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

/**
 * Extract section data by h4 title
 */
function extractSectionByTitle(htmlContent: string, title: string): Record<string, string> {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionRegex = new RegExp(
    `<h4>${escapedTitle}</h4>([\\s\\S]*?)(?=<h4>|<h2|<div class="form-group clearfix">|$)`,
    'i'
  );
  const sectionMatch = htmlContent.match(sectionRegex);

  if (!sectionMatch) return {};

  const sectionContent = sectionMatch[1];
  const sectionLabels = extractAll(sectionContent, '<span class="kx-display-label">([^<]+)</span>');
  const sectionFields = extractAll(sectionContent, '<span class="kx-display-field">([^<]*)</span>');

  const sectionData: Record<string, string> = {};
  for (let i = 0; i < Math.min(sectionLabels.length, sectionFields.length); i++) {
    sectionData[decodeHtml(sectionLabels[i])] = decodeHtml(sectionFields[i]);
  }

  // Check for alert messages
  const alertMatch = sectionContent.match(/<div class="kx-alert-text">([^<]+)<\/div>/);
  if (alertMatch) {
    sectionData._alert = alertMatch[1].trim();
  }

  return sectionData;
}

/**
 * Extract table data from a section (works for both H2 and H4)
 * Returns an object with alert message and table data
 *
 * Note: For sections like "Fusion, scission et conversion" that appear twice
 * (once with alert, once with table), this captures ALL content until the next
 * different h2/h4 tag.
 */
function extractTableFromSection(htmlContent: string, title: string, headerTag: 'h2' | 'h4' = 'h4'): {
  _alert?: string;
  table_data: Array<Record<string, string>>;
} {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find the FIRST occurrence of this header
  const firstHeaderRegex = new RegExp(
    `<${headerTag}[^>]*>${escapedTitle}</${headerTag}>`,
    'i'
  );
  const firstHeaderMatch = htmlContent.match(firstHeaderRegex);

  if (!firstHeaderMatch) {
    return { table_data: [] };
  }

  const startIndex = firstHeaderMatch.index! + firstHeaderMatch[0].length;

  // Find the next DIFFERENT h2 or h4 tag (not the same title)
  const remainingContent = htmlContent.substring(startIndex);
  const nextDifferentHeaderRegex = new RegExp(
    `<h[24][^>]*>(?!${escapedTitle}<)`,
    'i'
  );
  const nextHeaderMatch = remainingContent.match(nextDifferentHeaderRegex);

  let sectionContent: string;
  if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
    sectionContent = remainingContent.substring(0, nextHeaderMatch.index);
  } else {
    // Check for form-group clearfix or end of content
    const formGroupMatch = remainingContent.match(/<div class="form-group clearfix">/);
    if (formGroupMatch && formGroupMatch.index !== undefined) {
      sectionContent = remainingContent.substring(0, formGroupMatch.index);
    } else {
      sectionContent = remainingContent;
    }
  }

  const result: { _alert?: string; table_data: Array<Record<string, string>> } = {
    table_data: []
  };

  // Check for alert messages
  const alertMatch = sectionContent.match(/<div class="kx-alert-text">([^<]+)<\/div>/);
  if (alertMatch) {
    result._alert = alertMatch[1].trim();
  }

  // Look for tables in this section
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tablePattern.exec(sectionContent)) !== null) {
    const tableContent = tableMatch[1];

    // Extract headers from <thead>
    const theadMatch = tableContent.match(/<thead>([\s\S]*?)<\/thead>/i);
    const headers: string[] = [];

    if (theadMatch) {
      const headerPattern = /<th[^>]*>([\s\S]*?)<\/th>/gi;
      let headerMatch;
      while ((headerMatch = headerPattern.exec(theadMatch[1])) !== null) {
        // Remove any inner HTML tags and get text content
        const headerText = headerMatch[1].replace(/<[^>]+>/g, '').trim();
        headers.push(decodeHtml(headerText));
      }
    }

    // Extract rows from <tbody>
    const tbodyMatch = tableContent.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (tbodyMatch && headers.length > 0) {
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;

      while ((rowMatch = rowPattern.exec(tbodyMatch[1])) !== null) {
        const rowContent = rowMatch[1];
        const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells: string[] = [];
        let cellMatch;

        while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
          // Remove inner HTML tags and get text content
          const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim();
          cells.push(decodeHtml(cellText));
        }

        // Create object mapping headers to cells
        if (cells.length > 0) {
          const rowData: Record<string, string> = {};
          for (let i = 0; i < Math.min(headers.length, cells.length); i++) {
            if (headers[i]) {
              rowData[headers[i]] = cells[i];
            }
          }
          result.table_data.push(rowData);
        }
      }
    }
  }

  return result;
}

/**
 * Extract table data from an H2 section (like "Index des documents")
 * Returns an array of objects, one per table row
 */
function extractTableFromH2Section(htmlContent: string, title: string): Array<Record<string, string>> {
  return extractTableFromSection(htmlContent, title, 'h2').table_data;
}

/**
 * Clean and structure raw HTML data from Quebec Business Registry
 */
export function cleanRegistreData(rawData: RawData): CleanedData {
  const htmlContent = rawData.html_content || '';

  if (!htmlContent || typeof htmlContent !== 'string') {
    throw new Error('No HTML content found in raw data');
  }

  // Extract date from "Renseignements en date du..."
  const dateMatch = htmlContent.match(/Renseignements en date du ([^<]+)/);
  const dateMiseAJour = dateMatch ? decodeHtml(dateMatch[1]) : null;

  // Extract sections
  const identificationEntreprise = extractSectionByTitle(htmlContent, "Identification de l'entreprise");
  const adresseDomicile = extractSectionByTitle(htmlContent, "Adresse du domicile");
  const adresseDomicileElu = extractSectionByTitle(htmlContent, "Adresse du domicile élu");
  const immatriculation = extractSectionByTitle(htmlContent, "Immatriculation");
  const formeJuridique = extractSectionByTitle(htmlContent, "Forme juridique");

  // Build result with nested schema
  const result: CleanedData = {
    etat_des_informations: {
      identification_entreprise: {
        ...identificationEntreprise,
        adresse_domicile: adresseDomicile,
        adresse_domicile_elu: adresseDomicileElu,
      },
      immatriculation: {
        ...immatriculation,
        forme_juridique: formeJuridique,
      },
      dates_mises_a_jour: extractSectionByTitle(htmlContent, "Dates des mises à jour"),
      date_mise_a_jour: dateMiseAJour,
      faillite: extractSectionByTitle(htmlContent, "Faillite"),
      fusion_scission_conversion: extractTableFromSection(htmlContent, "Fusion, scission et conversion", 'h4'),
      continuation_autre_transformation: extractSectionByTitle(htmlContent, "Continuation et autre transformation"),
      liquidation_dissolution: extractSectionByTitle(htmlContent, "Liquidation ou dissolution"),
      activite_economique: extractSectionByTitle(htmlContent, "Activité économique"),
    },
    etablissements: [],
    index_documents: [],
    index_noms: {
      date: [],
      nom: [],
      autre_noms: [],
    },
  };

  // Extract establishments - Look for h2 or h4
  const establishmentsSection = htmlContent.match(
    /<h[24][^>]*>Établissements<\/h[24]>([\s\S]*?)(?=<h[24]|$)/i
  );

  if (establishmentsSection) {
    const sectionContent = establishmentsSection[1];
    const ulPattern = /<ul class="kx-synthese">([\s\S]*?)<\/ul>/g;
    let ulMatch;

    while ((ulMatch = ulPattern.exec(sectionContent)) !== null) {
      const block = ulMatch[1];
      const blockLabels = extractAll(block, '<span class="kx-display-label">([^<]+)</span>');
      const blockFields = extractAll(block, '<span class="kx-display-field">([^<]*)</span>');

      if (blockLabels.length > 0) {
        const establishment: Record<string, string> = {};
        for (let i = 0; i < Math.min(blockLabels.length, blockFields.length); i++) {
          establishment[decodeHtml(blockLabels[i])] = decodeHtml(blockFields[i]);
        }
        result.etablissements.push(establishment);
      }
    }
  }

  // Extract index_documents section - this is an H2 section with tables
  result.index_documents = extractTableFromH2Section(htmlContent, "Index des documents");

  // Extract index_noms - Look in "Index des noms" section
  const namesSection = htmlContent.match(
    /<h2[^>]*>Index des noms<\/h2>([\s\S]*?)(?=<h2|$)/i
  );

  if (namesSection) {
    const sectionContent = namesSection[1];
    const ulPattern = /<ul class="kx-synthese">([\s\S]*?)<\/ul>/g;
    let ulMatch;

    while ((ulMatch = ulPattern.exec(sectionContent)) !== null) {
      const block = ulMatch[1];
      const blockLabels = extractAll(block, '<span class="kx-display-label">([^<]+)</span>');
      const blockFields = extractAll(block, '<span class="kx-display-field">([^<]*)</span>');

      if (blockLabels.length > 0) {
        const nameData: Record<string, string> = {};
        for (let i = 0; i < Math.min(blockLabels.length, blockFields.length); i++) {
          nameData[decodeHtml(blockLabels[i])] = decodeHtml(blockFields[i]);
        }

        // Categorize by type
        if (nameData["Nom"]) {
          // This is a regular name entry
          result.index_noms.nom.push(nameData);
        } else if (nameData["Autre nom"]) {
          // This is an "autre nom" entry
          result.index_noms.autre_noms.push(nameData);
        }

        // Also add to date array if it has date information
        if (nameData["Date de déclaration du nom"] || nameData["Date de déclaration du retrait du nom"]) {
          result.index_noms.date.push(nameData);
        }
      }
    }
  }

  return result;
}

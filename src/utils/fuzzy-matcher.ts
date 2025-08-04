import { logger } from './logger';

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // deletion
          dp[i][j - 1] + 1,    // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Normalize string for comparison (remove accents, lowercase, trim)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s]/g, ' ')        // Replace special chars with space
    .replace(/\s+/g, ' ')            // Normalize spaces
    .trim();
}

/**
 * Find the best matching option from a list
 */
export function findBestMatch(target: string, options: string[]): { match: string; score: number; index: number } | null {
  if (!options.length) return null;

  const normalizedTarget = normalizeString(target);
  logger.debug({ target, normalizedTarget }, 'Finding best match for target');

  let bestMatch = '';
  let bestScore = Infinity;
  let bestIndex = -1;

  options.forEach((option, index) => {
    const normalizedOption = normalizeString(option);
    
    // Check for exact match first
    if (normalizedOption === normalizedTarget) {
      bestMatch = option;
      bestScore = 0;
      bestIndex = index;
      return;
    }

    // Check if one contains the other
    if (normalizedOption.includes(normalizedTarget) || normalizedTarget.includes(normalizedOption)) {
      const score = Math.abs(normalizedOption.length - normalizedTarget.length);
      if (score < bestScore) {
        bestMatch = option;
        bestScore = score;
        bestIndex = index;
      }
      return;
    }

    // Calculate Levenshtein distance
    const distance = levenshteinDistance(normalizedTarget, normalizedOption);
    const maxLength = Math.max(normalizedTarget.length, normalizedOption.length);
    const similarity = 1 - (distance / maxLength);

    // Only consider matches with > 60% similarity
    if (similarity > 0.6 && distance < bestScore) {
      bestMatch = option;
      bestScore = distance;
      bestIndex = index;
    }
  });

  if (bestIndex === -1) {
    logger.warn({ target, options: options.slice(0, 5) }, 'No suitable match found');
    return null;
  }

  logger.info({ 
    target, 
    bestMatch, 
    score: bestScore,
    similarity: bestScore === 0 ? 1 : 1 - (bestScore / Math.max(target.length, bestMatch.length))
  }, 'Found best match');

  return { match: bestMatch, score: bestScore, index: bestIndex };
}

/**
 * Get option value by text from select element options
 */
export interface SelectOption {
  text: string;
  value: string;
  index: number;
}

/**
 * Extract options from a select element
 */
export async function extractSelectOptions(selectElement: any): Promise<SelectOption[]> {
  try {
    const options = await selectElement.evaluate((el: any) => {
      return Array.from(el.options).map((option: any, index: number) => ({
        text: option.text.trim(),
        value: option.value,
        index
      }));
    });
    
    return options;
  } catch (error) {
    logger.error({ error }, 'Failed to extract select options');
    return [];
  }
}

/**
 * Find best matching option in a select element
 */
export async function findBestSelectOption(
  selectElement: any, 
  targetText: string
): Promise<{ text: string; value: string } | null> {
  const options = await extractSelectOptions(selectElement);
  const optionTexts = options.map(opt => opt.text);
  
  const bestMatch = findBestMatch(targetText, optionTexts);
  if (!bestMatch) return null;

  const matchedOption = options[bestMatch.index];
  return { text: matchedOption.text, value: matchedOption.value };
}
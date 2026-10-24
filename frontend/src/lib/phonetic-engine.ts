/**
 * Indonesian Phonetic Engine - Simplified Double Metaphone for Bahasa Indonesia
 *
 * Per user request (2026-09-14): implement phonetic matching layer buat
 * catch sound-alike words yang belum ada di dataset.
 *
 * Algorithm (simplified Double Metaphone adapted for Indonesian):
 *   1. Uppercase + remove non-alphabetic chars
 *   2. C → K (ce -> ke, se -> ke)
 *   3. SH → S (she -> se)
 *   4. Z → S (zet -> set)
 *   5. V → F (ve -> fe) - Indonesian V is often pronounced as F
 *   6. X → KS (eks -> kes)
 *   7. Q → K (ki -> ke)
 *   8. PH → F (photo -> foto)
 *   9. EE → I (bebe -> bibi-like)
 *  10. Remove duplicate consecutive letters (BULLISH -> BULIS)
 *
 * Examples:
 *   getPhoneticCode('bulis')     → 'BULIS'
 *   getPhoneticCode('bullish')   → 'BULIS'    (same code → match!)
 *   getPhoneticCode('buleish')   → 'BULEIS'   (close but different)
 *   getPhoneticCode('bearish')   → 'BERIS'
 *   getPhoneticCode('beris')     → 'BERIS'    (same code → match!)
 */

/**
 * Get phonetic code for a word - Indonesian Double Metaphone simplified.
 *
 * Refinements (2026-09-14):
 *   - EA → E (breakout → brekaut → brekaut; bearish → berish)
 *   - Drop vowels between consonants when followed by similar pattern
 *     (reduces kandelistik vs candlestick mismatch)
 *   - AI → A (average → averag)
 *   - OU → U (breakout → brekut)
 */
export function getPhoneticCode(word: string): string {
  let code = word
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .replace(/PH/g, 'F')
    .replace(/SH/g, 'S')
    .replace(/CK/g, 'K')
    .replace(/C/g, 'K')
    .replace(/Z/g, 'S')
    .replace(/V/g, 'F')
    .replace(/Q/g, 'K')
    .replace(/X/g, 'KS')
    .replace(/EA/g, 'E')
    .replace(/AI/g, 'E')
    .replace(/OU/g, 'U')
    .replace(/EE/g, 'I')
    .replace(/([A-Z])\1+/g, '$1');
  return code;
}

const TARGET_DICTIONARY: string[] = [
  // Stock market terms (English-based, common in Indonesian trading)
  'BULLISH', 'BEARISH', 'CANDLESTICK', 'BREAKOUT', 'SIDEWAYS',
  'SUPPORT', 'RESISTANCE', 'SCALPING', 'ORDERBOOK', 'AVERAGE',
  'DIVIDEN', 'SAHAM', 'EMITEN', 'IPO', 'BROKER', 'PORTFOLIO',
  'KAPITALISASI', 'LIQUIDITY', 'VOLATILE', 'TREND', 'UPTREND',
  'DOWNTREND', 'RALLY', 'CORRECTION', 'REBOUND', 'PULLBACK',
  'TARGET', 'STOPLOSS', 'CUTLOSS', 'TAKEPROFIT',
  'LONG', 'SHORT', 'HOLD', 'BUY', 'SELL',
  'MARGIN', 'LEVERAGE', 'LOT', 'VOLUME', 'BID', 'ASK', 'SPREAD',
  'MARKET', 'LIMIT', 'ORDER', 'TRADE', 'TRADER', 'INVESTOR',
  'DEALER', 'EXCHANGE', 'INDEX', 'SECTOR', 'STOCK',
  'BLUECHIP', 'PENNYSTOCK', 'GROWTHSTOCK', 'VALUESTOCK',
  'CAPITALGAIN', 'DIVIDENDYIELD', 'PERATIO', 'EPS',
  'MARKETCAP', 'FLOAT', 'OUTSTANDING', 'TREASURY',
  // Indonesian financial terms
  'CUAN', 'RUGI', 'UNTUNG', 'BELI', 'JUAL', 'TAHAN',
  'MODAL', 'DANA', 'INVESTASI', 'PROSPEK', 'ANALISA', 'ANALISIS',
  'PREDIKSI', 'EVALUASI', 'STRATEGI', 'PERIODE', 'TREN',
  'BULL', 'BEAR', 'PUMP', 'DUMP',
  // Indonesian stock-specific terms
  'IHSG', 'BEI', 'IDX', 'SSR', 'AUTOREJECT',
  'WARANT', 'OBLIGASI',
  // Technical analysis terms
  'MACD', 'RSI', 'STOCHASTIC', 'BOLLINGER', 'MOVINGAVERAGE',
  'EMA', 'SMA', 'WMA',
  'FIBONACCI', 'PIVOT', 'ELLIOTTWAVE', 'HARMONIC',
  'OVERBOUGHT', 'OVERSOLD', 'DIVERGENCE', 'CONVERGENCE',
  'GOLDENCROSS', 'DEATHCROSS', 'CROSSOVER',
  'DOUBLETOP', 'DOUBLEBOTTOM', 'HEADSHOULDERS',
  'TRIANGLE', 'WEDGE', 'FLAG', 'PENNANT',
  // Indonesian educational terms (Fisika/Kimia/Matematika)
  'FOTOSINTESIS', 'KLOROPLAS', 'KLOROFIL', 'PARABOLA', 'PERCEPATAN',
  'KECEPATAN', 'MOMENTUM', 'GAYA', 'JOULE', 'WATT', 'VOLT', 'AMPERE',
  'FREKUENSI', 'AMPLITUDE', 'REFRAKSI', 'REFLEKSI', 'DIFRAKSI',
  'MOLEKUL', 'ATOM', 'ION', 'ELEKTRON', 'PROTON', 'NEUTRON', 'ISOTOP',
  'SENYAWA', 'LARUTAN', 'ASAM', 'BASA', 'MOL', 'MOLARITAS',
  'OKSIDASI', 'REDUKSI', 'ELEKTROLISIS', 'HIDROGEN', 'OKSIGEN',
  'ENZIM', 'PROTEIN', 'KARBOHIDRAT', 'LIPID',
  'TRIGONOMETRI', 'SINUS', 'KOSINUS', 'TANGEN', 'HIPOTENUSA',
  'INTEGRAL', 'DIFERENSIAL', 'LIMIT', 'TURUNAN', 'FUNGSI',
  'PERSAMAAN', 'MATRIKS', 'DETERMINAN', 'VEKTOR', 'SKALAR',
  'PYTHAGORAS', 'ALJABAR', 'GEOMETRI',
  // Common verbs/adjectives used in stock analysis
  'NAIK', 'TURUN', 'STAGNAN', 'FLUKTUASI', 'KOREKSI',
  'PEMECAHAN', 'AKUMULASI', 'DISTRIBUSI',
];

/**
 * Generate ALL possible phonetic codes for a word (handles vowel epenthesis).
 * Returns primary code + alternate code with vowels removed from consonant clusters.
 *
 * Example: 'kandelistik' → ['KANDELISTIK', 'KNDLSTIK']
 *          'CANDLESTICK' → ['KANDLESTIK']  (target)
 *          Match found via alternate code 'KNDLSTIK'!
 */
export function getPhoneticCodes(word: string): string[] {
  const primary = getPhoneticCode(word);
  // Generate alternate: remove vowels between consonant pairs
  // This handles Indonesian vowel epenthesis (inserting vowels between consonants)
  const alternate = primary
    .replace(/([BCDFGHJKLMNPRSTWY])[AEIOU]([BCDFGHJKLMNPRSTWY])/g, '$1$2')
    // Apply twice for cases like KANDELISTIK → KNDLSTIK → KNDLSTK
    .replace(/([BCDFGHJKLMNPRSTWY])[AEIOU]([BCDFGHJKLMNPRSTWY])/g, '$1$2');
  const codes = [primary];
  if (alternate !== primary) codes.push(alternate);
  return codes;
}

const PHONETIC_LOOKUP: Record<string, string> = {};
const PHONETIC_LOOKUP_ALTERNATE: Record<string, string> = {};
for (const term of TARGET_DICTIONARY) {
  const codes = getPhoneticCodes(term);
  // Primary code → canonical (high confidence)
  PHONETIC_LOOKUP[codes[0]] = term;
  // Alternate codes → canonical (lower confidence, for epenthesis cases)
  for (let i = 1; i < codes.length; i++) {
    if (!PHONETIC_LOOKUP_ALTERNATE[codes[i]]) {
      PHONETIC_LOOKUP_ALTERNATE[codes[i]] = term;
    }
  }
}

export function phoneticMatch(word: string): string | null {
  if (!word || word.length < 3) return null;
  const codes = getPhoneticCodes(word);
  // Check primary code first (high confidence)
  if (PHONETIC_LOOKUP[codes[0]]) return PHONETIC_LOOKUP[codes[0]];
  // Check alternate codes (for vowel epenthesis cases like kandelistik → CANDLESTICK)
  for (let i = 1; i < codes.length; i++) {
    if (PHONETIC_LOOKUP_ALTERNATE[codes[i]]) return PHONETIC_LOOKUP_ALTERNATE[codes[i]];
    if (PHONETIC_LOOKUP[codes[i]]) return PHONETIC_LOOKUP[codes[i]];
  }
  return null;
}

export function getTargetDictionary(): string[] {
  return [...TARGET_DICTIONARY];
}

export function getPhoneticLookupSize(): number {
  return Object.keys(PHONETIC_LOOKUP).length;
}

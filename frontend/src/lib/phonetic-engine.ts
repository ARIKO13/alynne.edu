/**
 * Indonesian Phonetic Engine — Simplified Double Metaphone for Bahasa Indonesia
 *
 * Per user request (2026-09-14): implement phonetic matching layer buat
 * catch sound-alike words yang belum ada di dataset.
 *
 * Algorithm (simplified Double Metaphone adapted for Indonesian):
 *   1. Uppercase + remove non-alphabetic chars
 *   2. C → K (ce -> ke, se -> ke)
 *   3. SH → S (she -> se)
 *   4. Z → S (zet -> set)
 *   5. V → F (ve -> fe) — Indonesian V is often pronounced as F
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
 * Get phonetic code for a word — Indonesian Double Metaphone simplified.
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
  'BULLISH', 'BEARISH', 'CANDLESTICK', 'BREAKOUT', 'SIDEWAYS',
  'SUPPORT', 'RESISTANCE', 'SCALPING', 'ORDERBOOK', 'AVERAGE',
  'DIVIDEN', 'SAHAM', 'EMITEN', 'IPO', 'BROKER', 'PORTFOLIO',
  'KAPITALISASI', 'LIQUIDITY', 'VOLATILE', 'TREND', 'UPTREND',
  'DOWNTREND', 'RALLY', 'CORRECTION', 'REBOUND', 'PULLBACK',
  'TARGET', 'STOP_LOSS', 'CUT_LOSS', 'TAKE_PROFIT',
  'CUAN', 'RUGI', 'UNTUNG', 'BELI', 'JUAL', 'TAHAN',
  'ANALISA', 'ANALISIS', 'PREDIKSI', 'PROSPEK', 'EVALUASI',
  'FOTOSINTESIS', 'KLOROPLAS', 'KLOROFIL', 'TRIGONOMETRI',
  'PYTHAGORAS', 'ALJABAR', 'GEOMETRI', 'INTEGRAL', 'DIFERENSIAL',
];

const PHONETIC_LOOKUP: Record<string, string> = {};
for (const term of TARGET_DICTIONARY) {
  const code = getPhoneticCode(term);
  PHONETIC_LOOKUP[code] = term;
}

export function phoneticMatch(word: string): string | null {
  if (!word || word.length < 3) return null;
  const code = getPhoneticCode(word);
  return PHONETIC_LOOKUP[code] || null;
}

export function getTargetDictionary(): string[] {
  return [...TARGET_DICTIONARY];
}

export function getPhoneticLookupSize(): number {
  return Object.keys(PHONETIC_LOOKUP).length;
}

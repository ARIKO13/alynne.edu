/**
 * Pemenggalan suku kata Bahasa Indonesia — porting dari Python.
 *
 * Algoritma PUEBI-based dengan handling kata serapan (loanwords).
 *
 * Aturan:
 *   - Setiap suku kata punya 1 vokal (a, i, u, e, o) atau diftong (ai, au, ei, oi)
 *   - Konsonan sebelum vokal → onset suku tersebut
 *   - 1 konsonan antara 2 vokal → onset suku berikutnya (CV-CV: la-ju)
 *   - 2 konsonan antara 2 vokal:
 *       - Digraph (kh, ng, ny, sy) → keduanya onset suku berikutnya
 *       - Loanword onset (pr, tr, kr, br, dr, gr, fr, pl, kl, bl, gl, fl) → keduanya onset
 *       - Lainnya → konsonan pertama coda, kedua onset (CVC-CV: jam-bah)
 *   - 3+ konsonan antara 2 vokal:
 *       - 3 terakhir 'str'/'skr'/'spr' → 3 sebagai onset, sisanya coda
 *       - 2 terakhir digraph/loanword onset → 2 sebagai onset, sisanya coda
 *       - Default → 1 pertama coda, sisanya onset
 *
 * Contoh:
 *   syllabifyWord('mengajar')     → 'me-nga-jar'
 *   syllabifyWord('belajar')      → 'be-la-jar'
 *   syllabifyWord('autobiografi') → 'au-to-bi-o-gra-fi'
 *   syllabifyWord('konstruksi')   → 'kon-struk-si'
 *   syllabifyWord('struktur')     → 'struk-tur'
 */

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);
const DIGRAPHS = new Set(['kh', 'ng', 'ny', 'sy']);
const DIPHTHONGS = new Set(['ai', 'au', 'ei', 'oi']);

// 2-letter loanword onset clusters valid intervocalic (stop + liquid/lateral)
const LOANWORD_ONSETS_2 = new Set([
  'pr', 'tr', 'kr', 'br', 'dr', 'gr', 'fr',
  'pl', 'tl', 'kl', 'bl', 'gl', 'fl',
]);

// 3-letter loanword onset clusters (sibilant + stop + liquid)
const LOANWORD_ONSETS_3 = new Set(['str', 'skr', 'spr']);

type Unit = { type: 'v' | 'c'; value: string };

function tokenize(word: string): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  while (i < word.length) {
    // Check digraph first
    if (i + 1 < word.length && DIGRAPHS.has(word.slice(i, i + 2))) {
      units.push({ type: 'c', value: word.slice(i, i + 2) });
      i += 2;
      continue;
    }
    const ch = word[i];
    if (VOWELS.has(ch)) {
      // Diphthong check (only if followed by non-vowel or end)
      if (i + 1 < word.length && DIPHTHONGS.has(word.slice(i, i + 2))) {
        const next = word[i + 2];
        if (i + 2 >= word.length || !VOWELS.has(next)) {
          units.push({ type: 'v', value: word.slice(i, i + 2) });
          i += 2;
          continue;
        }
      }
      units.push({ type: 'v', value: ch });
      i += 1;
      continue;
    }
    // Consonant
    units.push({ type: 'c', value: ch });
    i += 1;
  }
  return units;
}

/**
 * Pemenggalan suku kata untuk 1 kata.
 * Returns: 'me-nga-jar' (suku dipisah hyphen), atau '' kalau input kosong.
 */
export function syllabifyWord(word: string): string {
  if (!word) return '';
  let w = word.toLowerCase().trim();
  // Keep only letters and internal hyphens/spaces
  w = w.replace(/[^a-z\-\s]/g, '');
  if (!w) return '';

  // Handle multi-word / already-hyphenated
  if (/[\-\s]/.test(w)) {
    const parts = w.split(/[\-\s]+/).filter(p => p.length > 0);
    return parts.map(p => syllabifyWord(p)).filter(s => s).join('-');
  }

  const units = tokenize(w);
  if (units.length === 0) return w;

  const syllables: string[] = [];
  let i = 0;
  const n = units.length;

  while (i < n) {
    // Collect onset (consonants before vowel)
    const onset: string[] = [];
    while (i < n && units[i].type === 'c') {
      onset.push(units[i].value);
      i += 1;
    }
    // Now should be at vowel (or end)
    if (i >= n) {
      // Trailing consonants — attach to last syllable
      if (syllables.length > 0) {
        syllables[syllables.length - 1] += onset.join('');
      } else if (onset.length > 0) {
        syllables.push(onset.join(''));
      }
      break;
    }
    // Collect nucleus
    const nucleus = units[i].value;
    i += 1;
    // Peek ahead: count consonants before next vowel
    const consAhead: string[] = [];
    let j = i;
    while (j < n && units[j].type === 'c') {
      consAhead.push(units[j].value);
      j += 1;
    }
    const coda: string[] = [];
    if (j >= n) {
      // No more vowels — all remaining consonants are coda
      coda.push(...consAhead);
      i = j;
    } else {
      const numCons = consAhead.length;
      if (numCons === 0) {
        // Next is vowel, no coda
      } else if (numCons === 1) {
        // 1 consonant → onset of next syllable
      } else if (numCons === 2) {
        const pair = consAhead.join('');
        if (DIGRAPHS.has(pair) || LOANWORD_ONSETS_2.has(pair)) {
          // Both → next onset
        } else {
          // First coda, second next onset
          coda.push(consAhead[0]);
          i += 1;
        }
      } else {
        // 3+ consonants
        const last3 = consAhead.slice(-3).join('');
        const last2 = consAhead.slice(-2).join('');
        if (LOANWORD_ONSETS_3.has(last3)) {
          // Last 3 → next onset, rest coda
          const codaCount = numCons - 3;
          for (let k = 0; k < codaCount; k++) coda.push(consAhead[k]);
          i += codaCount;
        } else if (DIGRAPHS.has(last2) || LOANWORD_ONSETS_2.has(last2)) {
          // Last 2 → next onset, rest coda
          const codaCount = numCons - 2;
          for (let k = 0; k < codaCount; k++) coda.push(consAhead[k]);
          i += codaCount;
        } else {
          // First coda, rest next onset
          coda.push(consAhead[0]);
          i += 1;
        }
      }
    }
    const syllable = onset.join('') + nucleus + coda.join('');
    syllables.push(syllable);
  }

  return syllables.length > 0 ? syllables.join('-') : w;
}

/**
 * Hitung similarity 2 kata berdasarkan suku kata.
 * Returns: 0.0 - 1.0 (1.0 = identical syllables)
 *
 * Algorithm:
 *   - Split each word into syllables
 *   - Compute syllable-level Levenshtein distance
 *   - Normalize: similarity = 1 - (distance / max_syllables)
 */
export function syllableSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sylA = syllabifyWord(a).split('-').filter(s => s);
  const sylB = syllabifyWord(b).split('-').filter(s => s);
  if (sylA.length === 0 || sylB.length === 0) return 0;
  const dist = syllableLevenshtein(sylA, sylB);
  const maxLen = Math.max(sylA.length, sylB.length);
  return Math.max(0, 1 - dist / maxLen);
}

function syllableLevenshtein(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // dp[i][j] = edit distance between a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // deletion
        dp[i][j - 1] + 1,        // insertion
        dp[i - 1][j - 1] + cost  // substitution
      );
    }
  }
  return dp[m][n];
}

/**
 * Get array of syllables from a word.
 * Useful for fuzzy matching: "produksi" → ['pro', 'duk', 'si']
 */
export function getSyllables(word: string): string[] {
  return syllabifyWord(word).split('-').filter(s => s.length > 0);
}

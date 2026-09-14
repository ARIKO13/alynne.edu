/**
 * STT Auto-Correction Dictionary v3 — with Fuzzy Matching
 *
 * Hybrid approach (extends v2 with Levenshtein fuzzy matching):
 *   1. Local dictionary correction (KBBI 192K + English 125K + slang)
 *   2. Context-based homophone fix (kekerasan->kecerdasan in tech context)
 *   3. Direct phrase map ("go to" -> "GOTO", "be ca a" -> "BBCA")
 *   4. NEW: Fuzzy matching via Levenshtein Distance for typo correction
 *   5. Only fall back to LLM if too many unknown words remain
 *
 * 3 optimizations per user request (2026-09-14):
 *   a. Set for O(1) valid word lookup (already in v2)
 *   b. Length-indexed Map (word length -> Set of words of that length)
 *      -> only compare words within ±2 chars when running Levenshtein
 *   c. Cache repeated words (Map of word -> correction) to avoid recomputing
 *
 * Applied to combined STT methods:
 *   - Web Speech API output -> localCorrect -> final text (via /api/stt/enhance)
 *   - OCR output -> localCorrect -> final text (via /api/stt/fuzzy-correct)
 *   - CV tags -> no correction needed (deterministic)
 *   - Web Audio API -> produces audio levels, not text (no correction needed)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Dictionary Data (lazy-loaded once) ──
let _kbbi: Set<string> | null = null;
let _enWords: Set<string> | null = null;
let _indoSlang: Record<string, { f: string; m: string }> | null = null;
let _enSlang: Record<string, string> | null = null;
let _fixes: Record<string, string> | null = null;
let _remove: Set<string> | null = null;
let _loaded = false;

// ── NEW: Length-indexed Map for fast Levenshtein ──
let _lengthIndex: Map<number, Set<string>> | null = null;

// ── NEW: Cache for repeated words (avoids recomputing fuzzy match) ──
const _fuzzyCache: Map<string, { corrected: string; distance: number } | null> = new Map();
const FUZZY_CACHE_MAX = 5000; // limit memory

function loadDict() {
  if (_loaded) return;
  _loaded = true;
  try {
    const candidates = [
      join(process.cwd(), 'data', 'stt-dictionary.json'),
      join(process.cwd(), 'src', 'lib', 'data', 'stt-dictionary.json'),
      '/root/lina-learning/data/stt-dictionary.json',
      join(process.cwd(), 'public', 'data', 'stt-dictionary.json'),
    ];

    let dictPath = '';
    for (const p of candidates) {
      if (existsSync(p)) { dictPath = p; break; }
    }

    if (!dictPath) {
      console.warn('[STT-Dict] File not found, using fallback only');
      return;
    }

    const raw = readFileSync(dictPath, 'utf-8');
    const dict = JSON.parse(raw);

    _kbbi = new Set(dict.k.split('|'));
    _enWords = new Set(dict.e.split('|'));
    _indoSlang = dict.sid || {};
    _enSlang = dict.sen || {};
    _fixes = dict.fix || {};
    _remove = new Set(dict.rem || []);
    // Load phrase_map from JSON if present (overrides hardcoded fallback)
    if (dict.phrase_map && typeof dict.phrase_map === 'object') {
      _phraseMap = dict.phrase_map;
    }

    console.log(`[STT-Dict] Loaded: KBBI=${_kbbi.size}, EN=${_enWords.size}, slang_id=${Object.keys(_indoSlang).length}, slang_en=${Object.keys(_enSlang).length}, fixes=${Object.keys(_fixes).length}, phrase_map=${_phraseMap ? Object.keys(_phraseMap).length : 0}`);
  } catch (err) {
    console.error('[STT-Dict] Load failed:', err);
  }

  // Load phonetic-map.json (comprehensive stock ticker + company name + action phrase maps)
  try {
    const phoneticCandidates = [
      join(process.cwd(), 'backend', 'data', 'phonetic-map.json'),
      '/root/lina-learning/backend/data/phonetic-map.json',
      join(process.cwd(), 'phonetic-map.json'),
    ];
    let phoneticPath = '';
    for (const p of phoneticCandidates) {
      if (existsSync(p)) { phoneticPath = p; break; }
    }
    if (phoneticPath) {
      const raw2 = readFileSync(phoneticPath, 'utf-8');
      const ph = JSON.parse(raw2);
      _phoneticTickers = ph.phonetic_tickers || {};
      _companyNames = ph.company_names || {};
      _actionPhrases = ph.action_phrases || {};
      // Invalidate cached _phraseMap so getPhraseMap() rebuilds with merged data
      _phraseMap = null;
      console.log(`[STT-Dict] Phonetic map loaded: tickers=${Object.keys(_phoneticTickers).length}, companies=${Object.keys(_companyNames).length}, actions=${Object.keys(_actionPhrases).length}`);
    } else {
      console.warn('[STT-Dict] phonetic-map.json not found — using hardcoded fallback only');
    }
  } catch (err) {
    console.error('[STT-Dict] Phonetic map load failed:', err);
  }
}

// ── Fallback hardcoded (when dict file missing) ──
const fbSlang: Record<string, string> = {
  'nggak': 'tidak', 'ngga': 'tidak', 'gak': 'tidak', 'ga': 'tidak',
  'ndak': 'tidak', 'kagak': 'tidak',
  'dah': 'sudah', 'udah': 'sudah', 'gitu': 'begitu',
  'kalo': 'kalau', 'klo': 'kalau',
  'gimana': 'bagaimana', 'gmn': 'bagaimana',
  'bener': 'benar', 'bgt': 'sangat',
  'ngomong': 'berbicara', 'bikin': 'membuat',
  'ngerti': 'mengerti', 'mulu': 'terus', 'doang': 'saja',
  'bilang': 'mengatakan', 'tau': 'tahu',
  'pengen': 'ingin', 'mo': 'mau', 'bakal': 'akan',
  'gemana': 'bagaimana', 'nggmana': 'bagaimana',
  'niyang': 'yang', 'iyang': 'yang', 'nyang': 'yang',
  'neng': 'dengan', 'deng': 'dengan',
  'beneran': 'benar-benar', 'nonton': 'menonton',
  'dateng': 'datang', 'napa': 'kenapa', 'yah': 'ya',
  'udh': 'sudah', 'nih': 'ini', 'tuh': 'itu',
  'gini': 'begini', 'emang': 'memang',
};

const fbFixes: Record<string, string> = {
  'sistim': 'sistem', 'metoda': 'metode',
  'strateji': 'strategi', 'difinisi': 'definisi',
  'annalisa': 'analisis', 'analisa': 'analisis',
  'produktifitas': 'produktivitas', 'hipotesa': 'hipotesis',
  'algoritm': 'algoritma', 'ngapain': 'mengapa',
};

const fbRemove = new Set(['dong', 'sih', 'deh', 'loh', 'toh']);

const techTerms = new Set([
  'ai', 'api', 'app', 'software', 'hardware', 'database', 'server',
  'client', 'frontend', 'backend', 'framework', 'library', 'plugin',
  'machine', 'learning', 'deep', 'neural', 'natural', 'language',
  'processing', 'nlp', 'llm', 'gpt', 'transformer', 'model',
  'training', 'dataset', 'prompt', 'token', 'inference', 'embedding',
  'rag', 'whisper', 'groq', 'llama', 'claude', 'gemini',
  'html', 'css', 'javascript', 'typescript', 'react', 'vue',
  'node', 'python', 'java', 'php', 'sql', 'json', 'xml', 'http',
  'google', 'microsoft', 'apple', 'amazon', 'meta',
  'gpu', 'cpu', 'ram', 'ssd', 'hdd', 'iot', 'kbbi', 'uv',
  // Educational terms (also in speech-grammar.ts)
  'fotosintesis', 'kloroplas', 'klorofil', 'parabola', 'percepatan',
  'kecepatan', 'momentum', 'gaya', 'joule', 'watt', 'volt', 'ampere',
  'frekuensi', 'amplitudo', 'refraksi', 'refleksi', 'difraksi',
  'molekul', 'atom', 'ion', 'elektron', 'proton', 'neutron', 'isotop',
  'senyawa', 'larutan', 'asam', 'basa', 'mol', 'molaritas',
  'oksidasi', 'reduksi', 'elektrolisis', 'hidrogen', 'oksigen',
  'enzim', 'protein', 'karbohidrat', 'lipid',
  'trigonometri', 'sinus', 'kosinus', 'tangen', 'hipotenusa',
  'integral', 'diferensial', 'limit', 'turunan', 'fungsi',
  'persamaan', 'matriks', 'determinan', 'vektor', 'skalar',
  'pythagoras', 'aljabar', 'geometri',
  'arduino', 'goto', 'saham', 'bullish', 'bearish',
  'candlestick', 'breakout', 'support', 'resistance',
]);

// ── NEW: Top IDX stock tickers (well-known, ~30) ──
const stockTickers = new Set([
  'GOTO', 'BBCA', 'BBRI', 'BBNI', 'BMRI', 'TLKM', 'ASII', 'UNVR',
  'INDY', 'MARI', 'ANTM', 'INCO', 'KRAS', 'MYOH', 'KLBF', 'GGRM',
  'ICBP', 'INDF', 'CPIN', 'JPFA', 'TPIA', 'ADRO', 'PGAS', 'MEDC',
  'MAIN', 'SMRA', 'BSDE', 'CTRA', 'LPKR', 'ASRI', 'AMMN', 'MPPA',
  'BFIN', 'TBIG', 'EXCL', 'ISAT', 'MNCN', 'LION', 'BNGA', 'BBTN',
]);

// ── NEW: Multi-word phrase map (for stock ticker spoken forms) ──
// Loaded from JSON `phrase_map` field, with hardcoded fallback.
// Also loads `phonetic-map.json` for comprehensive phonetic + company name + action phrase maps.
let _phraseMap: Record<string, string> | null = null;
let _phoneticTickers: Record<string, string> | null = null;
let _companyNames: Record<string, string> | null = null;
let _actionPhrases: Record<string, string> | null = null;

function getPhraseMap(): Record<string, string> {
  if (_phraseMap) return _phraseMap;
  _phraseMap = {
    'go to': 'GOTO', 'go 2': 'GOTO', 'goto': 'GOTO',
    'be ca a': 'BBCA', 'be be ca a': 'BBCA', 'be be ri': 'BBRI',
    'be be ni': 'BBNI', 'be em ri': 'BMRI', 'be em ar i': 'BMRI',
    't l k m': 'TLKM', 'a s i i': 'ASII', 'mar i': 'MARI',
    'antm': 'ANTM', 'inco': 'INCO', 'kras': 'KRAS', 'myoh': 'MYOH',
    'klbf': 'KLBF', 'ggrm': 'GGRM', 'icbp': 'ICBP', 'indf': 'INDF',
    'cpin': 'CPIN', 'jpfa': 'JPFA', 'tpia': 'TPIA', 'adro': 'ADRO',
    'pgas': 'PGAS', 'medc': 'MEDC', 'smra': 'SMRA',
    'bsde': 'BSDE', 'ctra': 'CTRA', 'lpkr': 'LPKR', 'asri': 'ASRI',
    'ammn': 'AMMN', 'mppa': 'MPPA', 'bfin': 'BFIN', 'tbig': 'TBIG',
    'excl': 'EXCL', 'isat': 'ISAT', 'mncn': 'MNCN', 'lion': 'LION',
    'bnga': 'BNGA', 'bbtn': 'BBTN',
  };
  // Merge phonetic_tickers from phonetic-map.json (if loaded)
  if (_phoneticTickers) {
    _phraseMap = { ..._phraseMap, ..._phoneticTickers };
  }
  // Merge company_names (full company name → ticker)
  if (_companyNames) {
    _phraseMap = { ..._phraseMap, ..._companyNames };
  }
  return _phraseMap;
}

function getActionPhrases(): Record<string, string> {
  if (_actionPhrases) return _actionPhrases;
  _actionPhrases = {};
  return _actionPhrases;
}

// ── Context-dependent homophones ──
const ctxHomophones = [
  {
    w: 'kekerasan', c: 'kecerdasan',
    ctx: ['buatan', 'artificial', 'machine', 'learning', 'ai', 'teknologi',
          'komputer', 'algoritma', 'neural', 'deep', 'data', 'model',
          'jaringan', 'otomatis', 'robot', 'natural', 'processing',
          'nlp', 'visi', 'generatif', 'llm', 'bahasa', 'otak',
          'prompt', 'chatbot', 'sistem', 'teori', 'cerdas',
          'pembelajaran', 'edukasi', 'pendidikan', 'intelegensi', 'otomata'],
    keep: ['kejahatan', 'kriminal', 'pidana', 'hukuman', 'serangan',
           'fisik', 'verbal', 'bullying', 'konflik', 'perang',
           'ancaman', 'korban', 'melukai']
  },
];

export interface CorrectionResult {
  text: string;
  needsLLM: boolean;
  llmReason: string;
  stats: {
    totalWords: number;
    slangFixed: number;
    sttFixed: number;
    homophonesFixed: number;
    fuzzyFixed: number;
    phraseFixed: number;
    unknownWords: number;
    removedParticles: number;
  };
}

function isKnown(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length <= 1) return true;
  if (/^\d+$/.test(w)) return true;
  if (techTerms.has(w)) return true;
  if (stockTickers.has(word.toUpperCase())) return true;
  if (_kbbi?.has(w)) return true;
  if (_enWords?.has(w)) return true;
  if (_indoSlang && _indoSlang[w]) return true;
  if (_enSlang && _enSlang[w]) return true;
  if (fbSlang[w] !== undefined) return true;
  return false;
}

function fixHomophone(word: string, allLower: string[], idx: number): string | null {
  const wl = word.toLowerCase();
  for (const h of ctxHomophones) {
    if (wl === h.w) {
      const start = Math.max(0, idx - 10);
      const end = Math.min(allLower.length, idx + 11);
      const window = allLower.slice(start, end);
      if (h.keep.some(k => window.includes(k))) return null;
      if (h.ctx.some(c => window.includes(c))) return h.c;
    }
  }
  return null;
}

function cleanWord(w: string): { word: string; punct: string } {
  const m = w.match(/^(.*?)([.!?,;:'"]+)$/);
  if (m) return { word: m[1], punct: m[2] };
  return { word: w, punct: '' };
}

// ── NEW: Build length-indexed Map (called once, lazy) ──
function buildLengthIndex() {
  if (_lengthIndex) return;
  _lengthIndex = new Map<number, Set<string>>();

  const addToIndex = (word: string) => {
    const w = word.toLowerCase();
    const len = w.length;
    if (len < 3) return; // skip very short words (too ambiguous)
    let set = _lengthIndex!.get(len);
    if (!set) { set = new Set(); _lengthIndex!.set(len, set); }
    set.add(w);
  };

  if (_kbbi) for (const w of _kbbi) addToIndex(w);
  for (const w of techTerms) addToIndex(w);
  for (const w of stockTickers) addToIndex(w);

  const totalWords = Array.from(_lengthIndex.values()).reduce((s, set) => s + set.size, 0);
  console.log(`[STT-Dict] Length index built: ${_lengthIndex.size} length buckets, ${totalWords} total words`);
}

// ── NEW: Levenshtein Distance with early termination ──
// Returns the distance, or `maxDist + 1` if it exceeds maxDist (so caller can skip).
function levenshtein(a: string, b: string, maxDist: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1; // quick reject by length diff
  if (al === 0) return bl;
  if (bl === 0) return al;

  // Two-row DP for memory efficiency
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Early termination: if min of current row > maxDist, no point continuing
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

// ── NEW: Fuzzy correct a single word via Levenshtein ──
function fuzzyCorrectWord(word: string): { corrected: string; distance: number } | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null; // too short — too many false positives
  if (isKnown(w)) return null;   // already a valid word

  // Check cache
  if (_fuzzyCache.has(w)) return _fuzzyCache.get(w)!;

  buildLengthIndex();
  if (!_lengthIndex) return null;

  // Adaptive max distance based on word length
  //  3-5 chars: max dist 1
  //  6-8 chars: max dist 2
  //  9+  chars: max dist 3
  const maxDist = w.length <= 5 ? 1 : (w.length <= 8 ? 2 : 3);

  // Gather candidates: words of length w.length-2 to w.length+2
  const candidates: string[] = [];
  for (let len = Math.max(3, w.length - 2); len <= w.length + 2; len++) {
    const set = _lengthIndex.get(len);
    if (set) for (const c of set) candidates.push(c);
  }

  let bestMatch: string | null = null;
  let bestDist = maxDist + 1;
  for (const candidate of candidates) {
    const dist = levenshtein(w, candidate, maxDist);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  const result = bestMatch && bestDist <= maxDist
    ? { corrected: bestMatch, distance: bestDist }
    : null;

  // Cache it
  if (_fuzzyCache.size >= FUZZY_CACHE_MAX) {
    // Drop oldest 20% to prevent unbounded growth
    const keys = Array.from(_fuzzyCache.keys()).slice(0, Math.floor(FUZZY_CACHE_MAX * 0.2));
    for (const k of keys) _fuzzyCache.delete(k);
  }
  _fuzzyCache.set(w, result);

  return result;
}

// ── NEW: Apply multi-word phrase corrections (e.g., "go to" -> "GOTO") ──
function applyPhraseMap(text: string): { text: string; fixed: number } {
  let result = text;
  let fixed = 0;
  const phraseMap = getPhraseMap();
  // Sort by phrase length DESC so longer phrases match first
  const phrases = Object.keys(phraseMap).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    // Case-insensitive whole-phrase match
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(result)) {
      result = result.replace(re, phraseMap[phrase]);
      fixed++;
    }
  }
  return { text: result, fixed };
}

/**
 * Reset all in-memory caches so the next localCorrect() call reloads
 * everything from the JSON files. Called by /api/admin/stt-fix after
 * adding a new mapping to phonetic-map.json — enables hot-reload
 * without PM2 restart.
 */
export function resetDictionaryCache() {
  _loaded = false;
  _kbbi = null;
  _enWords = null;
  _indoSlang = null;
  _enSlang = null;
  _fixes = null;
  _remove = null;
  _phraseMap = null;
  _phoneticTickers = null;
  _companyNames = null;
  _actionPhrases = null;
  _lengthIndex = null;
  _fuzzyCache.clear();
  console.log('[STT-Dict] Cache reset — will reload on next request');
}

export function localCorrect(rawText: string): CorrectionResult {
  loadDict();
  const stats = {
    totalWords: 0, slangFixed: 0, sttFixed: 0, homophonesFixed: 0,
    fuzzyFixed: 0, phraseFixed: 0, unknownWords: 0, removedParticles: 0,
  };
  if (!rawText.trim()) return { text: '', needsLLM: false, llmReason: '', stats };

  // ── Step 0: Multi-word phrase map (stock tickers, etc.) ──
  const phraseResult = applyPhraseMap(rawText);
  stats.phraseFixed = phraseResult.fixed;
  let text = phraseResult.text;

  // ── Steps 1-5 (existing) + NEW step 6 (fuzzy) ──
  const segments = text.split(/(\s+)/);
  const allLower: string[] = [];
  for (const seg of segments) {
    if (/^\s+$/.test(seg) || !seg) continue;
    const { word } = cleanWord(seg);
    allLower.push(word.toLowerCase());
  }

  const out: string[] = [];
  let wordIdx = 0;

  for (const seg of segments) {
    if (/^\s+$/.test(seg)) { out.push(seg); continue; }
    if (!seg) continue;
    const { word: raw, punct } = cleanWord(seg);
    const lower = raw.toLowerCase();
    stats.totalWords++;

    // 1. Remove filler particles
    if (fbRemove.has(lower) || _remove?.has(lower)) {
      stats.removedParticles++;
      wordIdx++;
      continue;
    }

    // 2. Direct STT fixes
    const fixTarget = _fixes?.[lower] || fbFixes[lower];
    if (fixTarget) {
      out.push(fixTarget + punct);
      stats.sttFixed++;
      wordIdx++;
      continue;
    }

    // 3. Slang to formal
    const slangTarget = _indoSlang?.[lower]?.f || fbSlang[lower];
    if (slangTarget !== undefined) {
      if (slangTarget === '') {
        stats.removedParticles++;
        wordIdx++;
        continue;
      }
      out.push(slangTarget + punct);
      stats.slangFixed++;
      wordIdx++;
      continue;
    }

    // 4. Context homophone fix
    const homoFix = fixHomophone(raw, allLower, wordIdx);
    if (homoFix) {
      out.push(homoFix + punct);
      stats.homophonesFixed++;
      wordIdx++;
      continue;
    }

    // 5. NEW: Fuzzy matching via Levenshtein (typo correction)
    if (!isKnown(raw)) {
      const fuzzy = fuzzyCorrectWord(raw);
      if (fuzzy) {
        // Preserve original case style: if input was capitalized, capitalize output
        let corrected = fuzzy.corrected;
        if (raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase()) {
          corrected = corrected[0].toUpperCase() + corrected.slice(1);
        }
        out.push(corrected + punct);
        stats.fuzzyFixed++;
        wordIdx++;
        continue;
      }
      stats.unknownWords++;
    }

    out.push(seg);
    wordIdx++;
  }

  const finalText = out.join('').replace(/\s{2,}/g, ' ').trim();
  const ratio = stats.totalWords > 0 ? stats.unknownWords / stats.totalWords : 0;
  const needsLLM = stats.totalWords >= 4 && ratio > 0.3;

  return {
    text: finalText,
    needsLLM,
    llmReason: needsLLM ? `${stats.unknownWords}/${stats.totalWords} unknown (${Math.round(ratio * 100)}%)` : '',
    stats,
  };
}

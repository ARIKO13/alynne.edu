/**
 * STT Auto-Correction Dictionary v2
 * 
 * Hybrid approach:
 * 1. Local dictionary correction (KBBI 192K + English 125K + slang)
 * 2. Context-based homophone fix (kekerasan->kecerdasan in tech context) - NO LLM
 * 3. Only fall back to LLM if too many unknown words remain
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

function loadDict() {
  if (_loaded) return;
  _loaded = true;
  try {
    // Try multiple possible paths for the dictionary file
    const candidates = [
      // Relative to project root (process.cwd() = /root/lina-learning on VPS)
      join(process.cwd(), 'data', 'stt-dictionary.json'),
      join(process.cwd(), 'src', 'lib', 'data', 'stt-dictionary.json'),
      // Absolute path on VPS
      '/root/lina-learning/data/stt-dictionary.json',
      // Dev fallback
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
    
    console.log(`[STT-Dict] Loaded: KBBI=${_kbbi.size}, EN=${_enWords.size}, slang_id=${Object.keys(_indoSlang).length}, slang_en=${Object.keys(_enSlang).length}, fixes=${Object.keys(_fixes).length}`);
  } catch (err) {
    console.error('[STT-Dict] Load failed:', err);
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
]);

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
    unknownWords: number;
    removedParticles: number;
  };
}

function isKnown(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length <= 1) return true;
  if (/^\d+$/.test(w)) return true;
  if (techTerms.has(w)) return true;
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
      if (h.keep && h.keep.some(k => window.includes(k))) return null;
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

export function localCorrect(rawText: string): CorrectionResult {
  loadDict();
  const stats = { totalWords: 0, slangFixed: 0, sttFixed: 0, homophonesFixed: 0, unknownWords: 0, removedParticles: 0 };
  if (!rawText.trim()) return { text: '', needsLLM: false, llmReason: '', stats };

  const segments = rawText.split(/(\s+)/);
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

    // 5. Unknown word tracking
    if (!isKnown(raw)) {
      stats.unknownWords++;
    }

    out.push(seg);
    wordIdx++;
  }

  const text = out.join('').replace(/\s{2,}/g, ' ').trim();
  const ratio = stats.totalWords > 0 ? stats.unknownWords / stats.totalWords : 0;
  const needsLLM = stats.totalWords >= 4 && ratio > 0.3;

  return {
    text,
    needsLLM,
    llmReason: needsLLM ? `${stats.unknownWords}/${stats.totalWords} unknown (${Math.round(ratio * 100)}%)` : '',
    stats,
  };
}

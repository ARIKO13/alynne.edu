/**
 * Personal Dictionary — auto-learning system untuk STT (server-side version).
 *
 * WHY:
 *   Web Speech API kadang dengar kata yang belum ada di KBBI/dict (e.g. nama
 *   teknis, istilah baru, nama orang, kata serapan modern). Tanpa auto-learn,
 *   kata itu akan terus dianggap "unknown" dan di-fuzzy-match ke kata yang
 *   salah (e.g. "goceh" → "goa", "anomali" → "anomali").
 *
 *   Dengan auto-learn, kata yang confidence-nya tinggi DAN muncul berkali-kali
 *   otomatis masuk ke global dictionary (D1 + phonetic-map.json). Next time
 *   kata itu muncul, isKnown() return true → tidak di-fuzzy-match.
 *
 * ARCHITECTURE (v2 — server-side):
 *   Client (use-speech-recognition.ts):
 *     1. Saat STT dapat final text dengan confidence > threshold,
 *        extract each word
 *     2. Filter: skip words yang sudah known (KBBI/slang/common)
 *     3. POST ke /api/stt/learn-word dengan word + confidence
 *
 *   Server (/api/stt/learn-word):
 *     1. Insert ke D1 table LearnedWord (id, word, phonetic_variations, ...)
 *     2. expandPhoneticVariations(word) → generate ["go ceh", "goceh", "goseh", ...]
 *     3. Merge ke phonetic-map.json (file fisik di VPS)
 *     4. resetDictionaryCache() supaya isKnown() pick up kata baru di request berikutnya
 *
 *   Server (/api/stt/learned-words):
 *     1. GET — list all learned words (untuk UI panel)
 *     2. DELETE — hapus word (juga clean phonetic-map.json)
 *
 * STORAGE:
 *   - D1 table LearnedWord (audit trail + count + userId + source)
 *   - phonetic-map.json (variasi fonetik, dipake oleh phoneticMatch)
 *   - localStorage cache (untuk UI fast-render, optional)
 *
 * PROMOTION RULES (di client side, untuk avoid spamming server):
 *   - Client track candidate count di localStorage (sebelum POST ke server)
 *   - Hanya POST setelah kata muncul 2+ kali dengan confidence > 0.85
 *   - Server increment count kalau kata sudah ada, insert kalau baru
 *
 * PRIVACY:
 *   - Tidak menyimpan raw transcripts — hanya word yang sudah di-extract
 *   - userId optional (untuk audit trail siapa yang pertama bilang kata X)
 *   - Semua user dapat benefit dari kata yang dipelajari user lain (global dict)
 */

const CANDIDATES_STORAGE_KEY = 'alynneLearnedWordCandidates';
const CONFIDENCE_THRESHOLD = 0.85;
const PROMOTION_THRESHOLD = 2; // need to hear 2+ times before promoting to server

export interface LearnedWordEntry {
  id: string;
  word: string;
  phonetic_variations: string[];
  source: string;
  confidence: number;
  count: number;
  userId: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface LearnedWordsStats {
  total: number;
  confirmed: number;
  candidates: number;
}

// ── Client-side candidate tracking (before sending to server) ─────
// We track candidates in localStorage to avoid spamming the server with
// single-occurrence false positives. Only after count >= PROMOTION_THRESHOLD
// do we POST to /api/stt/learn-word.

interface CandidateEntry {
  count: number;
  firstHeard: number;
  lastHeard: number;
  confidence: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function loadCandidates(): Record<string, CandidateEntry> {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(CANDIDATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCandidates(candidates: Record<string, CandidateEntry>): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(candidates));
  } catch (e) {
    console.warn('[LearnedWord] save candidates failed:', e);
  }
}

/**
 * Record a word heard by STT with confidence score.
 *
 * Client-side candidate tracking + server-side promotion.
 *
 * Algorithm:
 *   1. If confidence < threshold → skip
 *   2. If word already in client candidates: increment count
 *   3. If count >= PROMOTION_THRESHOLD: POST to server + remove from candidates
 *   4. If word is brand new: add to candidates with count=1
 *
 * Returns: { promoted: boolean, count: number } — for UI feedback
 */
export async function recordHeardWord(
  word: string,
  confidence: number,
  isAlreadyKnown: boolean,
): Promise<{ promoted: boolean; count: number; confirmed: boolean }> {
  const w = word.toLowerCase().trim();
  if (!w || w.length < 3) return { promoted: false, count: 0, confirmed: false };
  if (isAlreadyKnown) return { promoted: false, count: 0, confirmed: false };
  if (confidence < CONFIDENCE_THRESHOLD) return { promoted: false, count: 0, confirmed: false };
  if (!/^[a-zà-ÿ\-\s]+$/i.test(w)) return { promoted: false, count: 0, confirmed: false };

  const candidates = loadCandidates();
  const now = Date.now();
  const existing = candidates[w];

  if (existing) {
    existing.count += 1;
    existing.lastHeard = now;
    existing.confidence = (existing.confidence * (existing.count - 1) + confidence) / existing.count;

    if (existing.count >= PROMOTION_THRESHOLD) {
      // Promote to server!
      try {
        const res = await fetch('/api/stt/learn-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            word: w,
            confidence: existing.confidence,
            source: 'webspeech',
          }),
        });
        if (res.ok) {
          // Remove from candidates (it's now on server)
          delete candidates[w];
          saveCandidates(candidates);
          console.log(`[LearnedWord] ✓ Promoted to server: "${w}" (count=${existing.count})`);
          return { promoted: true, count: existing.count, confirmed: true };
        } else {
          // Keep in candidates (will retry on next occurrence)
          saveCandidates(candidates);
          return { promoted: false, count: existing.count, confirmed: false };
        }
      } catch (e) {
        console.warn('[LearnedWord] promote failed:', e);
        saveCandidates(candidates);
        return { promoted: false, count: existing.count, confirmed: false };
      }
    }

    saveCandidates(candidates);
    return { promoted: false, count: existing.count, confirmed: false };
  }

  // First occurrence
  candidates[w] = {
    count: 1,
    firstHeard: now,
    lastHeard: now,
    confidence,
  };
  saveCandidates(candidates);
  return { promoted: false, count: 1, confirmed: false };
}

/**
 * Process a full sentence — extract words and record each.
 * Returns array of words that got promoted to server (for toast notification).
 */
export async function recordHeardSentence(
  text: string,
  confidence: number,
  isWordKnownFn: (word: string) => boolean,
): Promise<string[]> {
  if (!text || !confidence) return [];

  const words = text.toLowerCase()
    .replace(/[^\w\sà-ÿ]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const promoted: string[] = [];
  for (const w of words) {
    const result = await recordHeardWord(w, confidence, isWordKnownFn(w));
    if (result.promoted) promoted.push(w);
  }
  return promoted;
}

// ── Server-side data fetching (for UI) ─────────────────────────

export async function fetchLearnedWords(): Promise<{
  words: LearnedWordEntry[];
  total: number;
  stats: LearnedWordsStats;
}> {
  try {
    const res = await fetch('/api/stt/learned-words?limit=500');
    if (!res.ok) return { words: [], total: 0, stats: { total: 0, confirmed: 0, candidates: 0 } };
    const data = await res.json();
    return {
      words: data.words || [],
      total: data.total || 0,
      stats: data.stats || { total: 0, confirmed: 0, candidates: 0 },
    };
  } catch (e) {
    console.warn('[LearnedWord] fetch failed:', e);
    return { words: [], total: 0, stats: { total: 0, confirmed: 0, candidates: 0 } };
  }
}

export async function deleteLearnedWord(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/stt/learned-words?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.warn('[LearnedWord] delete failed:', e);
    return false;
  }
}

// ── Client-side candidate stats (for live UI update without server refetch) ─

export function getCandidateCount(): number {
  const candidates = loadCandidates();
  return Object.keys(candidates).length;
}

export function clearCandidates(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(CANDIDATES_STORAGE_KEY);
}

export const LEARNED_WORD_CONSTANTS = {
  CONFIDENCE_THRESHOLD,
  PROMOTION_THRESHOLD,
  CANDIDATES_STORAGE_KEY,
};

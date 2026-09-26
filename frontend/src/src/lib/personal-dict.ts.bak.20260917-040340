/**
 * Personal Dictionary — auto-learning system untuk STT.
 *
 * WHY:
 *   Web Speech API kadang dengar kata yang belum ada di KBBI/dict (e.g. nama
 *   teknis, istilah baru, nama orang, kata serapan modern). Tanpa auto-learn,
 *   kata itu akan terus dianggap "unknown" dan di-fuzzy-match ke kata yang
 *   salah (e.g. "goceh" → "goa", "anomali" → "anomali").
 *
 *   Dengan auto-learn, kata yang confidence-nya tinggi DAN muncul berkali-kali
 *   otomatis masuk ke personal dict user. Next time kata itu muncul, isKnown()
 *   return true → tidak di-fuzzy-match.
 *
 * DESIGN (solusi untuk "bingung gimana kata baru yang ditangkep biar sesuai
 * dengan user katakan"):
 *
 *   Tidak ada cara 100% pasti untuk tahu "apa yang user katakan" tanpa ground
 *   truth. Tapi kita bisa pakai 3 filter probabilistik:
 *
 *   1. CONFIDENCE FILTER
 *      Web Speech API kasih confidence score per result (0.0 - 1.0).
 *      Kalau confidence > 0.85, kemungkinan besar kata itu benar apa yang
 *      user katakan. Kalau confidence rendah, kita skip — terlalu berisiko
 *      salah disimpan.
 *
 *   2. REPETITION FILTER
 *      Satu kali muncul dengan confidence tinggi → belum cukup bukti. Bisa
 *      false positive satu kali. Kalau kata yang sama muncul 2+ kali di
 *      session berbeda, kemungkinan besar itu kata valid yang sering user
 *      pakai → promote ke confirmed personal dict.
 *
 *   3. CONTEXT VALIDATION (opsional, future)
 *      Kalau kata muncul dalam kalimat yang grammatically reasonable
 *      (e.g. ada verb sebelum/sesudah), kemungkinan valid. Implementasi
 *      future: pakai rule-based atau LLM.
 *
 * STORAGE (client-side only, privacy-safe):
 *   - localStorage key 'alynnePersonalDict'
 *   - Format: { [word]: { count, firstHeard, lastHeard, confidence } }
 *   - Tidak dikirim ke server (privacy: kata-kata user stays di browser)
 *   - Tapi dikirim sebagai additional info saat /api/stt/fuzzy-correct request
 *     supaya server tau "kata X valid buat user ini"
 *
 * LIFECYCLE:
 *   1. User bilang kata "X" dengan confidence 0.9
 *   2. STT dapat "X", cek isKnown() → belum ada di KBBI/slang/personal
 *   3. Tambah ke candidates: personalDict['X'] = { count: 1, ... }
 *   4. User bilang "X" lagi (session lain, confidence 0.92)
 *   5. Cek candidates: count=1 → increment jadi 2
 *   6. count >= PROMOTION_THRESHOLD (2) → confirm ke personalDict
 *   7. isKnown() sekarang return true untuk "X"
 *   8. Next STT: "X" tidak di-fuzzy-match → text akurat
 */

const STORAGE_KEY = 'alynnePersonalDict';
const CONFIDENCE_THRESHOLD = 0.85;
const PROMOTION_THRESHOLD = 2; // need to hear 2+ times before promoting

export interface PersonalDictEntry {
  count: number;
  firstHeard: number;
  lastHeard: number;
  confidence: number; // average confidence
  confirmed: boolean; // true after promotion threshold reached
}

export type PersonalDict = Record<string, PersonalDictEntry>;

// ─── Internal cache (lazy-loaded) ──────────────────────────────
let _cache: PersonalDict | null = null;

// ─── Browser detection (for SSR safety) ────────────────────────
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

// ─── Load from localStorage (with caching) ─────────────────────
export function loadPersonalDict(): PersonalDict {
  if (!isBrowser()) return {};
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
  return _cache!;
}

// ─── Save to localStorage (write-through cache) ────────────────
function savePersonalDict(dict: PersonalDict): void {
  if (!isBrowser()) return;
  _cache = dict;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dict));
  } catch (e) {
    console.warn('[PersonalDict] save failed:', e);
  }
}

/**
 * Check if a word is in the confirmed personal dictionary.
 * Called by isKnown() in stt-dictionary.ts to skip fuzzy-matching.
 */
export function isPersonalKnown(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  const dict = loadPersonalDict();
  const entry = dict[w];
  return !!(entry && entry.confirmed);
}

/**
 * Get all confirmed personal words as a Set (for fast lookup).
 * Used by stt-dictionary.ts to bulk-merge into the known-words set.
 */
export function getConfirmedPersonalWords(): Set<string> {
  const dict = loadPersonalDict();
  const result = new Set<string>();
  for (const [word, entry] of Object.entries(dict)) {
    if (entry.confirmed) result.add(word);
  }
  return result;
}

/**
 * Record a word heard by STT with confidence score.
 *
 * Called from use-speech-recognition.ts onresult handler.
 *
 * Algorithm:
 *   1. If word already known in KBBI/slang → skip (no need to learn)
 *   2. If confidence < CONFIDENCE_THRESHOLD → skip (too uncertain)
 *   3. If word in personal candidates: increment count
 *   4. If count >= PROMOTION_THRESHOLD: promote to confirmed
 *   5. Save to localStorage
 *
 * Returns: { promoted: boolean, count: number } — for UI feedback
 */
export function recordHeardWord(
  word: string,
  confidence: number,
  isAlreadyKnown: boolean,
): { promoted: boolean; count: number; confirmed: boolean } {
  const w = word.toLowerCase().trim();
  if (!w || w.length < 3) return { promoted: false, count: 0, confirmed: false };

  // Skip if word already in KBBI/slang — no need to learn
  if (isAlreadyKnown) return { promoted: false, count: 0, confirmed: false };

  // Skip if confidence too low
  if (confidence < CONFIDENCE_THRESHOLD) return { promoted: false, count: 0, confirmed: false };

  // Skip words that look like noise (all caps, mixed case weirdness)
  if (!/^[a-zà-ÿ\-\s]+$/i.test(w)) return { promoted: false, count: 0, confirmed: false };

  const dict = loadPersonalDict();
  const now = Date.now();
  const existing = dict[w];

  if (existing) {
    // Increment count, update lastHeard, average confidence
    existing.count += 1;
    existing.lastHeard = now;
    existing.confidence = (existing.confidence * (existing.count - 1) + confidence) / existing.count;
    const wasConfirmed = existing.confirmed;
    if (!wasConfirmed && existing.count >= PROMOTION_THRESHOLD) {
      existing.confirmed = true;
      savePersonalDict(dict);
      console.log(`[PersonalDict] ✓ Promoted: "${w}" (count=${existing.count}, conf=${existing.confidence.toFixed(2)})`);
      return { promoted: true, count: existing.count, confirmed: true };
    }
    savePersonalDict(dict);
    return { promoted: false, count: existing.count, confirmed: existing.confirmed };
  }

  // First time hearing this word
  dict[w] = {
    count: 1,
    firstHeard: now,
    lastHeard: now,
    confidence,
    confirmed: false, // need 2+ occurrences to confirm
  };
  savePersonalDict(dict);
  return { promoted: false, count: 1, confirmed: false };
}

/**
 * Process a full sentence — extract words and record each.
 * Convenience function for use in onresult handler.
 *
 * Returns array of words that got promoted this call (for toast notification).
 */
export function recordHeardSentence(
  text: string,
  confidence: number,
  isWordKnownFn: (word: string) => boolean,
): string[] {
  if (!text || !confidence) return [];

  const words = text.toLowerCase()
    .replace(/[^\w\sà-ÿ]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const promoted: string[] = [];
  for (const w of words) {
    const result = recordHeardWord(w, confidence, isWordKnownFn(w));
    if (result.promoted) promoted.push(w);
  }
  return promoted;
}

// ─── Management functions (for Settings UI) ───────────────────

/**
 * Get all entries (confirmed + candidates) for display in Settings.
 */
export function getAllPersonalEntries(): PersonalDict {
  return loadPersonalDict();
}

/**
 * Get only confirmed entries.
 */
export function getConfirmedEntries(): PersonalDict {
  const dict = loadPersonalDict();
  const result: PersonalDict = {};
  for (const [word, entry] of Object.entries(dict)) {
    if (entry.confirmed) result[word] = entry;
  }
  return result;
}

/**
 * Manually confirm a candidate word (user clicked "Add" in UI).
 */
export function confirmWord(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  const dict = loadPersonalDict();
  if (!dict[w]) {
    // Add new entry with default values
    dict[w] = {
      count: 1,
      firstHeard: Date.now(),
      lastHeard: Date.now(),
      confidence: 1.0,
      confirmed: true,
    };
  } else {
    dict[w].confirmed = true;
  }
  savePersonalDict(dict);
  return true;
}

/**
 * Delete a word from personal dict.
 */
export function deleteWord(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  const dict = loadPersonalDict();
  if (!dict[w]) return false;
  delete dict[w];
  savePersonalDict(dict);
  return true;
}

/**
 * Clear all personal dict entries.
 */
export function clearAllPersonalDict(): void {
  if (!isBrowser()) return;
  _cache = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[PersonalDict] clear failed:', e);
  }
}

/**
 * Get stats for display in UI.
 */
export function getPersonalDictStats(): {
  total: number;
  confirmed: number;
  candidates: number;
} {
  const dict = loadPersonalDict();
  let confirmed = 0;
  for (const entry of Object.values(dict)) {
    if (entry.confirmed) confirmed++;
  }
  return {
    total: Object.keys(dict).length,
    confirmed,
    candidates: Object.keys(dict).length - confirmed,
  };
}

/**
 * Export personal dict as JSON (for backup/transfer between devices).
 */
export function exportPersonalDict(): string {
  return JSON.stringify(loadPersonalDict(), null, 2);
}

/**
 * Import personal dict from JSON (merge with existing).
 */
export function importPersonalDict(jsonStr: string): { added: number; skipped: number } {
  try {
    const imported = JSON.parse(jsonStr) as PersonalDict;
    if (typeof imported !== 'object' || imported === null) {
      return { added: 0, skipped: 0 };
    }
    const dict = loadPersonalDict();
    let added = 0, skipped = 0;
    for (const [word, entry] of Object.entries(imported)) {
      if (typeof entry === 'object' && typeof entry.count === 'number') {
        if (!dict[word]) {
          dict[word] = entry;
          added++;
        } else {
          // Merge: take max count, keep confirmed if either is confirmed
          dict[word].count = Math.max(dict[word].count, entry.count);
          dict[word].confirmed = dict[word].confirmed || entry.confirmed;
          dict[word].lastHeard = Math.max(dict[word].lastHeard, entry.lastHeard || 0);
          skipped++;
        }
      }
    }
    savePersonalDict(dict);
    return { added, skipped };
  } catch (e) {
    console.warn('[PersonalDict] import failed:', e);
    return { added: 0, skipped: 0 };
  }
}

// ─── Constants exported for UI display ────────────────────────
export const PERSONAL_DICT_CONSTANTS = {
  CONFIDENCE_THRESHOLD,
  PROMOTION_THRESHOLD,
  STORAGE_KEY,
};

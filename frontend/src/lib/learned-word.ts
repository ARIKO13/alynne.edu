import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { d1 } from '@/lib/d1-client';
import { getSession } from '@/lib/auth';
import { resetDictionaryCache } from '@/lib/stt-dictionary';

/**
 * Server-side auto-learning system untuk STT.
 *
 * Saat user bilang kata baru dengan confidence tinggi (2+ kali muncul),
 * kata itu dikirim ke sini. Server:
 *   1. Simpan ke D1 table `LearnedWord` (audit trail + count + userId)
 *   2. Generate phonetic variations (misal "goceh" → ["go ceh", "goceh", "goce", "gosheh"])
 *   3. Merge ke phonetic-map.json (file fisik)
 *   4. Hot-reload dict cache (resetDictionaryCache) supaya next request pick up kata baru
 *
 * Semua user dapat benefit dari kata yang dipelajari user lain — global dict.
 * Tapi tracking userId + source tetap ada untuk audit trail (siapa yang pertama
 * bilang kata X).
 */

// ── Indonesian letter pronunciation rules ──
// Untuk generate fonetik huruf-per-huruf (berguna untuk singkatan/ticker)
const ALPHABET_PHONETICS: Record<string, string[]> = {
  A: ['a', 'ah'],
  B: ['be', 'beh', 'b'],
  C: ['se', 'ce', 'seh'],
  D: ['de', 'deh', 'd'],
  E: ['e', 'eh'],
  F: ['ef', 'ep', 'fe'],
  G: ['ge', 'geh', 'g'],
  H: ['ha', 'hah', 'h'],
  I: ['i', 'eye'],
  J: ['je', 'jeh', 'ji'],
  K: ['ka', 'kah', 'ke'],
  L: ['el', 'leh', 'l'],
  M: ['em', 'm'],
  N: ['en', 'n'],
  O: ['o', 'oh'],
  P: ['pe', 'peh', 'p'],
  Q: ['ki', 'kiu', 'q'],
  R: ['er', 'ar', 'r'],
  S: ['es', 's'],
  T: ['te', 'teh', 't'],
  U: ['u', 'you'],
  V: ['fe', 've', 'vi'],
  W: ['we', 'w', 'dobel u'],
  X: ['eks', 'ex', 'x'],
  Y: ['ye', 'y', 'wai'],
  Z: ['zet', 'ze', 'z'],
};

/**
 * Generate phonetic variations for an Indonesian word.
 *
 * Menghasilkan 4 kategori variasi:
 *   1. Word as-is (lowercase) — exact match fallback
 *   2. Common Indonesian STT mishearings:
 *      - 'c' → 's' / 'k'  (e.g. "goceh" → "goseh", "gokeh")
 *      - 'v' → 'f'        (e.g. "vaksin" → "faksin")
 *      - 'z' → 's'        (e.g. "zaman" → "saman")
 *      - 'q' → 'k'        (e.g. "quran" → "kuran")
 *      - 'x' → 'ks'       (e.g. "tax" → "taks")
 *      - 'ph' → 'f'       (e.g. "phase" → "fase")
 *   3. Vowel swap variants (e.g. "solusi" → "solosi", "solasi")
 *   4. For single letters / short codes (≤3 chars), spell-out fonetik
 *
 * Returns: array of unique phonetic variations (without the original — caller adds it).
 */
export function expandPhoneticVariations(word: string): string[] {
  const w = word.toLowerCase().trim();
  if (!w || w.length < 2) return [];

  const variations = new Set<string>();

  // 1. As-is (lowercase) — caller should add this separately
  // (skip here to avoid duplication)

  // 2. Letter substitution variants (common Indonesian mishearings)
  const substitutions: [RegExp, string][] = [
    [/c/g, 's'],   // c → s (e.g. goceh → goseh)
    [/c/g, 'k'],   // c → k (e.g. goceh → gokeh)
    [/v/g, 'f'],   // v → f
    [/z/g, 's'],   // z → s
    [/q/g, 'k'],   // q → k
    [/x/g, 'ks'],  // x → ks
    [/ph/g, 'f'],  // ph → f
    [/sh/g, 's'],  // sh → s
    [/ck/g, 'k'],  // ck → k
    [/ea/g, 'e'],  // ea → e (breakout → brekaut)
    [/ou/g, 'u'],  // ou → u
    [/ee/g, 'i'],  // ee → i (bebe → bibi)
  ];
  for (const [pattern, replacement] of substitutions) {
    const variant = w.replace(pattern, replacement);
    if (variant !== w) variations.add(variant);
  }

  // 3. Vowel swap variants — generate variants where each vowel is swapped
  //    with similar-sounding vowels (a↔e, o↔u, i↔e, etc.)
  const vowelSwaps: Record<string, string[]> = {
    a: ['e', 'o'],
    e: ['a', 'i'],
    i: ['e', 'y'],
    o: ['u', 'a'],
    u: ['o'],
  };
  // Only swap first 2 vowels to limit combinatorial explosion
  const vowelIndices: number[] = [];
  for (let i = 0; i < w.length; i++) {
    if (vowelSwaps[w[i]]) vowelIndices.push(i);
    if (vowelIndices.length >= 2) break;
  }
  if (vowelIndices.length > 0) {
    for (const idx of vowelIndices) {
      const original = w[idx];
      for (const swap of vowelSwaps[original] || []) {
        const variant = w.slice(0, idx) + swap + w.slice(idx + 1);
        if (variant !== w) variations.add(variant);
      }
    }
  }

  // 4. For short words / abbreviations (≤3 chars uppercase), spell out letters
  //    e.g. "BBCA" → "be be se a"
  if (word === word.toUpperCase() && word.length <= 4 && /^[A-Z]+$/.test(word)) {
    const spelledOut: string[] = [];
    for (const char of word) {
      const opts = ALPHABET_PHONETICS[char];
      if (opts) spelledOut.push(opts[0]);
    }
    if (spelledOut.length > 0) {
      variations.add(spelledOut.join(' '));         // "be be se a"
      variations.add(spelledOut.join(''));           // "bebesea"
      variations.add(spelledOut.join('-'));           // "be-be-se-a"
    }
  }

  // 5. Remove duplicate consonants (e.g. "massal" → "masal")
  const deduped = w.replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1');
  if (deduped !== w) variations.add(deduped);

  // 6. Drop final 'h' (common in Indonesian STT — "goceh" → "goce")
  if (w.endsWith('h') && w.length > 3) {
    variations.add(w.slice(0, -1));
  }

  return Array.from(variations);
}

/**
 * Insert a new learned word into D1 + merge phonetic variations into phonetic-map.json.
 *
 * Called by /api/stt/learn-word when client detects a word that should be learned.
 *
 * Behavior:
 *   - If word already in D1: increment count, update lastUsedAt
 *   - If new word: insert with count=1
 *   - Always merge phonetic variations into phonetic-map.json (idempotent)
 *   - Reset dict cache so next request picks up new word
 *
 * Returns: { learned: boolean, variations: number, word: string }
 */
export async function learnWord(
  word: string,
  confidence: number,
  userId: string | null,
  source: string = 'webspeech',
): Promise<{ learned: boolean; variations: number; word: string; count: number }> {
  const w = word.toLowerCase().trim();
  if (!w || w.length < 3) {
    return { learned: false, variations: 0, word: w, count: 0 };
  }

  // Sanity: skip if word is already in KBBI (no need to learn)
  // We let the client do this check first (faster), but also do it server-side
  // for safety. However, this would require loading the dict — skip for now
  // since client already filters.

  // Ensure table exists
  await d1.execute(`
    CREATE TABLE IF NOT EXISTS LearnedWord (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic_variations TEXT,
      source TEXT,
      confidence REAL DEFAULT 0,
      count INTEGER DEFAULT 1,
      userId TEXT,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT NOT NULL
    )
  `).catch(() => {});

  // Check if word already exists
  const existing = await d1.query<{ id: string; count: number; confidence: number }>(
    `SELECT id, count, confidence FROM LearnedWord WHERE word = ?`,
    [w]
  );

  const now = new Date().toISOString();
  let newCount: number;
  let avgConfidence: number;

  if (existing.length > 0) {
    // Update existing: increment count, update lastUsedAt, recalculate confidence
    const row = existing[0];
    newCount = (row.count || 0) + 1;
    // Weighted average: existing confidence * (count-1) + new confidence, divided by count
    avgConfidence = ((row.confidence || 0) * (newCount - 1) + confidence) / newCount;
    await d1.execute(
      `UPDATE LearnedWord SET count = ?, confidence = ?, lastUsedAt = ? WHERE word = ?`,
      [newCount, avgConfidence, now, w]
    );
  } else {
    // Insert new word
    newCount = 1;
    avgConfidence = confidence;
    const id = crypto.randomUUID();
    const variations = expandPhoneticVariations(w);
    const variationsJson = JSON.stringify(variations);
    await d1.execute(
      `INSERT INTO LearnedWord (id, word, phonetic_variations, source, confidence, count, userId, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, w, variationsJson, source, confidence, newCount, userId, now, now]
    );
  }

  // Merge phonetic variations into phonetic-map.json
  // This makes the word discoverable by the existing phonetic matching system
  const variationsAdded = await mergeIntoPhoneticMap(w);

  // Reset dict cache so isKnown() picks up the new word on next request
  if (variationsAdded > 0) {
    try {
      resetDictionaryCache();
    } catch (e) {
      console.warn('[learn-word] Could not reset cache:', e);
    }
  }

  return {
    learned: true,
    variations: variationsAdded,
    word: w,
    count: newCount,
  };
}

/**
 * Merge a word's phonetic variations into phonetic-map.json.
 * Idempotent — if variations already exist, no change.
 *
 * Returns the number of NEW variations added (0 if all already present).
 */
async function mergeIntoPhoneticMap(word: string): Promise<number> {
  const w = word.toLowerCase().trim();
  if (!w) return 0;

  // Find phonetic-map.json on VPS or local
  const candidates = [
    join(process.cwd(), 'backend', 'data', 'phonetic-map.json'),
    '/root/lina-learning/backend/data/phonetic-map.json',
    join(process.cwd(), 'phonetic-map.json'),
  ];
  let phoneticPath = '';
  for (const p of candidates) {
    if (existsSync(p)) { phoneticPath = p; break; }
  }
  if (!phoneticPath) {
    console.warn('[learn-word] phonetic-map.json not found, skipping merge');
    return 0;
  }

  try {
    const raw = readFileSync(phoneticPath, 'utf-8');
    const ph = JSON.parse(raw);

    if (!ph.learned_words) ph.learned_words = {};
    if (!ph.phonetic_tickers) ph.phonetic_tickers = {};

    // The word itself maps to itself (preserves case in output)
    // We add it to learned_words so it's traceable + to phonetic_tickers so
    // phoneticMatch() can find it
    const variations = expandPhoneticVariations(w);
    let added = 0;

    // Add the word itself to phonetic_tickers (lowercase form → original word)
    // This is what makes isKnown() work via the existing _phraseMap merge in stt-dictionary.ts
    if (!ph.phonetic_tickers[w]) {
      ph.phonetic_tickers[w] = w;  // maps to itself — just mark as known
      added++;
    }

    // Add phonetic variations → original word
    for (const variant of variations) {
      if (!ph.phonetic_tickers[variant]) {
        ph.phonetic_tickers[variant] = w;
        added++;
      }
    }

    // Track learned word metadata
    ph.learned_words[w] = {
      variations: variations.length + 1, // +1 for the word itself
      addedAt: new Date().toISOString(),
    };

    // Update version metadata
    ph._v = '3.0-auto-learning';
    const existingSource = ph._s || '';
    if (!existingSource.includes('auto-learning')) {
      ph._s = (existingSource + ' + auto-learning').replace(/^\s*\+\s*/, '');
    }

    if (added > 0) {
      writeFileSync(phoneticPath, JSON.stringify(ph, null, 2));
      console.log(`[learn-word] ✓ Added ${added} phonetic variations for "${w}" to phonetic-map.json`);
    }

    return added;
  } catch (e) {
    console.error('[learn-word] Failed to merge into phonetic-map.json:', e);
    return 0;
  }
}

/**
 * Get all learned words from D1 (for UI display).
 * Ordered by lastUsedAt DESC (most recent first).
 */
export async function getLearnedWords(limit: number = 100, offset: number = 0): Promise<{
  words: Array<{
    id: string;
    word: string;
    phonetic_variations: string[];
    source: string;
    confidence: number;
    count: number;
    userId: string | null;
    createdAt: string;
    lastUsedAt: string;
  }>;
  total: number;
}> {
  // Ensure table exists
  await d1.execute(`
    CREATE TABLE IF NOT EXISTS LearnedWord (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic_variations TEXT,
      source TEXT,
      confidence REAL DEFAULT 0,
      count INTEGER DEFAULT 1,
      userId TEXT,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT NOT NULL
    )
  `).catch(() => {});

  const countRows = await d1.query<{ c: number }>(`SELECT COUNT(*) as c FROM LearnedWord`);
  const total = countRows[0]?.c ?? 0;

  const rows = await d1.query<{
    id: string;
    word: string;
    phonetic_variations: string | null;
    source: string;
    confidence: number;
    count: number;
    userId: string | null;
    createdAt: string;
    lastUsedAt: string;
  }>(
    `SELECT id, word, phonetic_variations, source, confidence, count, userId, createdAt, lastUsedAt
     FROM LearnedWord
     ORDER BY lastUsedAt DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return {
    words: (rows || []).map(r => ({
      ...r,
      phonetic_variations: r.phonetic_variations
        ? JSON.parse(r.phonetic_variations)
        : [],
    })),
    total,
  };
}

/**
 * Delete a learned word by id. Also removes its phonetic variations from phonetic-map.json.
 */
export async function deleteLearnedWord(id: string): Promise<{ deleted: boolean; word?: string }> {
  // First fetch the word (so we can also clean up phonetic-map.json)
  const rows = await d1.query<{ word: string }>(
    `SELECT word FROM LearnedWord WHERE id = ?`,
    [id]
  );
  if (!rows.length) return { deleted: false };

  const word = rows[0].word;
  await d1.execute(`DELETE FROM LearnedWord WHERE id = ?`, [id]);

  // Remove from phonetic-map.json
  const candidates = [
    join(process.cwd(), 'backend', 'data', 'phonetic-map.json'),
    '/root/lina-learning/backend/data/phonetic-map.json',
    join(process.cwd(), 'phonetic-map.json'),
  ];
  let phoneticPath = '';
  for (const p of candidates) {
    if (existsSync(p)) { phoneticPath = p; break; }
  }
  if (phoneticPath) {
    try {
      const raw = readFileSync(phoneticPath, 'utf-8');
      const ph = JSON.parse(raw);
      if (ph.phonetic_tickers) {
        // Remove all entries that map to this word
        for (const key of Object.keys(ph.phonetic_tickers)) {
          if (ph.phonetic_tickers[key] === word) {
            delete ph.phonetic_tickers[key];
          }
        }
      }
      if (ph.learned_words) delete ph.learned_words[word];
      writeFileSync(phoneticPath, JSON.stringify(ph, null, 2));
      console.log(`[learn-word] ✓ Removed "${word}" from phonetic-map.json`);

      // Reset cache
      try { resetDictionaryCache(); } catch {}
    } catch (e) {
      console.error('[learn-word] Failed to clean phonetic-map.json:', e);
    }
  }

  return { deleted: true, word };
}

/**
 * Get count of learned words — for stats display.
 */
export async function getLearnedWordsStats(): Promise<{
  total: number;
  confirmed: number;  // count >= 2
  candidates: number;  // count < 2
}> {
  await d1.execute(`
    CREATE TABLE IF NOT EXISTS LearnedWord (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic_variations TEXT,
      source TEXT,
      confidence REAL DEFAULT 0,
      count INTEGER DEFAULT 1,
      userId TEXT,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT NOT NULL
    )
  `).catch(() => {});

  const totalRows = await d1.query<{ c: number }>(`SELECT COUNT(*) as c FROM LearnedWord`);
  const confirmedRows = await d1.query<{ c: number }>(
    `SELECT COUNT(*) as c FROM LearnedWord WHERE count >= 2`
  );
  const total = totalRows[0]?.c ?? 0;
  const confirmed = confirmedRows[0]?.c ?? 0;
  return {
    total,
    confirmed,
    candidates: total - confirmed,
  };
}

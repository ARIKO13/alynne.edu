import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sttDb } from '@/lib/stt-db';
import { resetDictionaryCache } from '@/lib/stt-dictionary';

// === BEGIN SYLLABLES PATCH ===
import { syllabifyWord } from '@/lib/syllabify';

function generateSyllables(word: string): string {
  try { return syllabifyWord(word); } catch { return ''; }
}
// === END SYLLABLES PATCH ===


/**
 * Server-side auto-learning system untuk STT (v2 — SQLite based).
 *
 * Perubahan dari v1 (D1) → v2 (SQLite):
 *   - Storage: SQLite di SSD VPS (better-sqlite3, synchronous, no network latency)
 *   - D1 tetap untuk user account data (Users, Certificates, Subscriptions)
 *   - SQLite khusus untuk STT (learned_words, word_cooccurrence, user_corrections)
 *
 * Tambah fitur baru:
 *   - Validation: kata harus >= 4 chars, valid Indonesian (no gibberish)
 *   - Multi-user vote: track unique userIds yang submit kata yang sama
 *     (kata yang di-submit user berbeda lebih reliable daripada 1 user)
 *   - Status: candidate (1 user) → confirmed (2+ users OR 5+ occurrences)
 *     → rejected (admin manual reject atau LLM flag)
 *   - Context tracking: simpan 3 kata sebelum + 3 sesudah (co-occurrence)
 *     untuk dipake context-aware correction di fuzzy-correct.ts
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

// ── Validation rules for new words ──
const MIN_WORD_LENGTH = 4; // kata harus >= 4 huruf (filter noise 1-3 huruf)
const MAX_WORD_LENGTH = 30;
const CONFIRM_VOTE_THRESHOLD = 3; // 3 unique users → confirmed (Phase 1: naik dari 2 → 3 untuk scale 1000+ users)
const CONFIRM_COUNT_THRESHOLD = 5; // OR 5 occurrences dari 1 user → confirmed

/**
 * Validate word sebelum di-accept ke database.
 *
 * Returns true kalau word valid (boleh di-learn), false kalau ditolak.
 *
 * Rules:
 *   - Length 4-30 chars
 *   - Hanya huruf (boleh hyphen, boleh spasi untuk multi-word)
 *   - Tidak boleh angka murni
 *   - Tidak boleh ada 3+ consecutive consonants aneh (gibberish detector)
 *   - Tidak boleh ada 3+ consecutive vowels aneh (gibberish detector)
 *   - Tidak boleh repeat char 4+ kali (e.g. "aaaaah" → reject)
 *   - Tidak boleh contains common Indonesian particle words
 */
export function validateWord(word: string): { valid: boolean; reason?: string } {
  const w = word.toLowerCase().trim();
  if (!w) return { valid: false, reason: 'empty' };
  if (w.length < MIN_WORD_LENGTH) return { valid: false, reason: `too short (min ${MIN_WORD_LENGTH})` };
  if (w.length > MAX_WORD_LENGTH) return { valid: false, reason: `too long (max ${MAX_WORD_LENGTH})` };
  if (!/^[a-zà-ÿ\-\s]+$/i.test(w)) return { valid: false, reason: 'invalid chars' };

  // Gibberish detector: 5+ consecutive consonants (e.g. "bcdfgh")
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(w)) {
    return { valid: false, reason: 'gibberish (5+ consonants)' };
  }
  // 4+ consecutive vowels (rare in Indonesian)
  if (/[aeiou]{4,}/i.test(w)) {
    return { valid: false, reason: 'gibberish (4+ vowels)' };
  }
  // Same char repeated 4+ times (e.g. "aaaaah" — likely STT glitch)
  if (/(.)\1{3,}/.test(w)) {
    return { valid: false, reason: 'repeated char (likely glitch)' };
  }
  // Common particles — don't auto-learn these (already in dict)
  const particles = new Set(['yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'karena', 'kalau', 'jika']);
  if (particles.has(w)) return { valid: false, reason: 'common particle' };

  return { valid: true };
}

/**
 * Generate phonetic variations for an Indonesian word.
 * Same as v1 — produces 5-15 variations per word.
 */
export function expandPhoneticVariations(word: string): string[] {
  const w = word.toLowerCase().trim();
  if (!w || w.length < 2) return [];

  const variations = new Set<string>();
  const substitutions: [RegExp, string][] = [
    [/c/g, 's'], [/c/g, 'k'], [/v/g, 'f'], [/z/g, 's'],
    [/q/g, 'k'], [/x/g, 'ks'], [/ph/g, 'f'], [/sh/g, 's'], [/ck/g, 'k'],
    [/ea/g, 'e'], [/ou/g, 'u'], [/ee/g, 'i'],
  ];
  for (const [pattern, replacement] of substitutions) {
    const variant = w.replace(pattern, replacement);
    if (variant !== w) variations.add(variant);
  }

  const vowelSwaps: Record<string, string[]> = {
    a: ['e', 'o'], e: ['a', 'i'], i: ['e', 'y'], o: ['u', 'a'], u: ['o'],
  };
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

  if (word === word.toUpperCase() && word.length <= 4 && /^[A-Z]+$/.test(word)) {
    const spelledOut: string[] = [];
    for (const char of word) {
      const opts = ALPHABET_PHONETICS[char];
      if (opts) spelledOut.push(opts[0]);
    }
    if (spelledOut.length > 0) {
      variations.add(spelledOut.join(' '));
      variations.add(spelledOut.join(''));
      variations.add(spelledOut.join('-'));
    }
  }

  const deduped = w.replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1');
  if (deduped !== w) variations.add(deduped);
  if (w.endsWith('h') && w.length > 3) variations.add(w.slice(0, -1));

  return Array.from(variations);
}

/**
 * Track co-occurrence: kata yang sering muncul sebelum/sesudah kata yang baru
 * dipelajari. Dipake context-aware correction di fuzzy-correct.ts.
 *
 * @param word Kata utama yang baru di-learn
 * @param contextBefore Array of words sebelum (max 3, oldest → newest)
 * @param contextAfter Array of words sesudah (max 3, terdekat → terjauh)
 */
export function trackCooccurrence(
  word: string,
  contextBefore: string[] = [],
  contextAfter: string[] = [],
): number {
  const w = word.toLowerCase().trim();
  if (!w) return 0;

  let inserted = 0;
  const tx = sttDb.tx(() => {
    // Before: oldest (distance 3) → newest (distance 1, closest to word)
    for (let i = 0; i < Math.min(contextBefore.length, 3); i++) {
      const ctx = contextBefore[i]?.toLowerCase().trim();
      if (!ctx || ctx.length < 2) continue;
      const distance = contextBefore.length - i;  // 3, 2, 1 (oldest → newest)
      sttDb.run(
        `INSERT INTO word_cooccurrence (word, context_word, position, distance, count)
         VALUES (?, ?, 'before', ?, 1)
         ON CONFLICT(word, context_word, position, distance)
         DO UPDATE SET count = count + 1, updated_at = datetime('now')`,
        [w, ctx, distance]
      );
      inserted++;
    }
    // After: closest (distance 1) → terjauh (distance 3)
    for (let i = 0; i < Math.min(contextAfter.length, 3); i++) {
      const ctx = contextAfter[i]?.toLowerCase().trim();
      if (!ctx || ctx.length < 2) continue;
      const distance = i + 1;
      sttDb.run(
        `INSERT INTO word_cooccurrence (word, context_word, position, distance, count)
         VALUES (?, ?, 'after', ?, 1)
         ON CONFLICT(word, context_word, position, distance)
         DO UPDATE SET count = count + 1, updated_at = datetime('now')`,
        [w, ctx, distance]
      );
      inserted++;
    }
  });
  tx();
  return inserted;
}

/**
 * Learn a new word — insert/update ke SQLite + expand fonetik + merge phonetic-map.json.
 *
 * v2 improvements:
 *   - Validate word (length, gibberish, particles)
 *   - Track unique userIds (vote_count = berapa user berbeda yang submit kata ini)
 *   - Auto-promote status: candidate → confirmed kalau vote_count >= 2 OR count >= 5
 *   - Track context words (3 before + 3 after) untuk co-occurrence stats
 */
export async function learnWord(
  word: string,
  confidence: number,
  userId: string | null,
  source: string = 'webspeech',
  contextBefore: string[] = [],
  contextAfter: string[] = [],
): Promise<{
  learned: boolean;
  variations: number;
  word: string;
  count: number;
  status: string;
  voteCount: number;
  validationError?: string;
}> {
  const w = word.toLowerCase().trim();

  // Validate word
  const validation = validateWord(w);
  if (!validation.valid) {
    return {
      learned: false, variations: 0, word: w, count: 0, status: 'rejected',
      voteCount: 0, validationError: validation.reason,
    };
  }

  const now = new Date().toISOString();
  const variations = expandPhoneticVariations(w);
  const variationsJson = JSON.stringify(variations);
  const userIds: string[] = userId ? [userId] : [];

  // Insert / update learned_words (atomic transaction)
  const tx = sttDb.tx(() => {
    const existing = sttDb.getOne<{
      id: number; count: number; confidence: number; vote_count: number;
      user_ids: string; status: string;
    }>(`SELECT id, count, confidence, vote_count, user_ids, status FROM learned_words WHERE word = ?`, [w]);

    let newCount: number;
    let newConfidence: number;
    let newVoteCount: number;
    let newUserIds: string[];
    let newStatus: string;

    if (existing) {
      // Update existing
      newCount = (existing.count || 0) + 1;
      newConfidence = ((existing.confidence || 0) * (newCount - 1) + confidence) / newCount;

      // Track unique userIds (vote_count)
      const existingUserIds: string[] = existing.user_ids ? JSON.parse(existing.user_ids) : [];
      newUserIds = [...new Set([...existingUserIds, ...(userId ? [userId] : [])])];
      newVoteCount = newUserIds.length;

      // Auto-promote status
      newStatus = existing.status;
      if (newStatus === 'candidate') {
        if (newVoteCount >= CONFIRM_VOTE_THRESHOLD || newCount >= CONFIRM_COUNT_THRESHOLD) {
          newStatus = 'confirmed';
        }
      }

      sttDb.run(
        `UPDATE learned_words
         SET count = ?, confidence = ?, vote_count = ?, user_ids = ?, status = ?, last_used_at = ?
         WHERE word = ?`,
        [newCount, newConfidence, newVoteCount, JSON.stringify(newUserIds), newStatus, now, w]
      );
    } else {
      // Insert new word
      newCount = 1;
      newConfidence = confidence;
      newVoteCount = userId ? 1 : 0;
      newUserIds = userId ? [userId] : [];
      newStatus = 'candidate';

      sttDb.run(
        `INSERT INTO learned_words (word, phonetic_variations, source, dataset_origin, confidence, count, vote_count, user_ids, status, created_at, last_used_at)
         VALUES (?, ?, ?, 'user-learned', ?, ?, ?, ?, ?, ?, ?)`,
        [w, variationsJson, source, confidence, newCount, newVoteCount, JSON.stringify(newUserIds), newStatus, now, now]
      );
    }

    return { newCount, newVoteCount, newStatus, newConfidence };
  });

  const { newCount, newVoteCount, newStatus } = tx();

  // Track co-occurrence (async, don't block response)
  try {
    trackCooccurrence(w, contextBefore, contextAfter);
  } catch (e) {
    console.warn('[learn-word] cooccurrence tracking failed:', e);
  }

  // Merge phonetic variations into phonetic-map.json (only for confirmed words)
  let variationsAdded = 0;
  if (newStatus === 'confirmed') {
    variationsAdded = await mergeIntoPhoneticMap(w);

    // Reset dict cache so isKnown() picks up the new confirmed word
    if (variationsAdded > 0) {
      try {
        resetDictionaryCache();
      } catch (e) {
        console.warn('[learn-word] could not reset cache:', e);
      }
    }
  }

  return {
    learned: true,
    variations: variationsAdded,
    word: w,
    count: newCount,
    status: newStatus,
    voteCount: newVoteCount,
  };
}

/**
 * Merge a word's phonetic variations into phonetic-map.json.
 * Idempotent — only for confirmed words.
 */
async function mergeIntoPhoneticMap(word: string): Promise<number> {
  const w = word.toLowerCase().trim();
  if (!w) return 0;

  const candidates = [
    join(process.cwd(), 'backend', 'data', 'phonetic-map.json'),
    '/root/lina-learning/backend/data/phonetic-map.json',
    join(process.cwd(), 'phonetic-map.json'),
  ];
  let phoneticPath = '';
  for (const p of candidates) {
    if (existsSync(p)) { phoneticPath = p; break; }
  }
  if (!phoneticPath) return 0;

  try {
    const raw = readFileSync(phoneticPath, 'utf-8');
    const ph = JSON.parse(raw);

    if (!ph.learned_words) ph.learned_words = {};
    if (!ph.phonetic_tickers) ph.phonetic_tickers = {};

    const variations = expandPhoneticVariations(w);
    let added = 0;

    if (!ph.phonetic_tickers[w]) {
      ph.phonetic_tickers[w] = w;
      added++;
    }
    for (const variant of variations) {
      if (!ph.phonetic_tickers[variant]) {
        ph.phonetic_tickers[variant] = w;
        added++;
      }
    }
    ph.learned_words[w] = {
      variations: variations.length + 1,
      addedAt: new Date().toISOString(),
    };

    ph._v = '4.0-auto-learning-sqlite';
    const existingSource = ph._s || '';
    if (!existingSource.includes('sqlite')) {
      ph._s = (existingSource + ' + sqlite').replace(/^\s*\+\s*/, '');
    }

    if (added > 0) {
      writeFileSync(phoneticPath, JSON.stringify(ph, null, 2));
      console.log(`[learn-word] ✓ Added ${added} phonetic variations for "${w}" (status=confirmed)`);
    }
    return added;
  } catch (e) {
    console.error('[learn-word] phonetic-map merge failed:', e);
    return 0;
  }
}

/**
 * Get all learned words from SQLite (for UI display).
 */
export async function getLearnedWords(limit: number = 100, offset: number = 0): Promise<{
  words: Array<{
    id: number;
    word: string;
    phonetic_variations: string[];
    source: string;
    confidence: number;
    count: number;
    vote_count: number;
    status: string;
    created_at: string;
    last_used_at: string;
  }>;
  total: number;
}> {
  const totalRow = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM learned_words`);
  const total = totalRow?.c ?? 0;

  const rows = sttDb.getAll<{
    id: number;
    word: string;
    phonetic_variations: string;
    source: string;
    confidence: number;
    count: number;
    vote_count: number;
    status: string;
    created_at: string;
    last_used_at: string;
  }>(
    `SELECT id, word, phonetic_variations, source, confidence, count, vote_count, status, created_at, last_used_at
     FROM learned_words
     ORDER BY last_used_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return {
    words: (rows || []).map(r => ({
      ...r,
      phonetic_variations: r.phonetic_variations ? JSON.parse(r.phonetic_variations) : [],
    })),
    total,
  };
}

/**
 * Delete a learned word by id.
 */
export async function deleteLearnedWord(id: number): Promise<{ deleted: boolean; word?: string }> {
  const row = sttDb.getOne<{ word: string }>(
    `SELECT word FROM learned_words WHERE id = ?`, [id]
  );
  if (!row) return { deleted: false };

  const word = row.word;
  sttDb.run(`DELETE FROM learned_words WHERE id = ?`, [id]);
  sttDb.run(`DELETE FROM word_cooccurrence WHERE word = ? OR context_word = ?`, [word, word]);

  // Clean phonetic-map.json
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
        for (const key of Object.keys(ph.phonetic_tickers)) {
          if (ph.phonetic_tickers[key] === word) delete ph.phonetic_tickers[key];
        }
      }
      if (ph.learned_words) delete ph.learned_words[word];
      writeFileSync(phoneticPath, JSON.stringify(ph, null, 2));
      try { resetDictionaryCache(); } catch {}
    } catch (e) {
      console.error('[learn-word] phonetic-map clean failed:', e);
    }
  }

  return { deleted: true, word };
}

/**
 * Get count of learned words — for stats display.
 */
export async function getLearnedWordsStats(): Promise<{
  total: number;
  confirmed: number;
  candidates: number;
}> {
  const totalRow = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM learned_words`);
  const confirmedRow = sttDb.getOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM learned_words WHERE status = 'confirmed'`
  );
  const total = totalRow?.c ?? 0;
  const confirmed = confirmedRow?.c ?? 0;
  return {
    total,
    confirmed,
    candidates: total - confirmed,
  };
}

/**
 * Get DB stats — for admin panel.
 */
export async function getDbStats(): Promise<{
  learnedWords: { total: number; confirmed: number; candidates: number; rejected: number };
  cooccurrence: { total: number; uniqueWords: number };
  userCorrections: { total: number; pending: number };
}> {
  const lwTotal = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM learned_words`)?.c ?? 0;
  const lwConfirmed = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM learned_words WHERE status = 'confirmed'`)?.c ?? 0;
  const lwRejected = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM learned_words WHERE status = 'rejected'`)?.c ?? 0;
  const coTotal = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM word_cooccurrence`)?.c ?? 0;
  const coUniqueWords = sttDb.getOne<{ c: number }>(`SELECT COUNT(DISTINCT word) as c FROM word_cooccurrence`)?.c ?? 0;
  const ucTotal = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM user_corrections`)?.c ?? 0;
  const ucPending = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM user_corrections WHERE accepted = 0`)?.c ?? 0;

  return {
    learnedWords: {
      total: lwTotal,
      confirmed: lwConfirmed,
      candidates: lwTotal - lwConfirmed - lwRejected,
      rejected: lwRejected,
    },
    cooccurrence: {
      total: coTotal,
      uniqueWords: coUniqueWords,
    },
    userCorrections: {
      total: ucTotal,
      pending: ucPending,
    },
  };
}

/**
 * Record user correction (when user manually edits transcript word).
 * Used for feedback loop — high-quality corrections that override fuzzy-match.
 */
export async function recordUserCorrection(
  originalWord: string,
  correctedWord: string,
  contextBefore: string[] = [],
  contextAfter: string[] = [],
  fullSentence: string | null,
  userId: string | null,
): Promise<{ recorded: boolean; voteId: number | null }> {
  const original = originalWord.toLowerCase().trim();
  const corrected = correctedWord.toLowerCase().trim();
  if (!original || !corrected || original === corrected) {
    return { recorded: false, voteId: null };
  }

  const tx = sttDb.tx(() => {
    const result = sttDb.run(
      `INSERT INTO user_corrections
       (original_word, corrected_word, context_before, context_after, full_sentence, user_id, user_weight, accepted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      [
        original,
        corrected,
        contextBefore.join(' '),
        contextAfter.join(' '),
        fullSentence,
        userId,
        1.0, // default weight; admin bisa bump
      ]
    );
    const voteId = Number(result.lastInsertRowid);

    // Update correction_summary
    sttDb.run(
      `INSERT INTO correction_summary (original_word, corrected_word, total_votes, weighted_votes, last_voted_at)
       VALUES (?, ?, 1, 1.0, datetime('now'))
       ON CONFLICT(original_word, corrected_word)
       DO UPDATE SET total_votes = total_votes + 1, weighted_votes = weighted_votes + 1.0, last_voted_at = datetime('now')`,
      [original, corrected]
    );

    return voteId;
  });

  const voteId = tx();
  return { recorded: true, voteId };
}

/**
 * Get correction summary for an original word (used by context-aware correction).
 */
export function getCorrectionVotes(originalWord: string): Array<{
  corrected_word: string;
  total_votes: number;
  weighted_votes: number;
}> {
  const w = originalWord.toLowerCase().trim();
  return sttDb.getAll<{
    corrected_word: string;
    total_votes: number;
    weighted_votes: number;
  }>(
    `SELECT corrected_word, total_votes, weighted_votes
     FROM correction_summary
     WHERE original_word = ?
     ORDER BY weighted_votes DESC`,
    [w]
  );
}

/**
 * Get co-occurrence stats for a word (used by context-aware correction).
 */
export function getCooccurrence(
  word: string,
  position: 'before' | 'after',
): Array<{ context_word: string; distance: number; count: number }> {
  const w = word.toLowerCase().trim();
  return sttDb.getAll<{
    context_word: string; distance: number; count: number;
  }>(
    `SELECT context_word, distance, count
     FROM word_cooccurrence
     WHERE word = ? AND position = ?
     ORDER BY count DESC
     LIMIT 20`,
    [w, position]
  );
}

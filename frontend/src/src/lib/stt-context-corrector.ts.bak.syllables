/**
 * stt-context-corrector.ts — context-aware STT correction.
 *
 * PROBLEM:
 *   STT (Whisper / WebSpeech / OCR) frequently confuses sound-alike pairs
 *   like Indonesian "produksi" ↔ "solusi", "kandelistik" ↔ "candlestick",
 *   "goceh" ↔ "goseh". Pure phonetic / Levenshtein matching returns BOTH
 *   candidates with similar scores — we can't pick the right one without
 *   looking at the surrounding words.
 *
 * APPROACH (Bayesian-ish, with smoothing):
 *   For an unknown token T at position i with context
 *     C_before = tokens[i-3 .. i-1], C_after = tokens[i+1 .. i+3],
 *   and candidate set K(T) = {phonetic-matched known words},
 *   pick the candidate k* that maximizes:
 *
 *     score(k) = w_phon * phoneticSim(T, k)            [0..1]
 *              + w_ctx  * contextScore(k, C)            [0..1]  (P(C | k))
 *              + w_vote * voteScore(T, k)               [0..1]
 *              + w_freq * freqScore(k)                  [0..1]
 *
 *   Default weights: phon=0.3, ctx=0.4, vote=0.2, freq=0.1
 *   (context dominates after enough observations; phonetic always provides
 *    a strong prior to avoid wild substitutions.)
 *
 * COLD-START:
 *   When a word has zero cooccurrence observations, contextScore=0 and we
 *   fall back to phonetic + vote + freq. Laplace smoothing inside
 *   contextScore() means even a single observation gives a non-zero bump
 *   to other candidates with shared context words.
 *
 * VOTES:
 *   Each user correction (original_word → corrected_word) is a row in
 *   `user_corrections`. We aggregate via `correction_summary` (kept up-to-date
 *   transactionally on each insert). voteScore = weighted_votes / max_votes
 *   for that original_word, so the dominant correction approaches 1.0.
 *
 * FEEDBACK LOOP:
 *   After producing a correction, we OBSERVE it: increment cooccurrence
 *   counts for the corrected word + its surrounding tokens. This grows the
 *   context model over time → future corrections become more accurate.
 *
 * USAGE:
 *   import { contextAwareCorrect } from '@/lib/stt-context-corrector';
 *   const { text, corrections, observed } = contextAwareCorrect(rawText, {
 *     userId: session?.user?.id ?? null,
 *     recordObservations: true,
 *   });
 */

import { sttDb, type LearnedWordRow, type CooccurrenceRow, type CorrectionSummaryRow } from '@/lib/stt-db';
import { getPhoneticCodes, phoneticMatch } from '@/lib/phonetic-engine';

// ── Scoring weights (tunable) ──────────────────────────────────────────────
export interface CorrectionWeights {
  phonetic: number;
  context:  number;
  vote:     number;
  freq:     number;
}
export const DEFAULT_WEIGHTS: CorrectionWeights = {
  phonetic: 0.30,
  context:  0.40,
  vote:     0.20,
  freq:     0.10,
};

/** Minimum total score to accept a correction (otherwise leave token alone). */
export const DEFAULT_ACCEPT_THRESHOLD = 0.45;
/** Minimum margin between top-1 and top-2 to declare a confident pick. */
export const CONFIDENT_MARGIN = 0.15;
/** Laplace smoothing constant (α in P(context | word) = (count + α) / (total + αV)). */
export const SMOOTHING_ALPHA = 0.1;
/** Max distance (in tokens) to consider for context window. */
export const CONTEXT_WINDOW = 3;
/** Min token length to attempt correction on (skip "di", "ke", "ya"). */
export const MIN_TOKEN_LEN = 3;

// ── Types ──────────────────────────────────────────────────────────────────
export interface CorrectionDecision {
  index: number;
  original: string;
  corrected: string;
  score: number;
  confident: boolean;
  components: {
    phonetic: number;
    context:  number;
    vote:     number;
    freq:     number;
  };
  candidates: Array<{ word: string; score: number }>;
}

export interface CorrectionResult {
  text: string;
  corrections: CorrectionDecision[];
  observed: number;           // cooccurrence observations recorded
  needsReview: boolean;       // at least one low-confidence correction
}

export interface CorrectOptions {
  userId?: string | null;
  source?: string;             // 'webspeech' | 'whisper' | 'ocr' | 'cv' | 'manual'
  weights?: Partial<CorrectionWeights>;
  acceptThreshold?: number;
  recordObservations?: boolean; // default true
  personalDict?: Set<string>;   // treated as known words (skip correction)
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Split text into tokens + their character offsets (for reassembly). */
function tokenize(text: string): { token: string; start: number; end: number }[] {
  const out: { token: string; start: number; end: number }[] = [];
  // \p{L} = any unicode letter; \p{N} = any number. 'u' flag = unicode mode.
  const re = /[\p{L}\p{N}]+(?:[''-][\p{L}\p{N}]+)*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Levenshtein with early-exit on max distance (for speed). */
function levenshtein(a: string, b: string, maxDist: number = 3): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  const dp = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      const cur = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = dp[j];
      dp[j] = cur;
      if (cur < rowMin) rowMin = cur;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[lb];
}

/** Phonetic similarity in [0,1] — 1 = identical code, 0 = no overlap. */
function phoneticSim(token: string, candidate: string): number {
  const t = getPhoneticCodes(token);
  const c = getPhoneticCodes(candidate);
  // exact primary-code match → 1.0
  if (t[0] === c[0]) return 1.0;
  // any code overlap → 0.7
  for (const tc of t) if (c.includes(tc)) return 0.7;
  // fallback: normalized Levenshtein
  const d = levenshtein(token.toLowerCase(), candidate.toLowerCase(), 3);
  const maxLen = Math.max(token.length, candidate.length);
  return Math.max(0, 1 - d / maxLen);
}

// ── Candidate generation ──────────────────────────────────────────────────

interface Candidate {
  word: string;
  fromPhonetic: boolean;
}

/**
 * Get fuzzy candidates for an unknown token:
 *   1. Direct phonetic match (Double Metaphone)
 *   2. learned_words whose phonetic_code matches one of the token's codes
 *   3. learned_words containing the token in their phonetic_variations JSON
 *   4. Token itself as a candidate (no-op)
 *
 * Returns de-duplicated list.
 */
function getCandidates(token: string): Candidate[] {
  const out = new Map<string, Candidate>();
  const tl = token.toLowerCase();

  // 1. Built-in phonetic dictionary (financial / science terms)
  const pm = phoneticMatch(tl);
  if (pm) out.set(pm.toLowerCase(), { word: pm, fromPhonetic: true });

  // 2. learned_words indexed by phonetic_code
  const codes = getPhoneticCodes(tl);
  for (const code of codes) {
    const rows = sttDb.getAll<Pick<LearnedWordRow, 'word' | 'status'>>(
      `SELECT word, status FROM learned_words
       WHERE phonetic_code = ? AND status IN ('confirmed','candidate')`,
      [code]
    );
    for (const r of rows) out.set(r.word.toLowerCase(), { word: r.word, fromPhonetic: true });
  }

  // 3. learned_words whose phonetic_variations JSON contains this token
  //    (uses json_each() — fast with proper index, but small N here so fine)
  try {
    const rows = sttDb.getAll<Pick<LearnedWordRow, 'word'>>(
      `SELECT DISTINCT word FROM learned_words
       WHERE status IN ('confirmed','candidate')
         AND EXISTS (SELECT 1 FROM json_each(phonetic_variations) WHERE json_each.value = ?)`,
      [tl]
    );
    for (const r of rows) out.set(r.word.toLowerCase(), { word: r.word, fromPhonetic: true });
  } catch {
    // json_each may fail if phonetic_variations is malformed; skip.
  }

  return [...out.values()];
}

// ── Context scoring (the meat) ──────────────────────────────────────────────

/**
 * contextScore(k, C_before, C_after) — estimates P(C | k), the probability
 * of observing context C given that the word is k.
 *
 * Strategy:
 *   For each context word w at distance d (1..3) before/after k:
 *     lookup count = cooccur[k, w, position, d]
 *     lookup total = Σ count(k, *, *, *)
 *     P(w | k, pos, d) = (count + α) / (total + α·V)        [Laplace smoothing]
 *     weighted contribution = (1/d) * P(w | k, pos, d)
 *   contextScore = Σ weighted / Σ (1/d)
 *
 * α = SMOOTHING_ALPHA, V = effective vocab size (we use 10000 as a constant
 * prior — true vocab is unknown and this is just smoothing).
 */
function computeContextScore(
  candidate: string,
  contextBefore: string[],
  contextAfter: string[],
): number {
  const w_lower = candidate.toLowerCase();
  const VOCAB_PRIOR = 10000;

  // One-shot lookup: total cooccurrence count for this word
  const totalRow = sttDb.getOne<{ t: number }>(
    `SELECT COALESCE(SUM(count), 0) AS t FROM word_cooccurrence WHERE word = ?`,
    [w_lower]
  );
  const totalCount = totalRow?.t ?? 0;

  // Cache per (position, distance) lookups
  const lookup = (word: string, position: 'before' | 'after', distance: number): number => {
    const r = sttDb.getOne<{ c: number }>(
      `SELECT count AS c FROM word_cooccurrence
       WHERE word = ? AND context_word = ? AND position = ? AND distance = ?`,
      [w_lower, word.toLowerCase(), position, distance]
    );
    return r?.c ?? 0;
  };

  let sumWeighted = 0;
  let sumWeights = 0;

  // contextBefore is ordered oldest → newest; the LAST element is at distance 1
  for (let i = 0; i < contextBefore.length; i++) {
    const distance = contextBefore.length - i;     // 1, 2, 3 ...
    const w = contextBefore[i].toLowerCase();
    const cnt = lookup(w, 'before', distance);
    const p = (cnt + SMOOTHING_ALPHA) / (totalCount + SMOOTHING_ALPHA * VOCAB_PRIOR);
    const weight = 1.0 / distance;
    sumWeighted += weight * p;
    sumWeights += weight;
  }

  // contextAfter is ordered newest first (token[i+1] is closest)
  for (let i = 0; i < contextAfter.length; i++) {
    const distance = i + 1;     // 1, 2, 3 ...
    const w = contextAfter[i].toLowerCase();
    const cnt = lookup(w, 'after', distance);
    const p = (cnt + SMOOTHING_ALPHA) / (totalCount + SMOOTHING_ALPHA * VOCAB_PRIOR);
    const weight = 1.0 / distance;
    sumWeighted += weight * p;
    sumWeights += weight;
  }

  if (sumWeights === 0) return 0;
  // Normalize so max possible (all P=1) → 1.0
  return sumWeighted / sumWeights;
}

// ── Vote scoring (from correction_summary) ────────────────────────────────

/**
 * voteScore(original, candidate) — fraction of weighted votes that went to
 * this candidate among all votes for original_word. Returns 0 if no votes.
 *
 * Looks up `correction_summary` (maintained by recordCorrection()).
 */
function voteScore(original: string, candidate: string): number {
  const orig = original.toLowerCase();
  const corr = candidate.toLowerCase();
  const rows = sttDb.getAll<Pick<CorrectionSummaryRow, 'corrected_word' | 'weighted_votes'>>(
    `SELECT corrected_word, weighted_votes FROM correction_summary
     WHERE original_word = ? ORDER BY weighted_votes DESC`,
    [orig]
  );
  if (rows.length === 0) return 0;
  const totalW = rows.reduce((s, r) => s + r.weighted_votes, 0);
  if (totalW === 0) return 0;
  const hit = rows.find(r => r.corrected_word.toLowerCase() === corr);
  return hit ? hit.weighted_votes / totalW : 0;
}

// ── Frequency scoring (how common is this word in observed speech) ──────────

function freqScore(candidate: string): number {
  const r = sttDb.getOne<{ c: number; max: number }>(
    `SELECT count AS c, (SELECT MAX(count) FROM learned_words WHERE status IN ('confirmed','candidate')) AS max
     FROM learned_words
     WHERE word = ? AND status IN ('confirmed','candidate')`,
    [candidate.toLowerCase()]
  );
  if (!r || !r.max || r.max === 0) return 0;
  // Logarithmic so the most-common word saturates at 1.0 without drowning rare ones
  return Math.log(1 + r.c) / Math.log(1 + r.max);
}

// ── Observation recording (the feedback loop) ─────────────────────────────

/**
 * Record cooccurrence observations for a corrected word + its context.
 * Each (word, context_word, position, distance) gets +1 in word_cooccurrence.
 *
 * Wrapped in a transaction so partial observations don't leak.
 */
function recordObservations(
  correctedTokens: string[],
  startIndex: number,
  endIndex: number,
): number {
  // Only consider a window of CONTEXT_WINDOW*2+1 around the corrected region
  const lo = Math.max(0, startIndex - CONTEXT_WINDOW);
  const hi = Math.min(correctedTokens.length - 1, endIndex + CONTEXT_WINDOW);

  const upsert = sttDb.prepare(
    `INSERT INTO word_cooccurrence (word, context_word, position, distance, count, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(word, context_word, position, distance)
     DO UPDATE SET count = count + 1, updated_at = datetime('now')`
  );

  let observations = 0;
  const tx = sttDb.tx(() => {
    for (let i = startIndex; i <= endIndex; i++) {
      const w = correctedTokens[i].toLowerCase();
      if (!w || w.length < MIN_TOKEN_LEN) continue;
      for (let d = 1; d <= CONTEXT_WINDOW; d++) {
        const beforeIdx = i - d;
        const afterIdx = i + d;
        if (beforeIdx >= lo) {
          const ctx = correctedTokens[beforeIdx].toLowerCase();
          if (ctx.length >= MIN_TOKEN_LEN) {
            upsert.run(w, ctx, 'before', d);
            observations++;
          }
        }
        if (afterIdx <= hi) {
          const ctx = correctedTokens[afterIdx].toLowerCase();
          if (ctx.length >= MIN_TOKEN_LEN) {
            upsert.run(w, ctx, 'after', d);
            observations++;
          }
        }
      }
    }
  });
  tx();
  return observations;
}

// ── Public: record a user-initiated correction (vote) ───────────────────────

/**
 * Insert a user correction (vote) and update the aggregated correction_summary
 * in the same transaction.
 *
 * userWeight defaults to 1.0; pass a higher value for trusted users
 * (e.g., admins, high-XP users — formula TBD by caller).
 */
export function recordCorrection(args: {
  originalWord: string;
  correctedWord: string;
  contextBefore?: string[];   // up to 3 words, oldest → newest
  contextAfter?: string[];    // up to 3 words, newest first
  fullSentence?: string;
  userId?: string | null;
  userWeight?: number;
}): { voteId: number; totalVotes: number } {
  const {
    originalWord, correctedWord,
    contextBefore = [], contextAfter = [],
    fullSentence = null,
    userId = null, userWeight = 1.0,
  } = args;

  const tx = sttDb.tx(() => {
    const r = sttDb.run(
      `INSERT INTO user_corrections
         (original_word, corrected_word, context_before, context_after, full_sentence, user_id, user_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [originalWord.toLowerCase(), correctedWord.toLowerCase(),
       contextBefore.join(' ') || null,
       contextAfter.join(' ') || null,
       fullSentence, userId, userWeight]
    );
    const voteId = Number(r.lastInsertRowid);

    // Update summary
    sttDb.run(
      `INSERT INTO correction_summary (original_word, corrected_word, total_votes, weighted_votes, last_voted_at)
       VALUES (?, ?, 1, ?, datetime('now'))
       ON CONFLICT(original_word, corrected_word)
       DO UPDATE SET
         total_votes    = total_votes + 1,
         weighted_votes = weighted_votes + ?,
         last_voted_at  = datetime('now')`,
      [originalWord.toLowerCase(), correctedWord.toLowerCase(), userWeight, userWeight]
    );

    // Also: if this word isn't in learned_words yet, add it as a candidate
    sttDb.run(
      `INSERT INTO learned_words (word, phonetic_variations, phonetic_code, source, confidence, count, status)
       VALUES (?, '[]', ?, 'manual', 0.0, 1, 'candidate')
       ON CONFLICT(word) DO UPDATE SET last_used_at = datetime('now')`,
      [correctedWord.toLowerCase(), getPhoneticCodes(correctedWord.toLowerCase())[0] || '']
    );

    return voteId;
  });
  const voteId = tx();

  const total = sttDb.getOne<{ t: number }>(
    `SELECT COALESCE(SUM(total_votes), 0) AS t FROM correction_summary WHERE original_word = ?`,
    [originalWord.toLowerCase()]
  );
  return { voteId, totalVotes: total?.t ?? 0 };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * contextAwareCorrect — main correction pipeline.
 *
 * Returns corrected text + per-token decisions + observation count.
 * Reassembly preserves original whitespace/punctuation by using token
 * offsets (we splice in corrections at character positions).
 */
export function contextAwareCorrect(
  text: string,
  opts: CorrectOptions = {},
): CorrectionResult {
  if (!text || text.trim().length === 0) {
    return { text, corrections: [], observed: 0, needsReview: false };
  }

  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const acceptThreshold = opts.acceptThreshold ?? DEFAULT_ACCEPT_THRESHOLD;
  const personalDict = opts.personalDict ?? new Set<string>();
  const recordObs = opts.recordObservations ?? true;

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { text, corrections: [], observed: 0, needsReview: false };
  }

  const plainTokens = tokens.map(t => t.token);
  const decisions: CorrectionDecision[] = [];
  const correctedSpans: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < plainTokens.length; i++) {
    const tok = plainTokens[i];

    // Skip short tokens, numbers, or words in personalDict
    if (tok.length < MIN_TOKEN_LEN) continue;
    if (/^\d+$/.test(tok)) continue;
    if (personalDict.has(tok.toLowerCase())) continue;

    // If token is already a known word in learned_words → skip
    const known = sttDb.getOne<{ id: number }>(
      `SELECT id FROM learned_words WHERE word = ? AND status IN ('confirmed','candidate')`,
      [tok.toLowerCase()]
    );
    if (known) continue;

    // Build context window
    const contextBefore: string[] = [];
    for (let j = Math.max(0, i - CONTEXT_WINDOW); j < i; j++) {
      contextBefore.push(plainTokens[j]);
    }
    const contextAfter: string[] = [];
    for (let j = i + 1; j < Math.min(plainTokens.length, i + 1 + CONTEXT_WINDOW); j++) {
      contextAfter.push(plainTokens[j]);
    }

    // Get candidates
    const candidates = getCandidates(tok);
    if (candidates.length === 0) continue;

    // Score each candidate
    const scored = candidates.map(c => {
      const phon = phoneticSim(tok, c.word);
      const ctx  = computeContextScore(c.word, contextBefore, contextAfter);
      const vote = voteScore(tok, c.word);
      const freq = freqScore(c.word);
      const total =
        weights.phonetic * phon +
        weights.context  * ctx  +
        weights.vote     * vote +
        weights.freq     * freq;
      return {
        word: c.word,
        score: total,
        components: { phonetic: phon, context: ctx, vote, freq },
      };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best) continue;
    if (best.score < acceptThreshold) continue;
    // Don't correct to a word identical to the token (case-insensitive)
    if (best.word.toLowerCase() === tok.toLowerCase()) continue;

    const confident = !second || (best.score - second.score) >= CONFIDENT_MARGIN;

    decisions.push({
      index: i,
      original: tok,
      corrected: best.word,
      score: best.score,
      confident,
      components: best.components,
      candidates: scored.slice(0, 5).map(s => ({ word: s.word, score: s.score })),
    });

    // Stage replacement (preserve case of original if it was Capitalized)
    const isCapital = /^[A-Z]/.test(tok);
    const replacement = isCapital
      ? best.word.charAt(0).toUpperCase() + best.word.slice(1)
      : best.word;
    correctedSpans.push({ start: tokens[i].start, end: tokens[i].end, replacement });

    // Also update plainTokens so context for subsequent tokens reflects the correction
    plainTokens[i] = replacement;
  }

  // Reassemble text by splicing replacements
  let resultText = text;
  // Apply spans in REVERSE order so offsets don't shift
  for (let k = correctedSpans.length - 1; k >= 0; k--) {
    const s = correctedSpans[k];
    resultText = resultText.slice(0, s.start) + s.replacement + resultText.slice(s.end);
  }

  // Record cooccurrence observations for the corrected text
  let observed = 0;
  if (recordObs && decisions.length > 0) {
    // Record observations around each corrected index
    // (wrap all in ONE transaction for efficiency)
    const indices = decisions.map(d => d.index);
    const minIdx = Math.min(...indices);
    const maxIdx = Math.max(...indices);
    observed = recordObservations(plainTokens, minIdx, maxIdx);
  }

  const needsReview = decisions.some(d => !d.confident);
  return {
    text: resultText,
    corrections: decisions,
    observed,
    needsReview,
  };
}

// ── Maintenance: promote / demote learned_words status ──────────────────────

/**
 * Promote a learned_word from 'candidate' to 'confirmed' if it has enough
 * votes. Call this on a cron or after each Nth correction.
 */
export function promoteConfirmed(minVotes: number = 3, minCount: number = 2): number {
  const r = sttDb.run(
    `UPDATE learned_words
     SET status = 'confirmed'
     WHERE status = 'candidate'
       AND vote_count >= ?
       AND count >= ?`,
    [minVotes, minCount]
  );
  return r.changes;
}

/**
 * Demote a word to 'rejected' (e.g., admin flagged it as a false positive).
 * Optionally remove its phonetic variations from future matching by setting
 * status — but keep the row for audit.
 */
export function rejectWord(word: string): boolean {
  const r = sttDb.run(
    `UPDATE learned_words SET status = 'rejected' WHERE word = ?`,
    [word.toLowerCase()]
  );
  return r.changes > 0;
}

// ── Diagnostic helpers (for admin UI + tests) ─────────────────────────────

export function getDbStats(): {
  learnedWords: number;
  confirmed: number;
  candidates: number;
  rejected: number;
  cooccurrences: number;
  corrections: number;
  pendingCorrections: number;
} {
  const one = (sql: string) => sttDb.getOne<{ c: number }>(sql)?.c ?? 0;
  return {
    learnedWords:        one(`SELECT COUNT(*) AS c FROM learned_words`),
    confirmed:           one(`SELECT COUNT(*) AS c FROM learned_words WHERE status = 'confirmed'`),
    candidates:          one(`SELECT COUNT(*) AS c FROM learned_words WHERE status = 'candidate'`),
    rejected:            one(`SELECT COUNT(*) AS c FROM learned_words WHERE status = 'rejected'`),
    cooccurrences:       one(`SELECT COUNT(*) AS c FROM word_cooccurrence`),
    corrections:         one(`SELECT COUNT(*) AS c FROM user_corrections`),
    pendingCorrections:  one(`SELECT COUNT(*) AS c FROM user_corrections WHERE accepted = 0`),
  };
}

/** Get the top co-occurrence pairs for a word (for debugging context model). */
export function debugCooccurrences(word: string, limit = 20): CooccurrenceRow[] {
  return sttDb.getAll<CooccurrenceRow>(
    `SELECT * FROM word_cooccurrence
     WHERE word = ?
     ORDER BY count DESC
     LIMIT ?`,
    [word.toLowerCase(), limit]
  );
}

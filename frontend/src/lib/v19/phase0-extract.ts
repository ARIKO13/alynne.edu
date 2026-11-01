/**
 * Phase 0 Module — Concept Extraction + Content Type Classifier + Topic Boundaries
 *
 * v19 new feature. Runs BEFORE Phase 1 filter. Output is cached in D1 phase0_cache
 * (30-day TTL, keyed by transcript_hash) for instant re-run.
 *
 * Output schema:
 * {
 *   concepts: [{ concept: string, core: boolean, frequency: number }],
 *   content_type: 'lecture' | 'tutorial' | 'interview' | 'debate' | 'documentary' | 'qna' | 'storytelling',
 *   topic_boundaries: [{ start_char: number, end_char: number, topic_label: string }],
 *   n_concepts: number,
 *   n_core: number,
 *   token_count_estimate: number
 * }
 *
 * This output drives the adaptive bab count formula:
 *   base = max(n_concepts / 1.5, n_core)
 *   adjusted = base * multiplier[content_type]
 *   final = clamp(adjusted, lo, hi)  // lo/hi from token_count_estimate
 */
import type { APIContext } from 'astro';
import { callLLM, safeParseJson } from '@/lib/gateway-client';

// ============================================================
// CONTENT TYPE MULTIPLIERS
// ============================================================
export const CONTENT_TYPE_MULTIPLIERS: Record<string, number> = {
  lecture: 1.0,
  tutorial: 1.3,
  interview: 0.8,
  debate: 0.7,
  documentary: 1.1,
  qna: 0.9,
  storytelling: 1.0,
};

// ============================================================
// TOKEN BUDGET → (lo, hi) for bab count clamping
// ============================================================
export function tokenBudget(tokenCount: number): { lo: number; hi: number } {
  if (tokenCount < 5000) return { lo: 3, hi: 8 };
  if (tokenCount < 15000) return { lo: 5, hi: 12 };
  if (tokenCount < 30000) return { lo: 8, hi: 15 };
  return { lo: 12, hi: 20 };
}

// ============================================================
// ADAPTIVE BAB COUNT FORMULA
// ============================================================
export function computeBabCount(
  nConcepts: number,
  nCore: number,
  contentType: string,
  tokenCount: number,
): number {
  const multiplier = CONTENT_TYPE_MULTIPLIERS[contentType] ?? 1.0;
  const base = Math.max(nConcepts / 1.5, nCore);
  const adjusted = base * multiplier;
  const { lo, hi } = tokenBudget(tokenCount);
  const clamped = Math.max(lo, Math.min(hi, adjusted));
  return Math.round(clamped);
}

// ============================================================
// ADAPTIVE QUIZ COUNT PER BAB
// ============================================================
export function quizCountPerBab(babTokenCount: number): number {
  if (babTokenCount < 500) return 2;
  if (babTokenCount < 1500) return 3;
  if (babTokenCount < 3000) return 5;
  if (babTokenCount < 5000) return 7;
  return 10;
}

// ============================================================
// PHASE 0 PROMPT — Single LLM call extracts all metadata
// ============================================================
const PHASE0_PROMPT = `Anda adalah analyzer transkrip video edukasi. Analisis transkrip berikut dan ekstrak:

1. CONCEPTS — daftar konsep/istilah penting yang muncul. Untuk tiap konsep:
   - concept: nama konsep (lowercase, singkat)
   - core: true kalau konsep inti yang WAJIB dibahas di materi, false kalau pendukung
   - frequency: berapa kali muncul di transkrip (estimasi)

2. CONTENT_TYPE — tipe konten video, pilih salah satu:
   - lecture: kuliah dosen, presentasi akademik, Khan Academy style
   - tutorial: step-by-step how-to (coding, makeup, masak, dll)
   - interview: wawancara, podcast, talk show
   - debate: diskusi panel, debat politik
   - documentary: narasi documentary, National Geographic style
   - qna: Q&A session, AMA
   - storytelling: audiobook, narasi sejarah/cerita

3. TOPIC_BOUNDARIES — pecah transkrip jadi topik-topik utama. Untuk tiap topik:
   - start_char: posisi karakter awal di transkrip
   - end_char: posisi karakter akhir
   - topic_label: judul singkat topik (max 6 kata)

4. N_CONCEPTS — total jumlah konsep
5. N_CORE — jumlah konsep core (core=true)
6. TOKEN_COUNT_ESTIMATE — estimasi token transkrip (chars / 4)

OUTPUT JSON ONLY, format:
{
  "concepts": [{"concept":"...","core":true,"frequency":3}],
  "content_type": "lecture",
  "topic_boundaries": [{"start_char":0,"end_char":5000,"topic_label":"..."}],
  "n_concepts": 15,
  "n_core": 8,
  "token_count_estimate": 12000
}

Transkrip:
`;

// ============================================================
// MAIN: extractPhase0()
// ============================================================
export interface Phase0Result {
  concepts: { concept: string; core: boolean; frequency: number }[];
  content_type: string;
  topic_boundaries: { start_char: number; end_char: number; topic_label: string }[];
  n_concepts: number;
  n_core: number;
  token_count_estimate: number;
}

export interface Phase0CacheRow {
  transcript_hash: string;
  transcript_chars: number;
  concepts_json: string;
  content_type: string;
  topic_boundaries_json: string;
  n_concepts: number;
  n_core: number;
  token_count_estimate: number;
  model_used: string;
}

/**
 * Hash function (cyrb53) — same as used in StudyPipeline.tsx localStorage cache
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Get Phase 0 result from D1 cache, or null if not found / expired.
 */
async function getPhase0FromCache(transcriptHash: string): Promise<Phase0Result | null> {
  // Use d1-client to query phase0_cache
  // Implementation depends on existing d1-client.ts pattern
  try {
    const { default: d1Client } = await import('@/lib/d1-client');
    const result = await d1Client.query<Phase0CacheRow>(
      `SELECT * FROM phase0_cache
       WHERE transcript_hash = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       LIMIT 1`,
      [transcriptHash],
    );
    if (!result || result.length === 0) return null;
    const row = result[0];
    return {
      concepts: JSON.parse(row.concepts_json),
      content_type: row.content_type,
      topic_boundaries: JSON.parse(row.topic_boundaries_json),
      n_concepts: row.n_concepts,
      n_core: row.n_core,
      token_count_estimate: row.token_count_estimate,
    };
  } catch (err) {
    console.warn('[phase0] cache read failed:', err);
    return null;
  }
}

/**
 * Save Phase 0 result to D1 cache.
 */
async function savePhase0ToCache(
  transcript: string,
  transcriptHash: string,
  result: Phase0Result,
  modelUsed: string,
): Promise<void> {
  try {
    const { default: d1Client } = await import('@/lib/d1-client');
    await d1Client.query(
      `INSERT OR REPLACE INTO phase0_cache
       (transcript_hash, transcript_chars, concepts_json, content_type,
        topic_boundaries_json, n_concepts, n_core, token_count_estimate, model_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transcriptHash,
        transcript.length,
        JSON.stringify(result.concepts),
        result.content_type,
        JSON.stringify(result.topic_boundaries),
        result.n_concepts,
        result.n_core,
        result.token_count_estimate,
        modelUsed,
      ],
    );
    console.log(`[phase0] cached: hash=${transcriptHash.slice(0, 12)}... concepts=${result.n_concepts} type=${result.content_type}`);
  } catch (err) {
    console.warn('[phase0] cache write failed (non-blocking):', err);
  }
}

/**
 * Main Phase 0 entry point.
 * v19.1: NO D1 CACHE — always run LLM (LLM is free + fast, cache adds complexity).
 * If user uploads same transcript twice, they get fresh Phase 0 each time (always up-to-date).
 */
export async function extractPhase0(
  transcript: string,
  opts: { skipCache?: boolean } = {},
): Promise<{ result: Phase0Result; fromCache: boolean; durationMs: number }> {
  const t0 = Date.now();
  const transcriptHash = cyrb53(transcript).toString(36);

  // Truncate transcript for Phase 0 (avoid huge input)
  // Phase 0 needs overview, not full text. Cap at 30K chars.
  const truncated = transcript.length > 30000 ? transcript.slice(0, 30000) : transcript;

  console.log(`[phase0] extracting concepts from ${truncated.length} chars (hash=${transcriptHash.slice(0, 12)}...)`);

  const llmResult = await callLLM(
    'long',
    PHASE0_PROMPT,
    truncated,
    {
      model: 'ovh/Meta-Llama-3_3-70B-Instruct',
      fallbackModels: ['ovh/Mistral-Small-3.2-24B-Instruct-2506', 'ovh/gpt-oss-20b'],
      maxTokens: 4000,
      timeout: 120_000,
      temperature: 0.2,
      jsonMode: true,
      endpoint: `phase0/extract-${transcriptHash.slice(0, 8)}`,
    },
  );

  if (!llmResult.content) {
    throw new Error('[phase0] LLM returned empty content');
  }

  const parsed = safeParseJson(llmResult.content) as Phase0Result | null;
  if (!parsed || !parsed.concepts || !parsed.content_type) {
    throw new Error(`[phase0] LLM returned invalid JSON: ${llmResult.content.slice(0, 200)}`);
  }

  // Validate + sanitize
  const sanitized: Phase0Result = {
    concepts: Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 50) : [],
    content_type: CONTENT_TYPE_MULTIPLIERS[parsed.content_type] ? parsed.content_type : 'lecture',
    topic_boundaries: Array.isArray(parsed.topic_boundaries) ? parsed.topic_boundaries.slice(0, 20) : [],
    n_concepts: typeof parsed.n_concepts === 'number' ? parsed.n_concepts : parsed.concepts?.length || 0,
    n_core: typeof parsed.n_core === 'number' ? parsed.n_core : parsed.concepts?.filter((c: any) => c.core).length || 0,
    token_count_estimate: typeof parsed.token_count_estimate === 'number'
      ? parsed.token_count_estimate
      : Math.ceil(transcript.length / 4),
  };

  // v19.1: NO D1 CACHE — removed savePhase0ToCache call


  const durationMs = Date.now() - t0;
  console.log(`[phase0] extracted: ${sanitized.n_concepts} concepts (${sanitized.n_core} core), type=${sanitized.content_type}, ${sanitized.topic_boundaries.length} topics, ${durationMs}ms`);

  return { result: sanitized, fromCache: false, durationMs };
}

/**
 * Split transcript by topic_boundaries for chunked pass (transcripts >180 min).
 * Returns array of { topic_label, text } chunks.
 */
export function splitByTopicBoundaries(
  transcript: string,
  boundaries: { start_char: number; end_char: number; topic_label: string }[],
): { topic_label: string; text: string }[] {
  if (!boundaries || boundaries.length === 0) {
    return [{ topic_label: 'Full transcript', text: transcript }];
  }

  // Sort by start_char
  const sorted = [...boundaries].sort((a, b) => a.start_char - b.start_char);
  const chunks: { topic_label: string; text: string }[] = [];

  for (const b of sorted) {
    const start = Math.max(0, b.start_char);
    const end = Math.min(transcript.length, b.end_char);
    const text = transcript.slice(start, end).trim();
    if (text.length > 100) {
      chunks.push({ topic_label: b.topic_label, text });
    }
  }

  // If no valid chunks (all too short), return full transcript
  if (chunks.length === 0) {
    return [{ topic_label: 'Full transcript', text: transcript }];
  }

  return chunks;
}

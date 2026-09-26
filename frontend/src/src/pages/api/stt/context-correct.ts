import type { APIRoute } from 'astro';
import { contextAwareCorrect, recordCorrection, getDbStats } from '@/lib/stt-context-corrector';
import { sttDb } from '@/lib/stt-db';
import { getSession } from '@/lib/auth';

/**
 * POST /api/stt/context-correct
 *
 * Context-aware STT correction pipeline. Replaces (or extends) the older
 * /api/stt/fuzzy-correct endpoint with Bayesian-style scoring that uses
 * co-occurrence statistics from `word_cooccurrence` + user votes from
 * `user_corrections` to disambiguate ambiguous pairs like
 *   "produksi" ↔ "solusi"
 *
 * Body:
 *   {
 *     text: string,
 *     source?: 'webspeech' | 'whisper' | 'ocr' | 'cv' | 'manual',
 *     personalDict?: string[],          // user-confirmed words (skip correction)
 *     recordObservations?: boolean,     // default true - feed back into cooccurrence table
 *     weights?: { phonetic?, context?, vote?, freq? }  // tuning overrides
 *   }
 *
 * Response:
 *   {
 *     corrected: string,
 *     corrections: Array<{ index, original, corrected, score, confident, candidates }>,
 *     observed: number,                 // cooccurrence rows updated
 *     needsReview: boolean,             // low-confidence corrections need a human eye
 *     stats: {...}                      // global DB stats (for debugging)
 *   }
 *
 * POST /api/stt/context-correct?action=vote  - record an explicit user vote
 *   { originalWord, correctedWord, contextBefore?, contextAfter?, fullSentence? }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      source?: string;
      personalDict?: string[];
      recordObservations?: boolean;
      weights?: Partial<{ phonetic: number; context: number; vote: number; freq: number }>;
      action?: 'correct' | 'vote';
      // vote-only payload:
      originalWord?: string;
      correctedWord?: string;
      contextBefore?: string[];
      contextAfter?: string[];
      fullSentence?: string;
    };

    // ── Branch: explicit vote submission ────────────────────────────────
    if (body.action === 'vote') {
      if (!body.originalWord || !body.correctedWord) {
        return Response.json(
          { ok: false, error: 'originalWord + correctedWord required for vote action' },
          { status: 400 }
        );
      }
      const session = await getSession(request);
      const userId = session?.user?.id ?? null;
      // Optional: derive user weight from subscription tier / XP - left as 1.0 for now.
      const userWeight = 1.0;
      const { voteId, totalVotes } = recordCorrection({
        originalWord: body.originalWord,
        correctedWord: body.correctedWord,
        contextBefore: body.contextBefore,
        contextAfter: body.contextAfter,
        fullSentence: body.fullSentence,
        userId,
        userWeight,
      });
      return Response.json({ ok: true, voteId, totalVotes });
    }

    // ── Default branch: correction pipeline ──────────────────────────────
    const rawText = (body.text || '').trim();
    if (!rawText) {
      return Response.json({
        corrected: '',
        corrections: [],
        observed: 0,
        needsReview: false,
        stats: getDbStats(),
      });
    }

    const session = await getSession(request);
    const userId = session?.user?.id ?? null;

    const result = contextAwareCorrect(rawText, {
      userId,
      source: body.source ?? 'webspeech',
      recordObservations: body.recordObservations ?? true,
      personalDict: body.personalDict ? new Set(body.personalDict) : undefined,
      weights: body.weights,
    });

    return Response.json({
      corrected: result.text,
      corrections: result.corrections,
      observed: result.observed,
      needsReview: result.needsReview,
      stats: getDbStats(),
      source: body.source ?? 'unknown',
    });
  } catch (error) {
    console.error('[context-correct] error:', error);
    return Response.json(
      {
        corrected: '',
        error: error instanceof Error ? error.message : 'Context correction failed',
      },
      { status: 500 }
    );
  }
};

// ── GET endpoint: DB stats for admin panel / debugging ─────────────────────
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user || session.user.email !== process.env.ADMIN_EMAIL) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  return Response.json({
    stats: getDbStats(),
    dbPath: process.env.STT_DB_PATH ?? './data/stt.db',
    journalMode: sttDb.db.pragma('journal_mode', { simple: true }),
  });
};

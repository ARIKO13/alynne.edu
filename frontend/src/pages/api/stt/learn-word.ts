import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { learnWord } from '@/lib/learned-word';

/**
 * POST /api/stt/learn-word
 * Body: {
 *   word: string,
 *   confidence: number,
 *   source?: string,
 *   contextBefore?: string[],   // up to 3 words before (oldest → newest)
 *   contextAfter?: string[],    // up to 3 words after (closest → farthest)
 * }
 *
 * Server-side auto-learning system (v2 — SQLite):
 *   - Validate word (length, gibberish, particle check)
 *   - Insert/update ke SQLite learned_words table
 *   - Track unique userIds (vote_count = berapa user berbeda)
 *   - Auto-promote status: candidate (1 user) → confirmed (2+ users OR 5+ occurrences)
 *   - Track co-occurrence (3 before + 3 after) untuk context-aware correction
 *   - Hanya kata confirmed yang merge ke phonetic-map.json (avoid noise di global dict)
 *
 * Auth:
 *   - User harus login (kalau ga ada session, tetap belajar tapi userId=null,
 *     vote_count tidak naik)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      word?: string;
      confidence?: number;
      source?: string;
      contextBefore?: string[];
      contextAfter?: string[];
    };

    const word = (body.word || '').trim();
    const confidence = Math.max(0, Math.min(1, Number(body.confidence) || 0));
    const source = (body.source || 'webspeech').trim();
    const contextBefore = Array.isArray(body.contextBefore) ? body.contextBefore.slice(0, 3) : [];
    const contextAfter = Array.isArray(body.contextAfter) ? body.contextAfter.slice(0, 3) : [];

    if (!word || word.length < 3) {
      return Response.json({
        error: 'word required (min 3 chars)',
        learned: false,
      }, { status: 400 });
    }

    if (confidence < 0.5) {
      return Response.json({
        error: 'confidence too low (min 0.5)',
        learned: false,
        word,
      }, { status: 400 });
    }

    // Get user ID if logged in (for vote tracking)
    let userId: string | null = null;
    const session = await getSession(request);
    if (session?.user?.id) {
      userId = session.user.id;
    }

    const result = await learnWord(word, confidence, userId, source, contextBefore, contextAfter);

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[learn-word] error:', error);
    return Response.json({
      error: 'Failed to learn word',
      learned: false,
    }, { status: 500 });
  }
};

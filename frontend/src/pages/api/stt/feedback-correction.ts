import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { recordUserCorrection } from '@/lib/learned-word';

/**
 * POST /api/stt/feedback-correction
 * Body: {
 *   originalWord: string,
 *   correctedWord: string,
 *   contextBefore?: string[],   // up to 3 words before (oldest → newest)
 *   contextAfter?: string[],    // up to 3 words after (closest → farthest)
 *   fullSentence?: string,
 * }
 *
 * Submit manual correction from user. Used as feedback loop:
 *   - 1 row per vote (dengan userId tracking)
 *   - Aggregated in correction_summary table
 *   - When 2+ users vote for same correction → high confidence
 *   - Used by context-aware corrector untuk improve accuracy
 *
 * Auth: optional — anonymous votes allowed (userId=null)
 *       tapi anonymous votes bobotnya 1.0, logged-in users bisa dapet bump
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      originalWord?: string;
      correctedWord?: string;
      contextBefore?: string[];
      contextAfter?: string[];
      fullSentence?: string;
    };

    const originalWord = (body.originalWord || '').trim();
    const correctedWord = (body.correctedWord || '').trim();
    const contextBefore = Array.isArray(body.contextBefore) ? body.contextBefore.slice(0, 3) : [];
    const contextAfter = Array.isArray(body.contextAfter) ? body.contextAfter.slice(0, 3) : [];
    const fullSentence = body.fullSentence?.trim() || null;

    if (!originalWord || !correctedWord) {
      return Response.json({
        error: 'originalWord and correctedWord required',
      }, { status: 400 });
    }

    if (originalWord.toLowerCase() === correctedWord.toLowerCase()) {
      return Response.json({
        error: 'originalWord and correctedWord must be different',
      }, { status: 400 });
    }

    // Get user ID (optional)
    let userId: string | null = null;
    const session = await getSession(request);
    if (session?.user?.id) {
      userId = session.user.id;
    }

    const result = await recordUserCorrection(
      originalWord,
      correctedWord,
      contextBefore,
      contextAfter,
      fullSentence,
      userId,
    );

    return Response.json({
      success: result.recorded,
      voteId: result.voteId,
    });
  } catch (error) {
    console.error('[feedback-correction] error:', error);
    return Response.json({ error: 'Failed to record correction' }, { status: 500 });
  }
};

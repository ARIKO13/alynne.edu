import type { APIRoute } from 'astro';
import {
  getLearnedWords,
  deleteLearnedWord,
  getLearnedWordsStats,
  getDbStats,
} from '@/lib/learned-word';

/**
 * GET /api/stt/learned-words?limit=100&offset=0
 *   List all learned words (with phonetic variations, count, vote_count, status, etc.)
 *   Ordered by last_used_at DESC (most recently used first).
 *
 *   Query params:
 *     - limit   : items per page (default 100, max 500)
 *     - offset  : for pagination (default 0)
 *     - stats   : if 'true', only return DB stats (no word list)
 *
 *   Returns: {
 *     words: [...],
 *     total: number,
 *     stats: { total, confirmed, candidates },
 *     dbStats?: { learnedWords, cooccurrence, userCorrections }
 *   }
 *
 * DELETE /api/stt/learned-words?id=<int>
 *   Delete a learned word by id. Also cleans phonetic-map.json + cooccurrence.
 *
 * Auth:
 *   - GET: open (anyone can see global dict — privacy-safe because no raw transcripts)
 *   - DELETE: open too (no admin gate for now — TODO: add admin check if needed)
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    // Optional: require login
    // const session = await getSession(request);
    // if (!session?.user?.email) {
    //   return Response.json({ error: 'Login required' }, { status: 401 });
    // }

    const onlyStats = url.searchParams.get('stats') === 'true';
    if (onlyStats) {
      const dbStats = await getDbStats();
      return Response.json({ dbStats });
    }

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const { words, total } = await getLearnedWords(limit, offset);
    const stats = await getLearnedWordsStats();

    return Response.json({
      words,
      total,
      stats,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[learned-words] GET error:', error);
    return Response.json({ error: 'Failed to fetch learned words' }, { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const id = url.searchParams.get('id');
    if (!id) {
      return Response.json({
        error: 'id query param required',
      }, { status: 400 });
    }

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) {
      return Response.json({ error: 'id must be a number' }, { status: 400 });
    }

    const result = await deleteLearnedWord(idNum);
    if (!result.deleted) {
      return Response.json({ error: 'Word not found', id: idNum }, { status: 404 });
    }

    return Response.json({
      success: true,
      deleted: true,
      word: result.word,
      id: idNum,
    });
  } catch (error) {
    console.error('[learned-words] DELETE error:', error);
    return Response.json({ error: 'Failed to delete word' }, { status: 500 });
  }
};

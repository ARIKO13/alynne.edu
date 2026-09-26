import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import {
  getLearnedWords,
  deleteLearnedWord,
  getLearnedWordsStats,
} from '@/lib/learned-word';

/**
 * GET /api/stt/learned-words?limit=100&offset=0
 *   List all learned words (with phonetic variations, count, source, etc.)
 *   Ordered by lastUsedAt DESC (most recently used first).
 *
 *   Query params:
 *     - limit   : items per page (default 100, max 500)
 *     - offset  : for pagination (default 0)
 *
 *   Returns: { words: [...], total: number, stats: { total, confirmed, candidates } }
 *
 * DELETE /api/stt/learned-words?id=<uuid>
 *   Delete a learned word by id. Also cleans phonetic-map.json.
 *
 * DELETE /api/stt/learned-words?all=true
 *   Delete ALL learned words. Also resets phonetic-map.json (removes all
 *   auto-learned entries, keeps manually curated ones).
 *
 * Auth:
 *   - GET: open (any user can see the global dict — privacy-safe because
 *          no raw transcripts are stored, only the learned words)
 *   - DELETE: open too (no admin gate — for now, any logged-in user can manage)
 *            TODO: kalau perlu admin-only, tambahin check di sini
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    // Optional: require login (but don't require admin)
    // const session = await getSession(request);
    // if (!session?.user?.email) {
    //   return Response.json({ error: 'Login required' }, { status: 401 });
    // }

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
    // Optional: require login
    // const session = await getSession(request);
    // if (!session?.user?.email) {
    //   return Response.json({ error: 'Login required' }, { status: 401 });
    // }

    const id = url.searchParams.get('id');
    const all = url.searchParams.get('all');

    if (all === 'true') {
      // Delete ALL — TODO: implement bulk delete if needed
      return Response.json({
        error: 'Bulk delete not yet implemented. Use /api/stt/learned-words?id=X for single delete.',
      }, { status: 501 });
    }

    if (!id) {
      return Response.json({
        error: 'id query param required (or ?all=true for bulk)',
      }, { status: 400 });
    }

    const result = await deleteLearnedWord(id);
    if (!result.deleted) {
      return Response.json({ error: 'Word not found', id }, { status: 404 });
    }

    return Response.json({
      success: true,
      deleted: true,
      word: result.word,
      id,
    });
  } catch (error) {
    console.error('[learned-words] DELETE error:', error);
    return Response.json({ error: 'Failed to delete word' }, { status: 500 });
  }
};

import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { d1 } from '@/lib/d1-client';

/**
 * GET /api/admin/stt-failures?page=1&limit=20&source=webspeech
 *
 * Returns paginated list of STT failure logs (words the system couldn't
 * recognize). Admin-only endpoint.
 *
 * Each failure has: id, rawText, correctedText, source, unknownWords,
 * unknownCount, userId, createdAt.
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const source = url.searchParams.get('source');
    const offset = (page - 1) * limit;

    // Ensure table exists
    await d1.execute(`
      CREATE TABLE IF NOT EXISTS STTFailure (
        id TEXT PRIMARY KEY,
        rawText TEXT NOT NULL,
        correctedText TEXT,
        source TEXT,
        unknownWords TEXT,
        unknownCount INTEGER DEFAULT 0,
        userId TEXT,
        createdAt TEXT NOT NULL
      )
    `).catch(() => {});

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count
    const countRows = await d1.query<{ c: number }>(
      `SELECT COUNT(*) as c FROM STTFailure ${where}`, params
    );
    const total = countRows[0]?.c ?? 0;

    // Get paginated failures
    const failures = await d1.query<{
      id: string;
      rawText: string;
      correctedText: string | null;
      source: string;
      unknownWords: string | null;
      unknownCount: number;
      userId: string | null;
      createdAt: string;
    }>(
      `SELECT id, rawText, correctedText, source, unknownWords, unknownCount, userId, createdAt
       FROM STTFailure ${where}
       ORDER BY createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return Response.json({
      failures: (failures || []).map(f => ({
        ...f,
        unknownWords: f.unknownWords ? f.unknownWords.split(',').filter(Boolean) : [],
      })),
      total,
      page,
      limit,
      hasMore: offset + failures.length < total,
    });
  } catch (error) {
    console.error('[admin/stt-failures] error:', error);
    return Response.json({ error: 'Failed to fetch STT failures' }, { status: 500 });
  }
};

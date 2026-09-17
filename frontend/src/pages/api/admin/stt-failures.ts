import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { d1 } from '@/lib/d1-client';

/**
 * GET /api/admin/stt-failures?page=1&limit=20&source=webspeech&sort=newest
 *
 * Returns paginated list of STT failure logs (words the system couldn't
 * recognize). Admin-only endpoint.
 *
 * Each failure has: id, rawText, correctedText, source, unknownWords,
 * unknownCount, userId, createdAt.
 *
 * Query params:
 *   - page    : page number (default 1)
 *   - limit   : items per page (default 50, max 200)
 *   - source  : filter by source ('webspeech' | 'ocr' | 'groq' | ...)
 *   - sort    : 'newest' (default, DESC) | 'oldest' (ASC)
 *
 * DELETE /api/admin/stt-failures?id=<uuid>
 *   Delete a single failure record by id.
 *
 * DELETE /api/admin/stt-failures
 *   Delete ALL failure records. Use with caution — irreversible.
 *
 * DELETE /api/admin/stt-failures?source=<source>
 *   Delete all failures matching the given source (e.g., 'webspeech').
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
    const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
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

    // ORDER BY based on sort
    const orderBy = sort === 'oldest' ? 'createdAt ASC' : 'createdAt DESC';

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
       ORDER BY ${orderBy}
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
      sort,
      hasMore: offset + failures.length < total,
    });
  } catch (error) {
    console.error('[admin/stt-failures] GET error:', error);
    return Response.json({ error: 'Failed to fetch STT failures' }, { status: 500 });
  }
};

/**
 * DELETE /api/admin/stt-failures?id=<uuid>
 *   Delete a single failure record by id.
 *
 * DELETE /api/admin/stt-failures
 *   Delete ALL failure records. Use with caution — irreversible.
 *
 * DELETE /api/admin/stt-failures?source=<source>
 *   Delete all failures matching the given source (e.g., 'webspeech').
 */
export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

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

    const id = url.searchParams.get('id');
    const source = url.searchParams.get('source');

    if (id) {
      // Delete single record by id
      const result = await d1.execute(
        `DELETE FROM STTFailure WHERE id = ?`,
        [id]
      );
      const deleted = result.changes ?? 0;
      if (deleted === 0) {
        return Response.json({ error: 'Record not found', id }, { status: 404 });
      }
      console.log(`[admin/stt-failures] Deleted record: ${id}`);
      return Response.json({
        success: true,
        action: 'delete-one',
        id,
        deleted,
      });
    }

    if (source) {
      // Delete all records matching source
      const countRows = await d1.query<{ c: number }>(
        `SELECT COUNT(*) as c FROM STTFailure WHERE source = ?`,
        [source]
      );
      const beforeCount = countRows[0]?.c ?? 0;
      const result = await d1.execute(
        `DELETE FROM STTFailure WHERE source = ?`,
        [source]
      );
      console.log(`[admin/stt-failures] Deleted ${result.changes} records with source='${source}'`);
      return Response.json({
        success: true,
        action: 'delete-by-source',
        source,
        deleted: result.changes ?? 0,
        beforeCount,
      });
    }

    // Delete ALL records
    const countRows = await d1.query<{ c: number }>(
      `SELECT COUNT(*) as c FROM STTFailure`
    );
    const beforeCount = countRows[0]?.c ?? 0;
    const result = await d1.execute(`DELETE FROM STTFailure`);
    console.log(`[admin/stt-failures] Deleted ALL records: ${result.changes} rows`);
    return Response.json({
      success: true,
      action: 'delete-all',
      deleted: result.changes ?? 0,
      beforeCount,
    });
  } catch (error) {
    console.error('[admin/stt-failures] DELETE error:', error);
    return Response.json({ error: 'Failed to delete STT failures' }, { status: 500 });
  }
};

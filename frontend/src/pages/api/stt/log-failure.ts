import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { d1 } from '@/lib/d1-client';

/**
 * POST /api/stt/log-failure
 * Body: { rawText, source, unknownWords?, correctedText? }
 *
 * Logs failed STT recognition for later analysis. Called automatically
 * from /api/stt/fuzzy-correct when unknownWords > 0 (the system couldn't
 * recognize some words from Web Speech API / OCR).
 *
 * The user will later connect a spreadsheet sync, but for now we store
 * everything in D1 table `STTFailure` so it's queryable from the admin panel.
 *
 * Schema:
 *   CREATE TABLE IF NOT EXISTS STTFailure (
 *     id TEXT PRIMARY KEY,
 *     rawText TEXT NOT NULL,
 *     correctedText TEXT,
 *     source TEXT,
 *     unknownWords TEXT,       -- comma-separated list
 *     unknownCount INTEGER,
 *     userId TEXT,
 *     createdAt TEXT NOT NULL
 *   );
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      rawText?: string;
      source?: string;
      unknownWords?: string[];
      correctedText?: string;
    };

    const rawText = (body.rawText || '').trim();
    if (!rawText) {
      return Response.json({ error: 'rawText required' }, { status: 400 });
    }

    // Get user ID if logged in (optional — failures can be anonymous)
    let userId: string | null = null;
    const session = await getSession(request);
    if (session?.user?.id) {
      userId = session.user.id;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const unknownWords = (body.unknownWords || []).join(',');
    const unknownCount = (body.unknownWords || []).length;

    // Create table if not exists (idempotent)
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
    `).catch(() => {}); // table might already exist

    // Insert failure record
    await d1.execute(
      `INSERT INTO STTFailure (id, rawText, correctedText, source, unknownWords, unknownCount, userId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, rawText, body.correctedText || null, body.source || 'unknown',
       unknownWords, unknownCount, userId, now]
    );

    return Response.json({
      success: true,
      id,
      message: 'Failure logged',
    });
  } catch (error) {
    console.error('[stt/log-failure] error:', error);
    return Response.json({ error: 'Failed to log' }, { status: 500 });
  }
};

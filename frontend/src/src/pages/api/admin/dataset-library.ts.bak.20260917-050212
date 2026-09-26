import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { getDbStats, getLearnedWords, deleteLearnedWord } from '@/lib/learned-word';
import { sttDb } from '@/lib/stt-db';

/**
 * GET /api/admin/dataset-library?section=words|cooccurrence|corrections|stats&limit=100&offset=0&search=...
 *
 * Browse the STT dataset stored in SQLite on the VPS SSD.
 * Admin-only — this is the dataset library viewer for the admin panel.
 *
 * Sections:
 *   - stats          : Overall counts (learned_words total/confirmed/candidates,
 *                      cooccurrence total/unique, corrections total/pending)
 *   - words          : Learned words list (with phonetic_variations, count, vote_count, status)
 *   - cooccurrence   : Co-occurrence stats (which words appear together, position, count)
 *   - corrections    : User corrections (original_word → corrected_word + context)
 *   - summary        : correction_summary (aggregated votes per pair)
 *   - search?word=X  : Get full detail for a single word (variations, cooccurrence, votes)
 *
 * DELETE /api/admin/dataset-library?id=<int>&section=words
 *   Delete a learned word by id (also cleans phonetic-map.json + cooccurrence)
 *
 * Auth: admin only (using existing isAdmin check from @/lib/admin)
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const section = url.searchParams.get('section') || 'stats';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const search = url.searchParams.get('search') || '';
    const word = url.searchParams.get('word') || '';

    // ── Section: stats ──
    if (section === 'stats') {
      const dbStats = await getDbStats();
      // Also get DB file size + WAL file size from filesystem
      const dbPath = process.env.STT_DB_PATH || '/root/lina-learning/data/stt.db';
      let dbFileSize = 0, walFileSize = 0;
      try {
        const fs = await import('node:fs');
        const stat = fs.statSync(dbPath);
        dbFileSize = stat.size;
        try {
          const walStat = fs.statSync(dbPath + '-wal');
          walFileSize = walStat.size;
        } catch { /* WAL might not exist */ }
      } catch { /* ignore */ }

      return Response.json({
        stats: dbStats,
        dbFile: {
          path: dbPath,
          sizeBytes: dbFileSize,
          walSizeBytes: walFileSize,
          sizeMB: (dbFileSize / 1024 / 1024).toFixed(2),
        },
      });
    }

    // ── Section: words (with search) ──
    if (section === 'words') {
      if (search) {
        // Search words
        const rows = sttDb.getAll<{
          id: number; word: string; phonetic_variations: string;
          source: string; confidence: number; count: number; vote_count: number;
          status: string; created_at: string; last_used_at: string;
        }>(
          `SELECT id, word, phonetic_variations, source, confidence, count, vote_count, status, created_at, last_used_at
           FROM learned_words
           WHERE word LIKE ? COLLATE NOCASE
           ORDER BY last_used_at DESC
           LIMIT ? OFFSET ?`,
          [`%${search}%`, limit, offset]
        );
        const totalRow = sttDb.getOne<{ c: number }>(
          `SELECT COUNT(*) as c FROM learned_words WHERE word LIKE ? COLLATE NOCASE`,
          [`%${search}%`]
        );
        return Response.json({
          words: (rows || []).map(r => ({
            ...r,
            phonetic_variations: r.phonetic_variations ? JSON.parse(r.phonetic_variations) : [],
          })),
          total: totalRow?.c ?? 0,
          limit,
          offset,
        });
      }

      const { words, total } = await getLearnedWords(limit, offset);
      return Response.json({ words, total, limit, offset });
    }

    // ── Section: cooccurrence (with optional word filter) ──
    if (section === 'cooccurrence') {
      const where = word ? `WHERE word = ? COLLATE NOCASE` : '';
      const params = word ? [word] : [];
      const rows = sttDb.getAll<{
        id: number; word: string; context_word: string;
        position: string; distance: number; count: number; updated_at: string;
      }>(
        `SELECT id, word, context_word, position, distance, count, updated_at
         FROM word_cooccurrence
         ${where}
         ORDER BY count DESC, word ASC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const totalRow = sttDb.getOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM word_cooccurrence ${where}`,
        params
      );
      return Response.json({
        cooccurrences: rows || [],
        total: totalRow?.c ?? 0,
        limit,
        offset,
      });
    }

    // ── Section: corrections (user feedback votes) ──
    if (section === 'corrections') {
      const rows = sttDb.getAll<{
        id: number; original_word: string; corrected_word: string;
        context_before: string | null; context_after: string | null;
        full_sentence: string | null; user_id: string | null;
        user_weight: number; accepted: number; created_at: string;
      }>(
        `SELECT id, original_word, corrected_word, context_before, context_after,
                full_sentence, user_id, user_weight, accepted, created_at
         FROM user_corrections
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      const totalRow = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM user_corrections`);
      return Response.json({
        corrections: rows || [],
        total: totalRow?.c ?? 0,
        limit,
        offset,
      });
    }

    // ── Section: summary (aggregated correction votes) ──
    if (section === 'summary') {
      const rows = sttDb.getAll<{
        original_word: string; corrected_word: string;
        total_votes: number; weighted_votes: number; last_voted_at: string;
      }>(
        `SELECT original_word, corrected_word, total_votes, weighted_votes, last_voted_at
         FROM correction_summary
         ORDER BY weighted_votes DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      const totalRow = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM correction_summary`);
      return Response.json({
        summaries: rows || [],
        total: totalRow?.c ?? 0,
        limit,
        offset,
      });
    }

    // ── Section: search (word detail with all related data) ──
    if (section === 'word-detail' && word) {
      const w = word.toLowerCase().trim();
      const wordRow = sttDb.getOne<{
        id: number; word: string; phonetic_variations: string;
        phonetic_code: string; source: string; confidence: number;
        count: number; vote_count: number; user_ids: string;
        status: string; context_words: string;
        created_at: string; last_used_at: string;
      }>(`SELECT * FROM learned_words WHERE word = ? COLLATE NOCASE`, [w]);

      if (!wordRow) {
        return Response.json({ error: 'Word not found', word: w }, { status: 404 });
      }

      const cooccur = sttDb.getAll<{
        context_word: string; position: string; distance: number; count: number;
      }>(
        `SELECT context_word, position, distance, count
         FROM word_cooccurrence
         WHERE word = ? COLLATE NOCASE
         ORDER BY position, distance, count DESC`,
        [w]
      );

      const corrections = sttDb.getAll<{
        original_word: string; corrected_word: string; user_id: string | null;
        user_weight: number; accepted: number; created_at: string;
      }>(
        `SELECT original_word, corrected_word, user_id, user_weight, accepted, created_at
         FROM user_corrections
         WHERE original_word = ? COLLATE NOCASE OR corrected_word = ? COLLATE NOCASE
         ORDER BY created_at DESC
         LIMIT 20`,
        [w, w]
      );

      return Response.json({
        word: {
          ...wordRow,
          phonetic_variations: wordRow.phonetic_variations ? JSON.parse(wordRow.phonetic_variations) : [],
          user_ids: wordRow.user_ids ? JSON.parse(wordRow.user_ids) : [],
          context_words: wordRow.context_words ? JSON.parse(wordRow.context_words) : [],
        },
        cooccurrence: cooccur || [],
        corrections: corrections || [],
      });
    }

    return Response.json({ error: 'Invalid section' }, { status: 400 });
  } catch (error) {
    console.error('[admin/dataset-library] GET error:', error);
    return Response.json({ error: 'Failed to fetch dataset' }, { status: 500 });
  }
};

/**
 * DELETE /api/admin/dataset-library?id=<int>&section=words
 *   Delete a learned word by id (also cleans phonetic-map.json + cooccurrence).
 *
 * Auth: admin only.
 */
export const DELETE: APIRoute = async ({ request, url }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const section = url.searchParams.get('section') || 'words';
    const id = url.searchParams.get('id');

    if (!id) {
      return Response.json({ error: 'id query param required' }, { status: 400 });
    }
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) {
      return Response.json({ error: 'id must be a number' }, { status: 400 });
    }

    if (section === 'words') {
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
    }

    if (section === 'cooccurrence') {
      sttDb.run(`DELETE FROM word_cooccurrence WHERE id = ?`, [idNum]);
      return Response.json({ success: true, deleted: true, id: idNum });
    }

    if (section === 'corrections') {
      sttDb.run(`DELETE FROM user_corrections WHERE id = ?`, [idNum]);
      return Response.json({ success: true, deleted: true, id: idNum });
    }

    return Response.json({ error: 'Invalid section for delete' }, { status: 400 });
  } catch (error) {
    console.error('[admin/dataset-library] DELETE error:', error);
    return Response.json({ error: 'Failed to delete' }, { status: 500 });
  }
};

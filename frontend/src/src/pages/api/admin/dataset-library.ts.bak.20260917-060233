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
    const sourceFilter = url.searchParams.get('source') || ''; // 'kbbi' | 'slang' | 'webspeech' | '' (all)

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

      // Get breakdown by source (kbbi / slang / webspeech)
      const sourceBreakdown = sttDb.getAll<{ source: string; status: string; c: number }>(
        `SELECT source, status, COUNT(*) as c FROM learned_words GROUP BY source, status ORDER BY source`
      );

      return Response.json({
        stats: dbStats,
        dbFile: {
          path: dbPath,
          sizeBytes: dbFileSize,
          walSizeBytes: walFileSize,
          sizeMB: (dbFileSize / 1024 / 1024).toFixed(2),
        },
        sourceBreakdown: sourceBreakdown || [],
      });
    }

    // ── Section: words (with search + source filter) ──
    if (section === 'words') {
      // Build WHERE clause: combine search + sourceFilter
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (search) {
        conditions.push('word LIKE ? COLLATE NOCASE');
        params.push(`%${search}%`);
      }
      if (sourceFilter) {
        conditions.push('source = ?');
        params.push(sourceFilter);
      }
      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const rows = sttDb.getAll<{
        id: number; word: string; phonetic_variations: string;
        source: string; dataset_origin: string;
        confidence: number; count: number; vote_count: number;
        status: string; created_at: string; last_used_at: string;
      }>(
        `SELECT id, word, phonetic_variations, source, dataset_origin, confidence, count, vote_count, status, created_at, last_used_at
         FROM learned_words
         ${where}
         ORDER BY last_used_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const totalRow = sttDb.getOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM learned_words ${where}`,
        params
      );
      return Response.json({
        words: (rows || []).map(r => ({
          ...r,
          phonetic_variations: r.phonetic_variations ? JSON.parse(r.phonetic_variations) : [],
        })),
        total: totalRow?.c ?? 0,
        limit,
        offset,
        sourceFilter: sourceFilter || null,
      });
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

    // ── Section: storage-info — disk usage, table sizes, free space ──
    if (section === 'storage-info') {
      const dbPath = process.env.STT_DB_PATH || '/root/lina-learning/data/stt.db';

      // Get DB file size + WAL file size
      let dbFileSize = 0, walFileSize = 0, shmFileSize = 0;
      try {
        const fs = await import('node:fs');
        dbFileSize = fs.statSync(dbPath).size;
        try { walFileSize = fs.statSync(dbPath + '-wal').size; } catch { /* no WAL */ }
        try { shmFileSize = fs.statSync(dbPath + '-shm').size; } catch { /* no SHM */ }
      } catch { /* ignore */ }

      // Get disk free space (df -B1 untuk bytes)
      let diskTotal = 50 * 1024 * 1024 * 1024; // VPS disk 50GB (sda1)
      let diskUsed = 14 * 1024 * 1024 * 1024; // approximate
      let diskFree = diskTotal - diskUsed;
      try {
        const { execSync } = await import('node:child_process');
        const dfOutput = execSync(`df -B1 ${dbPath} | tail -1`, { encoding: 'utf-8' }).trim();
        const parts = dfOutput.split(/\s+/);
        if (parts.length >= 4) {
          diskTotal = parseInt(parts[1], 10);
          diskUsed = parseInt(parts[2], 10);
          diskFree = parseInt(parts[3], 10);
        }
      } catch { /* ignore */ }

      // Get SQLite page info
      const pageCount = sttDb.getOne<{ page_count: number }>(`PRAGMA page_count`)?.page_count ?? 0;
      const pageSize = sttDb.getOne<{ page_size: number }>(`PRAGMA page_size`)?.page_size ?? 4096;
      const sqliteSize = pageCount * pageSize;
      const freePages = sttDb.getOne<{ freelist_count: number }>(`PRAGMA freelist_count`)?.freelist_count ?? 0;
      const freePagesSize = freePages * pageSize;

      // Get table sizes (rows + size in bytes — approximate via dbstat if available)
      const tables = sttDb.getAll<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%' ORDER BY name`
      );

      const tableInfo = [];
      for (const t of tables) {
        const countRow = sttDb.getOne<{ c: number }>(`SELECT COUNT(*) as c FROM "${t.name}"`);
        const rows = countRow?.c ?? 0;
        // Approximate table size: query via SUM(LENGTH()) on each row would be expensive.
        // Use DBstat if available, otherwise estimate from rows × avg row size.
        let tableSize = 0;
        try {
          const statRows = sttDb.getAll<{ pagetype: string; payload: number }>(
            `SELECT pagetype, SUM(payload) as payload FROM dbstat WHERE name=? GROUP BY pagetype`,
            [t.name]
          );
          for (const r of statRows) {
            if (r.pagetype === 'leaf' || r.pagetype === 'interior') {
              tableSize += r.payload || 0;
            }
          }
        } catch {
          // dbstat not available — use rough estimate
          tableSize = rows * 100; // ~100 bytes per row average
        }

        // Get column count
        const colCount = sttDb.getOne<{ c: number }>(
          `SELECT COUNT(*) as c FROM pragma_table_info("${t.name}")`
        )?.c ?? 0;

        tableInfo.push({
          name: t.name,
          rows,
          sizeBytes: tableSize,
          columns: colCount,
        });
      }

      // Get index info
      const indexes = sttDb.getAll<{
        name: string; tbl_name: string; sql: string;
      }>(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY tbl_name, name`);

      return Response.json({
        dbFile: {
          path: dbPath,
          sizeBytes: dbFileSize,
          walSizeBytes: walFileSize,
          shmSizeBytes: shmFileSize,
          totalBytes: dbFileSize + walFileSize + shmFileSize,
          sizeMB: (dbFileSize / 1024 / 1024).toFixed(2),
          walMB: (walFileSize / 1024 / 1024).toFixed(2),
        },
        disk: {
          total: diskTotal,
          used: diskUsed,
          free: diskFree,
          usedPct: ((diskUsed / diskTotal) * 100).toFixed(1),
          freeGB: (diskFree / 1024 / 1024 / 1024).toFixed(2),
          totalGB: (diskTotal / 1024 / 1024 / 1024).toFixed(2),
        },
        sqlite: {
          pageCount,
          pageSize,
          totalSize: sqliteSize,
          freePages,
          freePagesSize,
          fragmentationPct: pageCount > 0 ? ((freePages / pageCount) * 100).toFixed(2) : '0',
          journalMode: sttDb.getOne<{ journal_mode: string }>(`PRAGMA journal_mode`)?.journal_mode ?? 'unknown',
          synchronous: sttDb.getOne<{ synchronous: number }>(`PRAGMA synchronous`)?.synchronous ?? 1,
        },
        tables: tableInfo,
        indexes: indexes.map(i => ({
          name: i.name,
          table: i.tbl_name,
          sql: i.sql || '',
        })),
      });
    }

    // ── Section: schema-info — visualisasi ERD-style (tables + relations + columns) ──
    if (section === 'schema-info') {
      const tables = sttDb.getAll<{
        name: string; sql: string;
      }>(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%' ORDER BY name`);

      const tableSchemas = [];
      for (const t of tables) {
        const columns = sttDb.getAll<{
          cid: number; name: string; type: string; notnull: number;
          dflt_value: string | null; pk: number;
        }>(`PRAGMA table_info("${t.name}")`);

        const foreignKeys = sttDb.getAll<{
          id: number; seq: number; table: string; from: string; to: string;
          on_update: string; on_delete: string; match: string;
        }>(`PRAGMA foreign_key_list("${t.name}")`);

        const indexes = sttDb.getAll<{
          name: string; unique: number; origin: string; partial: number;
        }>(`PRAGMA index_list("${t.name}")`).map(idx => ({
          ...idx,
          columns: sttDb.getAll<{ name: string }>(`PRAGMA index_info("${idx.name}")`),
        }));

        tableSchemas.push({
          name: t.name,
          sql: t.sql,
          columns: columns.map(c => ({
            name: c.name,
            type: c.type,
            notNull: c.notnull === 1,
            pk: c.pk,
            default: c.dflt_value,
          })),
          foreignKeys: foreignKeys.map(fk => ({
            table: fk.table,
            from: fk.from,
            to: fk.to,
            onUpdate: fk.on_update,
            onDelete: fk.on_delete,
          })),
          indexes: indexes.map(i => ({
            name: i.name,
            unique: i.unique === 1,
            columns: i.columns.map(c => c.name),
          })),
        });
      }

      // Get indexes yang ada di semua tables
      const allIndexes = sttDb.getAll<{
        name: string; tbl_name: string; sql: string | null;
      }>(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name`);

      return Response.json({
        tables: tableSchemas,
        indexes: allIndexes,
        schemaVersion: sttDb.getOne<{ name: string }>(
          `SELECT name FROM _schema_migrations ORDER BY id DESC LIMIT 1`
        )?.name ?? 'unknown',
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

/**
 * stt-db.ts — better-sqlite3 singleton for Astro server-side (Node adapter).
 *
 * Purpose:
 *   • Fast local SQLite for high-frequency STT correction writes.
 *   • Cloudflare D1 (HTTP API) is too slow / costly for per-token corrections.
 *   • better-sqlite3 is synchronous (no event-loop overhead), 5–50× faster than
 *     node-sqlite3 for our workloads (bulk upserts + small point reads).
 *
 * Architecture:
 *   • ONE connection per process, cached on globalThis (so Astro dev HMR
 *     doesn't leak connections).
 *   • WAL mode + busy_timeout + foreign_keys ON, set on every connect.
 *   • Schema self-initializes on first use (idempotent CREATE IF NOT EXISTS).
 *   • Prepared statements cached in a Map for hot-path reuse.
 *   • Transaction helper wraps better-sqlite3's db.transaction().
 *
 * Usage in Astro API route:
 *   import { sttDb } from '@/lib/stt-db';
 *   const row = sttDb.getOne('SELECT * FROM learned_words WHERE word = ?', [w]);
 *
 * CAVEATS:
 *   • better-sqlite3 is a native module — install with `npm i better-sqlite3`
 *     AND `npm i -D @types/better-sqlite3`. Requires build tools on the VPS:
 *       apt-get install -y python3 make g++ libsqlite3-dev
 *     (Or use prebuilt binaries via prebuild-install — usually automatic.)
 *   • NOT for Cloudflare Workers / Vercel Edge — Node adapter only.
 *   • DB file path: configurable via env STT_DB_PATH (default ./data/stt.db).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Database as DBType, Statement } from 'better-sqlite3';

// ── Schema (mirrors backend/database/schema-stt.sql; inlined for portability) ──
// v2: added dataset_origin column to distinguish seeded (KBBI/slang lama)
//     vs user-learned (baru dari STT user)
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;
PRAGMA mmap_size = 268435456;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS learned_words (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  word                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phonetic_variations TEXT    NOT NULL DEFAULT '[]',
  phonetic_code       TEXT    NOT NULL DEFAULT '',
  source              TEXT    NOT NULL DEFAULT 'webspeech',
  dataset_origin      TEXT    NOT NULL DEFAULT 'user-learned'
                              CHECK (dataset_origin IN ('seeded','user-learned')),
  confidence          REAL    NOT NULL DEFAULT 0.0,
  count               INTEGER NOT NULL DEFAULT 1,
  vote_count          INTEGER NOT NULL DEFAULT 0,
  user_ids            TEXT    NOT NULL DEFAULT '[]',
  status              TEXT    NOT NULL DEFAULT 'candidate'
                              CHECK (status IN ('candidate','confirmed','rejected')),
  context_words       TEXT    NOT NULL DEFAULT '[]',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learned_words_status       ON learned_words(status);
CREATE INDEX IF NOT EXISTS idx_learned_words_last_used    ON learned_words(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_learned_words_count_active ON learned_words(count DESC) WHERE status != 'rejected';
CREATE INDEX IF NOT EXISTS idx_learned_words_phonetic     ON learned_words(phonetic_code) WHERE phonetic_code != '';
CREATE INDEX IF NOT EXISTS idx_learned_words_confidence   ON learned_words(confidence DESC) WHERE status = 'candidate';
CREATE INDEX IF NOT EXISTS idx_learned_words_origin       ON learned_words(dataset_origin);

CREATE TABLE IF NOT EXISTS word_cooccurrence (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word          TEXT    NOT NULL COLLATE NOCASE,
  context_word  TEXT    NOT NULL COLLATE NOCASE,
  position      TEXT    NOT NULL CHECK (position IN ('before','after','same_sentence')),
  distance      INTEGER NOT NULL DEFAULT 1 CHECK (distance BETWEEN 1 AND 3),
  count         INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (word, context_word, position, distance)
);
CREATE INDEX IF NOT EXISTS idx_cooccur_word_pos_dist ON word_cooccurrence(word, position, distance, count DESC);
CREATE INDEX IF NOT EXISTS idx_cooccur_ctx_pos       ON word_cooccurrence(context_word, position);
CREATE INDEX IF NOT EXISTS idx_cooccur_word_only     ON word_cooccurrence(word);

CREATE TABLE IF NOT EXISTS user_corrections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_word   TEXT    NOT NULL COLLATE NOCASE,
  corrected_word  TEXT    NOT NULL COLLATE NOCASE,
  context_before  TEXT,
  context_after   TEXT,
  full_sentence   TEXT,
  user_id         TEXT,
  user_weight     REAL    NOT NULL DEFAULT 1.0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corr_original             ON user_corrections(original_word);
CREATE INDEX IF NOT EXISTS idx_corr_orig_corrected_votes ON user_corrections(original_word, corrected_word, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corr_user                 ON user_corrections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corr_pending              ON user_corrections(accepted) WHERE accepted = 0;

CREATE TABLE IF NOT EXISTS correction_summary (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_word   TEXT    NOT NULL COLLATE NOCASE,
  corrected_word  TEXT    NOT NULL COLLATE NOCASE,
  total_votes     INTEGER NOT NULL DEFAULT 0,
  weighted_votes  REAL    NOT NULL DEFAULT 0.0,
  last_voted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (original_word, corrected_word)
);
CREATE INDEX IF NOT EXISTS idx_corr_summary_orig ON correction_summary(original_word, weighted_votes DESC);

CREATE TABLE IF NOT EXISTS _schema_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO _schema_migrations (name) VALUES ('baseline_v1');
INSERT OR IGNORE INTO _schema_migrations (name) VALUES ('v2_dataset_origin');

-- Migration: add dataset_origin column if missing (existing DBs created before v2)
-- SQLite doesn't support IF NOT EXISTS for ADD COLUMN, so we use a try/catch approach
-- via separate exec. Done in constructor after main schema.
`;

// Migration SQL: add dataset_origin column to existing learned_words table
// (for DBs created before v2). Idempotent — fails silently if column exists.
const MIGRATION_V2_SQL = `
-- SQLite doesn't have IF NOT EXISTS for ADD COLUMN, so we wrap in a
-- conditional via PRAGMA table_info. Better-sqlite3 will throw if column
-- exists, which we catch in the constructor.
`;

// ── DB path resolution (env-aware, works on local + VPS) ──
function resolveDbPath(): string {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string>);
  // 1. Explicit override
  if (env.STT_DB_PATH) return env.STT_DB_PATH;
  // 2. Standard VPS layout (matches existing project structure)
  const candidates = [
    '/root/lina-learning/data/stt.db',
    join(process.cwd(), 'data', 'stt.db'),
    join(process.cwd(), 'backend', 'data', 'stt.db'),
  ];
  for (const p of candidates) {
    // Prefer existing file; otherwise pick the first writable dir
    if (existsSync(p)) return p;
  }
  // 3. Default: create in ./data/stt.db
  return candidates[1];
}

// ── Singleton: cached on globalThis to survive Astro HMR ──
interface GlobalWithSttDb {
  __sttDb?: SttDb;
  __sttDbShutdownRegistered?: boolean;
}
const g = globalThis as unknown as GlobalWithSttDb;

export class SttDb {
  readonly db: DBType;
  private readonly stmts = new Map<string, Statement>();
  private _initialized = false;

  constructor(dbPath: string = resolveDbPath()) {
    // Ensure parent dir exists (cheap, idempotent)
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath, {
      // readOnly: false (default)
      fileMustExist: false,    // create if missing
      timeout: 5000,           // busy_timeout (ms)
      verbose: process.env.STT_DB_VERBOSE ? (msg) => console.debug('[stt-db]', msg) : undefined,
    });

    // PRAGMA setup (must be the very first statements; some cannot be set during a tx)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -64000');     // 64 MB
    this.db.pragma('mmap_size = 268435456');   // 256 MB
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    this.runMigrations();
    this._initialized = true;
    console.log(`[stt-db] ✓ Opened SQLite @ ${dbPath} (WAL mode, ${this.db.pragma('journal_mode', { simple: true })})`);
  }

  /** Idempotent schema bootstrap. Safe to call multiple times. */
  initSchema(): void {
    if (this._initialized) return;
    // exec() handles multiple statements separated by ;
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Run migrations for existing DBs (idempotent).
   * - v2_dataset_origin: add `dataset_origin` column if missing
   */
  runMigrations(): void {
    // Check if dataset_origin column exists
    const cols = this.db.prepare(`PRAGMA table_info(learned_words)`).all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('dataset_origin')) {
      try {
        this.db.exec(`ALTER TABLE learned_words ADD COLUMN dataset_origin TEXT NOT NULL DEFAULT 'user-learned' CHECK (dataset_origin IN ('seeded','user-learned'))`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_learned_words_origin ON learned_words(dataset_origin)`);
        console.log('[stt-db] ✓ Migration v2: added dataset_origin column');
      } catch (e) {
        console.warn('[stt-db] Migration v2 failed (column may already exist):', e instanceof Error ? e.message : e);
      }
    }
  }

  /**
   * Prepared-statement cache. Re-compiles only on first call per SQL string;
   * subsequent calls return the cached Statement (keyed by exact SQL text).
   *
   * Why cache? better-sqlite3 already caches the prepared statement at the C
   * level for the lifetime of a Database, but exposing it here avoids the
   * lookup cost in our hot path AND lets us reuse the same Statement object.
   */
  prepare(sql: string): Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  // ── Convenience query wrappers ──
  getOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  getAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.prepare(sql).run(...params);
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  /**
   * Transaction wrapper. Uses better-sqlite3's db.transaction() which:
   *   • Begins IMMEDIATE (default) — acquires write lock up-front, avoids upgrade deadlock.
   *   • Auto-commits if function returns, auto-ROLLBACKs if it throws.
   *   • Re-throws the original error after rollback.
   *
   * Usage:
   *   const insertMany = sttDb.tx((rows: Row[]) => {
   *     for (const r of rows) sttDb.run('INSERT INTO t (...) VALUES (...)', [...]);
   *     return rows.length;
   *   });
   *   const n = insertMany(rows);
   */
  tx<T, A extends unknown[]>(fn: (...args: A) => T): (...args: A) => T {
    return this.db.transaction(fn);
  }

  /**
   * Manual checkpoint — call on a cron / graceful shutdown to fold WAL
   * pages back into the main DB. Pass 'TRUNCATE' to also zero the WAL file.
   *
   * Under steady load, SQLite auto-checkpoints every 1000 pages (~4 MB).
   * For STT workloads with bursts, manual checkpoint every 5-10 min helps.
   */
  checkpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
    // wal_checkpoint returns { wal: number, frames: number, checkpointed: number }
    this.db.pragma(`wal_checkpoint(${mode})`);
  }

  /** Graceful shutdown — call from a process SIGTERM handler. */
  close(): void {
    try { this.checkpoint('TRUNCATE'); } catch { /* ignore */ }
    this.db.close();
    console.log('[stt-db] closed.');
  }
}

// ── Singleton accessor ──
export const sttDb: SttDb = g.__sttDb ?? (g.__sttDb = new SttDb());

// ── Graceful shutdown hooks (only register once) ──
if (!g.__sttDbShutdownRegistered && typeof process !== 'undefined') {
  g.__sttDbShutdownRegistered = true;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      try { sttDb.close(); } catch { /* ignore */ }
      // Let Astro/Node's default handler exit
    });
  }
}

// ── Type exports (consumed by stt-context-corrector.ts + API routes) ──
export interface LearnedWordRow {
  id: number;
  word: string;
  phonetic_variations: string;        // JSON array
  phonetic_code: string;
  source: string;
  confidence: number;
  count: number;
  vote_count: number;
  user_ids: string;                   // JSON array
  status: 'candidate' | 'confirmed' | 'rejected';
  context_words: string;              // JSON array
  created_at: string;
  last_used_at: string;
}

export interface CooccurrenceRow {
  id: number;
  word: string;
  context_word: string;
  position: 'before' | 'after' | 'same_sentence';
  distance: number;
  count: number;
  updated_at: string;
}

export interface UserCorrectionRow {
  id: number;
  original_word: string;
  corrected_word: string;
  context_before: string | null;
  context_after: string | null;
  full_sentence: string | null;
  user_id: string | null;
  user_weight: number;
  accepted: number;
  created_at: string;
}

export interface CorrectionSummaryRow {
  id: number;
  original_word: string;
  corrected_word: string;
  total_votes: number;
  weighted_votes: number;
  last_voted_at: string;
}

// Re-export types + DB instance for ergonomic imports:
//   import { sttDb, type LearnedWordRow } from '@/lib/stt-db';
export default sttDb;

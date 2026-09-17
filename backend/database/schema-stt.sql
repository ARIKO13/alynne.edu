-- ──────────────────────────────────────────────────────────────────────────
-- STT Context-Aware Correction Schema (better-sqlite3 / local SQLite)
-- ──────────────────────────────────────────────────────────────────────────
-- Companion to schema.sql (Cloudflare D1 — users, certificates, etc).
-- This file is for the LOCAL SQLite database used by better-sqlite3 for
-- high-frequency STT correction writes (D1 is too slow / costly for this).
--
-- Apply with:  sqlite3 stt.db < schema-stt.sql
-- Or programmatically via stt-db.ts → initSchema() (idempotent).
--
-- Conventions:
--   • INTEGER PK AUTOINCREMENT (rowid alias) for O(1) inserts + small size.
--   • COLLATE NOCASE on word columns (case-insensitive equality, no app-side lowercasing needed for lookups).
--   • JSON stored as TEXT (SQLite has no native JSON1 type; json_extract() used in queries).
--   • Timestamps as TEXT ISO8601 (datetime('now') default for portability with D1).
--   • CRLF + Unix newlines tolerated.
-- ──────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;       -- set at runtime too; harmless here.
PRAGMA synchronous = NORMAL;     -- safe with WAL; full is overkill for STT data.
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;      -- 64 MB page cache (negative = kibibytes).
PRAGMA mmap_size = 268435456;    -- 256 MB memory-mapped I/O.
PRAGMA busy_timeout = 5000;      -- 5s wait on lock contention before SQLITE_BUSY.

-- ============================================================================
-- Table 1: learned_words
-- ============================================================================
-- A dictionary entry that the STT system has "learned" from user speech.
-- Each word may have multiple phonetic variations (for fuzzy matching),
-- and may be promoted from 'candidate' → 'confirmed' after enough votes.
-- ============================================================================
CREATE TABLE IF NOT EXISTS learned_words (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  word                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phonetic_variations TEXT    NOT NULL DEFAULT '[]',  -- JSON array, e.g. ["goce","goseh","gosheh"]
  phonetic_code       TEXT    NOT NULL DEFAULT '',     -- precomputed Double-Metaphone code (idx)
  source              TEXT    NOT NULL DEFAULT 'webspeech',  -- webspeech | whisper | ocr | cv | manual
  confidence          REAL    NOT NULL DEFAULT 0.0,    -- avg STT confidence (0..1)
  count               INTEGER NOT NULL DEFAULT 1,      -- times observed
  vote_count          INTEGER NOT NULL DEFAULT 0,      -- net upvotes from users
  user_ids            TEXT    NOT NULL DEFAULT '[]',   -- JSON array of unique userIds who said it
  status              TEXT    NOT NULL DEFAULT 'candidate'
                              CHECK (status IN ('candidate','confirmed','rejected')),
  context_words       TEXT    NOT NULL DEFAULT '[]',   -- JSON array of frequent context words (denormalized cache)
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indexes — built for the actual query patterns we use:
--   1. Lookup by status (admin list, candidate promotion query)
--   2. Lookup by last_used_at (recency UI sort)
--   3. Lookup by count (confidence signal)
--   4. Phonetic code (when fuzzy-matching unknown STT output)
-- NOTE: word UNIQUE COLLATE NOCASE already auto-creates a case-insensitive index.
CREATE INDEX IF NOT EXISTS idx_learned_words_status       ON learned_words(status);
CREATE INDEX IF NOT EXISTS idx_learned_words_last_used    ON learned_words(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_learned_words_count_active ON learned_words(count DESC) WHERE status != 'rejected';
CREATE INDEX IF NOT EXISTS idx_learned_words_phonetic     ON learned_words(phonetic_code) WHERE phonetic_code != '';
CREATE INDEX IF NOT EXISTS idx_learned_words_confidence   ON learned_words(confidence DESC) WHERE status = 'candidate';

-- Trigger: auto-bump last_used_at on UPDATE? No — we update explicitly in app code
-- to avoid clobbering on partial updates.

-- ============================================================================
-- Table 2: word_cooccurrence
-- ============================================================================
-- For each (word, context_word, position, distance), how many times have
-- they appeared together in observed speech?
--   position = 'before'  → context_word came BEFORE word, at `distance` slots
--   position = 'after'   → context_word came AFTER word, at `distance` slots
--   position = 'same_sentence' → both in same sentence but adjacency unknown (unused by default)
--
-- distance ∈ {1,2,3}: 1 = adjacent, 2 = one word between, 3 = two words between.
-- This is the conditional-probability table: P(context_word | word, position, distance).
-- ============================================================================
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

-- Primary lookup: "for this word, what context words precede/follow it?"
CREATE INDEX IF NOT EXISTS idx_cooccur_word_pos_dist
  ON word_cooccurrence(word, position, distance, count DESC);

-- Reverse lookup: "what words is this context word adjacent to?" (rarely used, kept for analysis)
CREATE INDEX IF NOT EXISTS idx_cooccur_ctx_pos
  ON word_cooccurrence(context_word, position);

-- Hot path: count sums per word (for normalization in computeContextScore)
CREATE INDEX IF NOT EXISTS idx_cooccur_word_only
  ON word_cooccurrence(word);

-- ============================================================================
-- Table 3: user_corrections
-- ============================================================================
-- Each row is ONE vote from ONE user for ONE correction in ONE context.
-- To get net votes:  SELECT corrected_word, COUNT(*) FROM user_corrections
--                    WHERE original_word = ? GROUP BY corrected_word
--
-- user_id may be NULL for anonymous (pre-login) sessions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_corrections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_word   TEXT    NOT NULL COLLATE NOCASE,
  corrected_word  TEXT    NOT NULL COLLATE NOCASE,
  context_before  TEXT,                       -- space-joined words, up to 3 (oldest → newest)
  context_after   TEXT,                       -- space-joined words, up to 3 (newest first)
  full_sentence   TEXT,                       -- original full sentence (for audit)
  user_id         TEXT,                       -- nullable (anonymous)
  user_weight     REAL    NOT NULL DEFAULT 1.0,-- trusted users get higher weight
  accepted        INTEGER NOT NULL DEFAULT 0,  -- 1 if admin promoted this correction to learned_words
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_corr_original             ON user_corrections(original_word);
CREATE INDEX IF NOT EXISTS idx_corr_orig_corrected_votes ON user_corrections(original_word, corrected_word, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corr_user                 ON user_corrections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corr_pending              ON user_corrections(accepted) WHERE accepted = 0;

-- ============================================================================
-- Optional Table 4: correction_summary (materialized aggregation cache)
-- ============================================================================
-- Aggregated vote counts per (original_word → corrected_word) pair.
-- Populated by app code after each user_corrections insert (transactional upsert).
-- Saves us a GROUP BY on every correction request.
-- ============================================================================
CREATE TABLE IF NOT EXISTS correction_summary (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_word   TEXT    NOT NULL COLLATE NOCASE,
  corrected_word  TEXT    NOT NULL COLLATE NOCASE,
  total_votes     INTEGER NOT NULL DEFAULT 0,
  weighted_votes  REAL    NOT NULL DEFAULT 0.0,  -- Σ user_weight
  last_voted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (original_word, corrected_word)
);

CREATE INDEX IF NOT EXISTS idx_corr_summary_orig
  ON correction_summary(original_word, weighted_votes DESC);

-- ============================================================================
-- View: confirmed_or_strong_candidates — for fast fuzzy-candidate lookup
-- ============================================================================
CREATE VIEW IF NOT EXISTS v_fuzzy_candidates AS
  SELECT word, phonetic_variations, phonetic_code, confidence, count, status
  FROM learned_words
  WHERE status IN ('confirmed','candidate')
  ORDER BY count DESC;

-- ============================================================================
-- Optional: FTS5 virtual table for full-text "did you mean" search
-- ============================================================================
-- Skip if not needed; left here for reference. Adds ~5-10 KB per 1000 words.
-- CREATE VIRTUAL TABLE IF NOT EXISTS learned_words_fts USING fts5(
--   word, phonetic_variations, content='learned_words', content_rowid='id'
-- );
-- CREATE TRIGGER IF NOT EXISTS learned_words_ai AFTER INSERT ON learned_words BEGIN
--   INSERT INTO learned_words_fts(rowid, word, phonetic_variations)
--   VALUES (new.id, new.word, new.phonetic_variations);
-- END;

-- ============================================================================
-- Migrations tracker (so initSchema() can skip already-applied migrations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS _schema_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO _schema_migrations (name) VALUES ('baseline_v1');

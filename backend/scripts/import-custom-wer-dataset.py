#!/usr/bin/env python3
"""
Import custom WER-fix dataset (1482 terms) ke SQLite learned_words table.
Run di VPS.
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

DB_PATH = '/root/lina-learning/data/stt.db'
DICT_PATH = '/root/lina-learning/backend/data/datasets/custom-terms.json'


def main():
    if not Path(DB_PATH).exists():
        print(f"[FATAL] SQLite DB not found: {DB_PATH}")
        sys.exit(1)
    if not Path(DICT_PATH).exists():
        print(f"[FATAL] Custom dataset not found: {DICT_PATH}")
        sys.exit(1)

    print(f"── Loading {DICT_PATH} ──")
    with open(DICT_PATH, encoding='utf-8') as f:
        d = json.load(f)

    terms = d.get('terms', [])
    print(f"  Total terms to import: {len(terms)}")
    print(f"  Source: {d.get('_description', 'unknown')}")
    print()

    # Connect to SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    cur = conn.cursor()

    # Check existing entries
    cur.execute("SELECT COUNT(*) FROM learned_words WHERE source = 'custom-wer-fix'")
    existing = cur.fetchone()[0]
    print(f"  Existing custom-wer-fix entries: {existing}")

    # Bulk insert
    print(f"── Importing {len(terms)} terms ──")
    t1 = time.time()
    cur.execute("BEGIN IMMEDIATE")
    inserted = 0
    skipped = 0
    rows = []
    for t in terms:
        word = t['word'].lower().strip()
        if len(word) < 2:
            skipped += 1
            continue
        variations = json.dumps(t.get('phonetic_variations', []))
        rows.append((
            word,
            variations,
            'custom-wer-fix',
            'seeded',  # dataset_origin: seeded (pre-existing dictionary)
            1.0,       # confidence
            0,         # count
            0,         # vote_count
            '[]',      # user_ids
            'confirmed',  # status
            '[]',      # context_words
        ))

    cur.executemany(
        """INSERT OR IGNORE INTO learned_words
           (word, phonetic_variations, source, dataset_origin, confidence, count, vote_count, user_ids, status, context_words)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows
    )
    inserted = cur.rowcount if cur.rowcount > 0 else 0
    conn.commit()
    print(f"  ✓ Inserted (new): {inserted}")
    print(f"  Skipped (already exists): {len(rows) - inserted}")
    print(f"  Time: {time.time() - t1:.2f}s")
    print()

    # Stats by source
    print("── Final stats by source ──")
    cur.execute("SELECT source, COUNT(*) FROM learned_words GROUP BY source ORDER BY COUNT(*) DESC")
    for source, count in cur.fetchall():
        print(f"  {source:25s}: {count:>8,}")
    print()

    cur.execute("SELECT COUNT(*) FROM learned_words")
    total = cur.fetchone()[0]
    print(f"  TOTAL: {total:,}")

    conn.close()
    print("\n── DONE ──")


if __name__ == "__main__":
    main()

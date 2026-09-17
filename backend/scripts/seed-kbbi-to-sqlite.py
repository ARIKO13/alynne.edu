#!/usr/bin/env python3
"""
Seed KBBI 289K words dari stt-dictionary.json ke SQLite learned_words table.

Strategy:
- Baca /root/lina-learning/data/stt-dictionary.json
- Parse field 'k' (KBBI words, dipisah '|')
- Bulk insert ke learned_words dengan:
  * source = 'kbbi'  (distinguish dari auto-learned 'webspeech')
  * status = 'confirmed'  (KBBI sudah pasti valid)
  * confidence = 1.0  (KBBI = ground truth)
  * count = 0  (belum ada occurrence — ini cuma dictionary entry)
  * vote_count = 0
- Skip kata yang sudah ada (idempotent — bisa re-run untuk update KBBI baru)
- Output: stats (total imported, skipped, KBBI total)

Run di VPS:
  python3 /root/lina-learning/backend/scripts/seed-kbbi-to-sqlite.py

Performance note:
- 289K inserts dalam 1 transaction (BEGIN IMMEDIATE)
- Pakai executemany() untuk bulk insert
- Estimasi waktu: 5-15 detik di SSD VPS
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

DB_PATH = '/root/lina-learning/data/stt.db'
DICT_PATH = '/root/lina-learning/data/stt-dictionary.json'


def main():
    if not Path(DB_PATH).exists():
        print(f"[FATAL] SQLite DB not found: {DB_PATH}")
        print("        Pastikan server sudah jalan (stt-db.ts auto-create).")
        sys.exit(1)
    if not Path(DICT_PATH).exists():
        print(f"[FATAL] Dict file not found: {DICT_PATH}")
        sys.exit(1)

    print(f"── Loading {DICT_PATH} ──")
    t0 = time.time()
    with open(DICT_PATH, encoding='utf-8') as f:
        d = json.load(f)
    print(f"  Loaded in {time.time() - t0:.2f}s")
    print(f"  Version: {d.get('_v')}")
    print(f"  Source:  {d.get('_s', '')[:120]}...")
    print()

    # Extract KBBI words from field 'k'
    kbbi_raw = d.get('k', '')
    kbbi_words = [w.lower().strip() for w in kbbi_raw.split('|') if w and w.strip()]
    print(f"── KBBI words to import ──")
    print(f"  Total: {len(kbbi_words)}")
    print()

    # Extract slang (sid field) for context
    slang_data = d.get('sid', {})
    slang_count = 0
    slang_words = []
    if isinstance(slang_data, dict):
        for slang, formal in slang_data.items():
            if isinstance(formal, dict) and formal.get('f'):
                slang_words.append((slang.lower().strip(), formal['f']))
                slang_count += 1
    print(f"── Slang pairs to import (sid) ──")
    print(f"  Total: {slang_count}")
    print()

    # Connect to SQLite
    print(f"── Opening {DB_PATH} ──")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    cur = conn.cursor()

    # Check existing KBBI entries (idempotent)
    cur.execute("SELECT COUNT(*) FROM learned_words WHERE source = 'kbbi'")
    existing_kbbi = cur.fetchone()[0]
    print(f"  Existing KBBI entries: {existing_kbbi}")
    cur.execute("SELECT COUNT(*) FROM learned_words WHERE source = 'webspeech'")
    existing_auto = cur.fetchone()[0]
    print(f"  Existing auto-learned entries: {existing_auto}")
    print()

    # ── BULK INSERT KBBI ──
    print(f"── Seeding {len(kbbi_words)} KBBI words to learned_words ──")
    t1 = time.time()
    cur.execute("BEGIN IMMEDIATE")
    inserted = 0
    skipped = 0
    # Use INSERT OR IGNORE to skip duplicates (idempotent — can re-run)
    # We use 'kbbi' as source so it's distinguishable from auto-learned words
    # dataset_origin='seeded' marks this as pre-existing dictionary data
    # (vs 'user-learned' which is auto-learned from STT)
    rows = []
    for w in kbbi_words:
        if len(w) < 2:
            skipped += 1
            continue
        rows.append((
            w,            # word (lowercase)
            '[]',         # phonetic_variations (KBBI words tidak di-expand)
            'kbbi',       # source
            'seeded',     # dataset_origin (pre-existing dictionary)
            1.0,          # confidence (KBBI = ground truth)
            0,            # count (belum ada occurrence)
            0,            # vote_count
            '[]',         # user_ids
            'confirmed',  # status (KBBI sudah pasti valid)
            '[]',         # context_words
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

    # ── BULK INSERT SLANG ──
    if slang_words:
        print(f"── Seeding {len(slang_words)} slang words ──")
        t2 = time.time()
        cur.execute("BEGIN IMMEDIATE")
        slang_rows = []
        for slang, formal in slang_words:
            slang_rows.append((
                slang,
                json.dumps([formal]),  # store formal form as phonetic variation
                'slang',
                'seeded',  # dataset_origin: pre-existing slang dictionary
                1.0,
                0,
                0,
                '[]',
                'confirmed',
                '[]',
            ))
        cur.executemany(
            """INSERT OR IGNORE INTO learned_words
               (word, phonetic_variations, source, dataset_origin, confidence, count, vote_count, user_ids, status, context_words)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            slang_rows
        )
        slang_inserted = cur.rowcount if cur.rowcount > 0 else 0
        conn.commit()
        print(f"  ✓ Inserted (new): {slang_inserted}")
        print(f"  Time: {time.time() - t2:.2f}s")
        print()

    # ── Final stats ──
    print("── Final DB stats ──")
    cur.execute("SELECT source, status, COUNT(*) FROM learned_words GROUP BY source, status")
    rows = cur.fetchall()
    for source, status, count in rows:
        print(f"  {source:12s} / {status:10s} : {count:>7,}")
    print()

    cur.execute("SELECT COUNT(*) FROM learned_words")
    total = cur.fetchone()[0]
    print(f"  TOTAL: {total:,}")
    print()

    # DB file size
    cur.execute("PRAGMA page_count")
    pages = cur.fetchone()[0]
    cur.execute("PRAGMA page_size")
    page_size = cur.fetchone()[0]
    db_size = pages * page_size
    print(f"── DB file size ──")
    print(f"  Pages: {pages:,} × {page_size:,} bytes = {db_size / 1024 / 1024:.2f} MB")
    print()

    conn.close()
    print("── DONE ──")


if __name__ == "__main__":
    main()

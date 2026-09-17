#!/usr/bin/env python3
"""
Prune dataset entries yang udah ga berguna.

Dijalankan cron harian jam 4am.
2 tasks:
  1. SQLite: hapus word_cooccurrence entries WHERE count=1 AND updated_at < 7 hari lalu
     (noise yang belum divalidasi user lain — kalau 7 hari ga muncul lagi, buang)
  2. D1 (Cloudflare): hapus STTFailure entries WHERE createdAt < 30 hari lalu
     (privacy + storage — ga perlu simpan raw text user terlalu lama)

Output: stats (entries deleted, total sebelum/sesudah)
"""
import json
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timedelta, timezone

DB_PATH = '/root/lina-learning/data/stt.db'

# Cloudflare D1 config (dari /root/lina-learning/ecosystem.config.cjs env)
CF_ACCOUNT_ID = '949a2a6e1039019782c46a8c7ddb19fe'
CF_DATABASE_ID = '2e9133ea-dad7-4227-ac92-03c0fbe48c45'
CF_API_TOKEN = 'cfut_bLNtQhqVmPfkc8jLKydN2QCm52Vw4MmA9cdefw3M5cceff97'

D1_API_URL = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_DATABASE_ID}/query'


def prune_cooccurrence(conn):
    """Prune word_cooccurrence: entries count=1 + >7 days old."""
    print("── Prune word_cooccurrence ──")

    # Count before
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM word_cooccurrence")
    total_before = cur.fetchone()[0]
    print(f"  Total before: {total_before:,}")

    # Delete entries: count=1 AND updated_at < 7 days ago
    cur.execute("""
        DELETE FROM word_cooccurrence
        WHERE count = 1
          AND updated_at < datetime('now', '-7 days')
    """)
    deleted = cur.rowcount if cur.rowcount > 0 else 0
    conn.commit()
    print(f"  Deleted (count=1 + >7 days): {deleted:,}")

    # Count after
    cur.execute("SELECT COUNT(*) FROM word_cooccurrence")
    total_after = cur.fetchone()[0]
    print(f"  Total after: {total_after:,}")
    print()
    return deleted


def prune_learned_words_candidates(conn):
    """Prune learned_words: candidate status + count=1 + >30 days old (no activity)."""
    print("── Prune learned_words (stale candidates) ──")

    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM learned_words WHERE status='candidate'")
    candidates_before = cur.fetchone()[0]
    print(f"  Candidates before: {candidates_before:,}")

    # Delete candidates that haven't been heard in 30 days AND only appeared once
    # (single occurrence + 30 days no activity = likely noise)
    cur.execute("""
        DELETE FROM learned_words
        WHERE status = 'candidate'
          AND count = 1
          AND last_used_at < datetime('now', '-30 days')
    """)
    deleted = cur.rowcount if cur.rowcount > 0 else 0
    conn.commit()
    print(f"  Deleted (candidate + count=1 + >30 days): {deleted:,}")

    cur.execute("SELECT COUNT(*) FROM learned_words WHERE status='candidate'")
    candidates_after = cur.fetchone()[0]
    print(f"  Candidates after: {candidates_after:,}")
    print()
    return deleted


def prune_stt_failures_d1():
    """Prune STTFailure table in D1: entries >30 days old."""
    print("── Prune STTFailure (D1) ──")

    # First count
    count_payload = json.dumps({"sql": "SELECT COUNT(*) as c FROM STTFailure"}).encode()
    req = urllib.request.Request(
        D1_API_URL,
        data=count_payload,
        headers={
            'Authorization': f'Bearer {CF_API_TOKEN}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            total_before = data['result'][0]['results'][0]['c']
            print(f"  Total before: {total_before:,}")
    except Exception as e:
        print(f"  [WARN] Could not count STTFailure: {e}")
        return 0

    # Delete entries older than 30 days
    # Use ISO 8601 timestamp for comparison
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    delete_payload = json.dumps({
        "sql": "DELETE FROM STTFailure WHERE createdAt < ?",
        "params": [cutoff]
    }).encode()
    req = urllib.request.Request(
        D1_API_URL,
        data=delete_payload,
        headers={
            'Authorization': f'Bearer {CF_API_TOKEN}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            changes = data['result'][0]['meta']['changes']
            print(f"  Deleted (>30 days): {changes:,}")
    except Exception as e:
        print(f"  [ERROR] Could not delete STTFailure: {e}")
        return 0

    # Count after
    try:
        with urllib.request.urlopen(urllib.request.Request(
            D1_API_URL,
            data=count_payload,
            headers={
                'Authorization': f'Bearer {CF_API_TOKEN}',
                'Content-Type': 'application/json',
            },
            method='POST',
        ), timeout=30) as resp:
            data = json.loads(resp.read())
            total_after = data['result'][0]['results'][0]['c']
            print(f"  Total after: {total_after:,}")
    except Exception as e:
        print(f"  [WARN] Could not count after: {e}")
    print()
    return 0


def main():
    print(f"── Dataset prune @ {datetime.now(timezone.utc).isoformat()} ──")
    print()

    if not Path(DB_PATH).exists():
        print(f"[FATAL] DB not found: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")

    t0 = time.time()
    deleted_cooc = prune_cooccurrence(conn)
    deleted_candidates = prune_learned_words_candidates(conn)
    conn.close()

    deleted_d1 = prune_stt_failures_d1()

    print("── Summary ──")
    print(f"  Co-occurrence pruned:  {deleted_cooc:,}")
    print(f"  Stale candidates:     {deleted_candidates:,}")
    print(f"  STTFailure (D1):      {deleted_d1:,}")
    print(f"  Total time:           {time.time() - t0:.2f}s")
    print()


if __name__ == '__main__':
    main()

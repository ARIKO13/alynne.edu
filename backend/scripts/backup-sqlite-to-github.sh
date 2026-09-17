#!/usr/bin/env bash
#
# Backup SQLite dataset ke GitHub.
#
# Cron: jalan setiap 6 jam di VPS.
#   0 */6 * * * /root/lina-learning/backend/scripts/backup-sqlite-to-github.sh
#
# Cara kerja:
#   1. WAL checkpoint (pastikan semua data tertulis ke main DB file)
#   2. Copy stt.db ke repo backup (backup/sqlite/)
#   3. git commit + push ke branch 'dataset-backup'
#
# Backup branch terpisah dari main supaya:
#   - Main branch tetap bersih (cuma source code)
#   - Backup branch cuma berisi dataset file
#   - Gampang restore kalau ganti VPS: git clone + copy stt.db
#
# Restore ke VPS baru:
#   git clone -b dataset-backup https://github.com/ARIKO13/alynne.edu.git /tmp/backup
#   cp /tmp/backup/backup/sqlite/stt.db /root/lina-learning/data/stt.db
#   pm2 restart lina-learning
#
set -e

DB_PATH="/root/lina-learning/data/stt.db"
BACKUP_REPO="/root/lina-learning"  # use main repo, commit to backup branch
BACKUP_DIR="$BACKUP_REPO/backup/sqlite"
BRANCH="dataset-backup"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S UTC")

echo "── [$TIMESTAMP] SQLite backup to GitHub ──"

# 1. WAL checkpoint (TRUNCATE = also zero the WAL file)
echo "  WAL checkpoint..."
sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>&1 | head -1

# 2. Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

# 3. Copy DB file (cp is safe karena we just checkpointed — WAL is empty now)
cp "$DB_PATH" "$BACKUP_DIR/stt.db"

# 4. Show stats
TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM learned_words")
SEEDED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM learned_words WHERE dataset_origin='seeded'")
USER_LEARNED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM learned_words WHERE dataset_origin='user-learned'")
COCUR=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM word_cooccurrence")
VOTES=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_corrections")

echo "  Stats:"
echo "    Total words:     $TOTAL"
echo "    Seeded (KBBI/slang): $SEEDED"
echo "    User-learned:     $USER_LEARNED"
echo "    Co-occurrences:   $COCUR"
echo "    User votes:       $VOTES"
echo "    DB size:          $(du -h "$DB_PATH" | cut -f1)"

# 5. Git commit + push (to dataset-backup branch)
cd "$BACKUP_REPO"

# Save current branch
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Create/switch to backup branch
git checkout -B "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

# Add only the backup file
git add backup/sqlite/stt.db

# Commit (will fail gracefully if no changes)
git commit -m "chore: backup SQLite dataset ($TIMESTAMP)

Stats:
- Total words: $TOTAL
- Seeded (KBBI/slang): $SEEDED
- User-learned: $USER_LEARNED
- Co-occurrences: $COCUR
- User votes: $VOTES
- DB size: $(du -h "$DB_PATH" | cut -f1)

Auto-backup by cron (every 6 hours)." 2>&1 | tail -3

# Push to GitHub
echo "  Pushing to GitHub (branch: $BRANCH)..."
git push origin "$BRANCH" 2>&1 | tail -3

# Switch back to original branch
git checkout "$ORIG_BRANCH" 2>/dev/null

echo "── Backup complete ──"

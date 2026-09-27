#!/usr/bin/env bash
#
# ATA production database backup.
# Installed to /usr/local/sbin/ata-db-backup.sh, run by ata-db-backup.timer.
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS INSTEAD OF `npm run db:backup`
#
# The repository ships backend/scripts/backup/backupSqlite.ts, and it is not
# usable for this job, for two independent reasons:
#
#  1. IT IS NOT A CONSISTENT SNAPSHOT. It does `fs.copyFile` on a live database.
#     A plain file copy of an open SQLite database can capture a write that is
#     only half applied, and with a -wal file present it can miss committed
#     transactions entirely. Its verification step reads the first 16 bytes and
#     checks for the "SQLite format 3" magic — which a torn copy still has. So
#     it can report success over a corrupt backup.
#
#  2. IT CANNOT RUN ON A PRODUCTION RELEASE ANYWAY. It is invoked through `tsx`
#     and starts with `import "dotenv/config"`. Both `tsx` and `prisma` (which
#     is what transitively supplies `dotenv` — it is not a declared dependency
#     of this project at all) are devDependencies, and the release artifact is
#     built with `npm prune --omit=dev`.
#
# `sqlite3 .backup` uses SQLite's online backup API: it takes a read lock, copies
# page by page, and restarts if a writer intervenes. The result is a consistent
# database file, taken while the service keeps serving.
# ---------------------------------------------------------------------------

set -euo pipefail

DB_PATH="${ATA_DB_PATH:-/srv/ata-data/db/app.db}"
BACKUP_DIR="${ATA_BACKUP_DIR:-/srv/ata-data/backups}"
S3_BUCKET="${ATA_BACKUP_S3_BUCKET:-}"      # e.g. s3://my-ata-backups  (optional)
RETAIN_DAYS="${ATA_BACKUP_RETAIN_DAYS:-14}"

log() { printf '[ata-db-backup] %s\n' "$1"; }
die() { printf '[ata-db-backup] FAILED: %s\n' "$1" >&2; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 is not installed"
[ -f "$DB_PATH" ] || die "database not found at $DB_PATH"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/app-${STAMP}.db"

log "snapshotting $DB_PATH"
sqlite3 "$DB_PATH" ".backup '$OUT'" || die "sqlite3 .backup failed"

# Verify the BACKUP, not the source. A backup that has never been checked is not
# a backup. integrity_check walks the whole b-tree — unlike a header sniff, it
# actually fails on a torn file.
log "verifying"
RESULT="$(sqlite3 "$OUT" 'PRAGMA integrity_check;' 2>&1)"
[ "$RESULT" = "ok" ] || { rm -f "$OUT"; die "integrity_check on the backup returned: $RESULT"; }

gzip -9 "$OUT"
OUT="${OUT}.gz"
log "wrote $OUT ($(du -h "$OUT" | cut -f1))"

if [ -n "$S3_BUCKET" ]; then
  command -v aws >/dev/null || die "ATA_BACKUP_S3_BUCKET is set but the aws CLI is not installed"
  # Off-instance copy. EBS snapshots protect against disk failure; this protects
  # against the instance and its volume being lost or deleted together.
  aws s3 cp "$OUT" "${S3_BUCKET%/}/db/$(basename "$OUT")" --only-show-errors \
    || die "upload to $S3_BUCKET failed"
  log "uploaded to ${S3_BUCKET%/}/db/"
else
  log "ATA_BACKUP_S3_BUCKET not set — local copy only (on the same volume as the database)"
fi

# Local pruning only. Retention of the off-instance copies belongs to the S3
# bucket's own lifecycle policy, so that deleting them requires bucket
# permissions rather than a shell on this box.
find "$BACKUP_DIR" -name 'app-*.db.gz' -mtime "+${RETAIN_DAYS}" -delete
log "done"

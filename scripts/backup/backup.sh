#!/usr/bin/env bash
# Chamber Assistant — database backup (spec §47).
#
#   DATABASE_URL=postgresql://… BACKUP_DIR=/var/backups/chamber scripts/backup/backup.sh
#
# Writes a compressed custom-format pg_dump plus a SHA-256 checksum and a JSON
# manifest (row counts of core tables, latest migration) under $BACKUP_DIR/daily.
# Sunday backups are also kept as weekly, first-of-month backups as monthly.
# Retention: BACKUP_KEEP_DAILY (7), BACKUP_KEEP_WEEKLY (5), BACKUP_KEEP_MONTHLY (12).
#
# Optional:
#   BACKUP_PASSPHRASE_FILE  encrypt the dump with AES-256 (openssl, PBKDF2)
#   BACKUP_UPLOAD_CMD       command run with the backup file paths as arguments to copy
#                           them off-site, e.g. 'rclone copy --immutable {} remote:chamber/'
#                           ({} is replaced by each file); failure fails the backup
#   FILES_DIR               directory of uploaded files to archive alongside the dump
#
# A backup is not considered good until scripts/backup/verify.sh has restored it.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-5}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"
DB_URL="${DATABASE_URL%%\?*}"   # pg tools do not understand Prisma's ?schema=… parameter

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
base="$BACKUP_DIR/daily/chamber_$stamp"
tmp="$base.partial"
trap 'rm -f "$tmp" "$tmp.enc"' EXIT

log "dumping database"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp" "$DB_URL"
pg_restore --list "$tmp" >/dev/null   # the archive must at least be readable

counts="$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT json_build_object(
  'organizations', (SELECT count(*) FROM organizations),
  'chambers', (SELECT count(*) FROM chambers),
  'users', (SELECT count(*) FROM users),
  'patients', (SELECT count(*) FROM patients),
  'appointments', (SELECT count(*) FROM appointments),
  'consultations', (SELECT count(*) FROM consultations),
  'prescriptions', (SELECT count(*) FROM prescriptions),
  'prescription_versions', (SELECT count(*) FROM prescription_versions),
  'invoices', (SELECT count(*) FROM invoices),
  'payments', (SELECT count(*) FROM payments),
  'audit_logs', (SELECT count(*) FROM audit_logs));
SQL
)"
latest="$(psql "$DB_URL" -At -c "SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"

file="$base.dump"
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$tmp" -out "$tmp.enc"
  file="$base.dump.enc"
  mv "$tmp.enc" "$file"
  rm -f "$tmp"
else
  mv "$tmp" "$file"
fi
( cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256" )

files_archive=""
if [[ -n "${FILES_DIR:-}" && -d "${FILES_DIR}" ]]; then
  files_archive="$base.files.tar.gz"
  tar -czf "$files_archive" -C "$FILES_DIR" .
  ( cd "$(dirname "$files_archive")" && sha256sum "$(basename "$files_archive")" > "$(basename "$files_archive").sha256" )
fi

cat > "$base.manifest.json" <<JSON
{
  "createdAt": "$(date -u +%FT%TZ)",
  "file": "$(basename "$file")",
  "encrypted": $([[ "$file" == *.enc ]] && echo true || echo false),
  "sizeBytes": $(stat -c %s "$file"),
  "sha256": "$(cut -d' ' -f1 "$file.sha256")",
  "latestMigration": "$latest",
  "filesArchive": $([[ -n "$files_archive" ]] && echo "\"$(basename "$files_archive")\"" || echo null),
  "counts": $counts
}
JSON

# Grandfather-father-son copies (hard links, no extra space).
set -- "$file" "$file.sha256" "$base.manifest.json" ${files_archive:+"$files_archive" "$files_archive.sha256"}
if [[ "$(date -u +%u)" == 7 ]]; then for f in "$@"; do ln -f "$f" "$BACKUP_DIR/weekly/"; done; fi
if [[ "$(date -u +%d)" == 01 ]]; then for f in "$@"; do ln -f "$f" "$BACKUP_DIR/monthly/"; done; fi

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  for f in "$@"; do
    log "uploading $(basename "$f")"
    eval "${BACKUP_UPLOAD_CMD//\{\}/\"$f\"}"
  done
fi

prune() { # dir keep
  local dir="$1" keep="$2"
  { ls -1t "$dir"/chamber_*.manifest.json 2>/dev/null || true; } | tail -n +"$((keep + 1))" | while read -r m; do
    rm -f "${m%.manifest.json}".*
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

log "ok $(basename "$file") ($(du -h "$file" | cut -f1))"
echo "$base.manifest.json"

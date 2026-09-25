#!/usr/bin/env bash
# Chamber Assistant — restore a backup into a database (spec §47).
#
#   TARGET_DATABASE_URL=postgresql://…/chamber_restore scripts/backup/restore.sh backups/daily/chamber_….manifest.json
#
# The target database must exist and be EMPTY — this script never overwrites a
# database that already has tables (pass --force to restore into a non-empty
# database after you have moved the old one aside). Checks the SHA-256 first and
# decrypts with BACKUP_PASSPHRASE_FILE when the backup is encrypted.
# RESTORE_OWNER (e.g. chamber_app) makes that role the owner of every restored
# object — required when restoring the live database, so migrations can run.
set -euo pipefail

manifest="${1:?usage: restore.sh <manifest.json> [--force]}"
force="${2:-}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
TARGET="${TARGET_DATABASE_URL%%\?*}"
dir="$(cd "$(dirname "$manifest")" && pwd)"
file="$dir/$(sed -n 's/.*"file": "\([^"]*\)".*/\1/p' "$manifest")"

log() { printf '%s restore: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

( cd "$dir" && sha256sum --check --quiet "$(basename "$file").sha256" ) || { log "checksum mismatch for $file"; exit 2; }

tables="$(psql "$TARGET" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "$tables" != 0 && "$force" != "--force" ]]; then
  log "target database is not empty ($tables tables); refusing to restore"
  exit 3
fi

dump="$file"
if [[ "$file" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE_FILE:?encrypted backup: BACKUP_PASSPHRASE_FILE is required}"
  dump="$(mktemp)"
  trap 'rm -f "$dump"' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" -out "$dump"
fi

log "restoring $(basename "$file")"
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction ${RESTORE_OWNER:+--role="$RESTORE_OWNER"} --dbname="$TARGET" "$dump"
# Database-level settings are not part of a dump.
psql "$TARGET" -q -c "DO \$\$ BEGIN EXECUTE format('ALTER DATABASE %I SET jit = off', current_database()); END \$\$"
log "done"

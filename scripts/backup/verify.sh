#!/usr/bin/env bash
# Chamber Assistant — prove a backup can be restored (spec §47: "never consider a
# backup successful merely because a file was generated").
#
#   ADMIN_DATABASE_URL=postgresql://…/postgres scripts/backup/verify.sh [manifest.json]
#
# Restores the given (default: newest) backup into a temporary database, runs the
# integrity check (migrations, audit hash chain, row counts against the manifest),
# then drops the temporary database. Exit code 0 only if everything matched.
# ADMIN_DATABASE_URL needs the CREATEDB privilege.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL is required (a role with CREATEDB)}"
ADMIN="${ADMIN_DATABASE_URL%%\?*}"
here="$(cd "$(dirname "$0")" && pwd)"
api="$here/../../apps/api"
manifest="${1:-$(ls -1t "$BACKUP_DIR"/daily/chamber_*.manifest.json | head -1)}"
[[ -f "$manifest" ]] || { echo "no backup manifest found" >&2; exit 2; }

db="chamber_verify_$(date -u +%Y%m%d%H%M%S)_$$"
target="${ADMIN%/*}/$db"
cleanup() { psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$db\"" || true; }
trap cleanup EXIT

started=$(date +%s)
psql "$ADMIN" -q -c "CREATE DATABASE \"$db\""
TARGET_DATABASE_URL="$target" "$here/restore.sh" "$manifest"
DATABASE_URL="$target" node "$api/dist/cli/verify-database.js" --expect "$manifest" > "$manifest.verify.json" || {
  cat "$manifest.verify.json" >&2
  echo "$(date -u +%FT%TZ) verify: FAILED $(basename "$manifest")" >&2
  exit 1
}
echo "$(date -u +%FT%TZ) verify: ok $(basename "$manifest") restored and checked in $(( $(date +%s) - started ))s"

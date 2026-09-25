#!/bin/sh
# Runs inside the backup container: a backup every day at BACKUP_TIME (UTC, HH:MM),
# each immediately verified by a test restore. Results go to stdout for the log
# collector and to /backups/.last-run, which the container healthcheck reads: a
# failed backup or verification turns the container unhealthy (alert on it)
# without a restart loop.
set -eu
: "${BACKUP_TIME:=02:30}"
export BACKUP_DIR="${BACKUP_DIR:-/backups}"
pw="$(cat /run/secrets/postgres_password)"
export DATABASE_URL="postgresql://postgres:${pw}@${DB_HOST:-db}:5432/${DB_NAME:-chamber}"
export ADMIN_DATABASE_URL="postgresql://postgres:${pw}@${DB_HOST:-db}:5432/postgres"
[ -f /run/secrets/backup_passphrase ] && export BACKUP_PASSPHRASE_FILE=/run/secrets/backup_passphrase

run() {
  if manifest="$(/app/scripts/backup/backup.sh)" && /app/scripts/backup/verify.sh "$manifest"; then
    echo "ok $(date -u +%FT%TZ) $(basename "$manifest")" > "$BACKUP_DIR/.last-run"
  else
    echo "failed $(date -u +%FT%TZ)" > "$BACKUP_DIR/.last-run"
    echo "$(date -u +%FT%TZ) scheduler: BACKUP OR VERIFICATION FAILED" >&2
  fi
}

# `backup-scheduler.sh --once`: a single verified backup (manual / pre-upgrade), exit code = result.
if [ "${1:-}" = "--once" ]; then
  run
  grep -q "^ok" "$BACKUP_DIR/.last-run"
  exit $?
fi

[ "${BACKUP_ON_START:-false}" = "true" ] && run
while :; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%F) $BACKUP_TIME" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  echo "$(date -u +%FT%TZ) scheduler: next backup at $(date -u -d @"$next" +%FT%TZ)"
  sleep $((next - now))
  run
done

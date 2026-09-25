#!/bin/sh
# Builds DATABASE_URL from DB_* variables and a password file (Docker/Kubernetes
# secret) so the password never sits in the environment definition, then runs CMD.
set -eu
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_PASSWORD_FILE:-}" ]; then
  DATABASE_URL="$(node -e '
    const fs = require("fs");
    const pw = encodeURIComponent(fs.readFileSync(process.env.DB_PASSWORD_FILE, "utf8").trim());
    const e = process.env;
    process.stdout.write(`postgresql://${encodeURIComponent(e.DB_USER || "chamber_app")}:${pw}@${e.DB_HOST || "db"}:${e.DB_PORT || 5432}/${e.DB_NAME || "chamber"}?schema=public`);
  ')"
  export DATABASE_URL
fi
if [ -n "${METRICS_TOKEN_FILE:-}" ] && [ -z "${METRICS_TOKEN:-}" ]; then
  METRICS_TOKEN="$(cat "$METRICS_TOKEN_FILE")"
  export METRICS_TOKEN
fi
exec "$@"

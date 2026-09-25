#!/bin/sh
# Generates random secrets for a new environment (never overwrites existing ones).
# Store the backup passphrase somewhere safe OUTSIDE the server: without it the
# encrypted backups cannot be restored.
set -eu
cd "$(dirname "$0")"
# The directory is private (0700); the files are 0644 because Compose bind-mounts
# them into containers that run as non-root users (postgres, node).
mkdir -p secrets
chmod 700 secrets
umask 022
for name in postgres_password app_db_password metrics_token backup_passphrase; do
  [ -f "secrets/$name" ] || openssl rand -base64 36 | tr -d '\n/+=' > "secrets/$name"
done
if [ ! -f secrets/bootstrap_admin_password ]; then
  # Meets the password policy (upper, lower, digit); must be changed at first sign-in.
  printf 'Ch-%s-9a' "$(openssl rand -base64 18 | tr -d '\n/+=')" > secrets/bootstrap_admin_password
fi
ls -l secrets
echo "First super admin password: secrets/bootstrap_admin_password"

# Host directory for backups, writable by the backup container's postgres user (uid 999).
mkdir -p backups
if [ "$(id -u)" = 0 ]; then chown 999:999 backups && chmod 700 backups; else echo "Run: sudo chown 999:999 $(pwd)/backups"; fi

#!/bin/sh
# First start of the database container only: creates the application role
# (not a superuser) that owns the application database. The postgres superuser
# is kept for administration and backups.
set -eu
APP_PASSWORD="$(cat /run/secrets/app_db_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set app_password="$APP_PASSWORD" <<'SQL'
CREATE ROLE chamber_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE chamber OWNER chamber_app;
REVOKE ALL ON DATABASE chamber FROM PUBLIC;
SQL

# Operations: deployment, backups, recovery and monitoring

Covers spec §47 (backup & recovery), §63 (deployment architecture) and §64 (observability).

## Architecture

```
            Internet (HTTPS 443, HTTP 80 → redirect)
                          │
                ┌─────────▼─────────┐
                │  web  (Caddy)     │  TLS · HSTS/CSP · static SPA · gzip/zstd
                │  network: edge    │  /api/* → api:4000   (/api/metrics blocked)
                └─────────┬─────────┘
                ┌─────────▼─────────┐
                │  api  (NestJS)    │  non-root, read-only FS, JSON logs,
                │  edge + backend   │  /api/health · /api/health/ready · /api/metrics
                └─────────┬─────────┘
  ┌─────────────┐  ┌──────▼──────┐  ┌──────────────────────────┐
  │ migrate     │─▶│ db          │◀─│ backup                    │
  │ (one-shot)  │  │ PostgreSQL16│  │ daily dump → verify by    │
  │ migrations +│  │ backend only│  │ test restore → off-site   │
  │ bootstrap   │  │ (internal)  │  │                           │
  └─────────────┘  └─────────────┘  └──────────────────────────┘
```

Images (built from the repository root):

| Image | Dockerfile | Contents |
|---|---|---|
| `chamber-api` | `apps/api/Dockerfile` (target `runtime`) | API build, production dependencies, Prisma migrations, `dist-seed` bootstrap. Runs as `node`. |
| `chamber-backup` | `apps/api/Dockerfile` (target `backup`) | PostgreSQL 16 client tools + Node + the API build (for restore verification). Runs as `postgres`. |
| `chamber-web` | `apps/web/Dockerfile` | Built SPA + `deploy/Caddyfile` on `caddy:2-alpine`. |

## Environments

| Environment | How | Data |
|---|---|---|
| Development | `docker compose up -d db` (root `docker-compose.yml`), `npm run dev:api`, `npm run dev:web` | demo seed (`npm run db:seed`) |
| Test / CI | `npm run test:e2e`: every run creates and drops its own database | demo seed |
| Staging | `deploy/` stack with `env/staging.env`, its own secrets and host | anonymised or demo data only |
| Production | `deploy/` stack with `env/production.env` | real data |

Configuration comes from environment variables, validated at startup (the API refuses to
start on invalid values, insecure cookies in production, or non-HTTPS origins). Secrets are
files in `deploy/secrets/` mounted as Docker secrets. They are **never** committed, baked into
images or written in env files.

## First deployment

Requirements: a Linux host with Docker Engine 24+ and the Compose plugin, a DNS record
pointing at the host, and ports 80 and 443 open.

```bash
git clone … && cd Doctor-Chamber-Management-System/deploy
cp env/production.env.example env/production.env    # set SITE_DOMAIN, BOOTSTRAP_ADMIN_EMAIL, …
./make-secrets.sh                                    # random secrets + backups/ directory
docker compose -f docker-compose.prod.yml --env-file env/production.env up -d --build
docker compose -f docker-compose.prod.yml --env-file env/production.env ps
```

1. `db` starts, and its init script creates the non-superuser role `chamber_app` and the
   `chamber` database.
2. `migrate` runs `prisma migrate deploy`, then `bootstrap`:
   * roles, permissions and clinical reference data are synchronized;
   * the first super admin is created from `BOOTSTRAP_ADMIN_EMAIL` and
     `secrets/bootstrap_admin_password`.
3. `api` starts once migrations have succeeded. `web` starts once the API is healthy and
   obtains a TLS certificate for `SITE_DOMAIN`.
4. Sign in at `https://SITE_DOMAIN` with the bootstrap admin. The app forces a password change.
   Then create the organization, chambers and users.
5. **Copy `secrets/backup_passphrase` to a password manager or safe, off the server.** Without
   it the encrypted backups cannot be restored.

Demo data is never created in production: the bootstrap has no demo option and the login
page hides demo accounts outside development.

## Upgrades

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file env/production.env build
docker compose -f docker-compose.prod.yml --env-file env/production.env run --rm backup backup-scheduler.sh --once   # verified pre-upgrade backup
docker compose -f docker-compose.prod.yml --env-file env/production.env up -d
```

Migrations are forward-only and applied by the `migrate` job before the new API starts. If a
migration fails, the old API keeps running and `/api/health/ready` on the new one reports
`migrations: failed`. To roll back, redeploy the previous image tag (`APP_VERSION`). If a
migration changed data, restore the pre-upgrade backup (see below).

## Backups (spec §47)

The `backup` service runs every day at `BACKUP_TIME` (UTC). Each run:

1. **`scripts/backup/backup.sh`** writes `pg_dump --format=custom` (compressed) and encrypts
   it with AES-256 (OpenSSL, PBKDF2 200k iterations, key from `secrets/backup_passphrase`).
   It also writes a SHA-256 checksum and a manifest: size, latest migration, row counts of the
   core tables.
2. Keeps grandfather-father-son copies (hard links): 14 daily, 8 weekly (Sunday) and 24
   monthly (1st of month) in production. Retention is configurable.
3. Optionally copies every file off-site with `BACKUP_UPLOAD_CMD`. Use an object store with
   object lock / immutability, e.g. `rclone copy --immutable {} offsite:chamber-backups/`.
4. **`scripts/backup/verify.sh`** proves the backup is restorable. It restores it into a
   temporary database and runs `verify-database`:
   * every migration is applied;
   * the audit hash chain is intact;
   * row counts match the manifest.

   It then drops the temporary database. A backup counts as good only after this step.
5. Writes the result to `backups/.last-run`. The container turns **unhealthy** if the last
   run failed or nothing succeeded for 26 hours, so alert on container health.

Tested behaviour (Phase 8):

| Case | Result |
|---|---|
| Backup → restore → verify (plain and encrypted) | ok, 1–2 s on demo data |
| 100k patients / 110k consultations (41 MB dump) | backup 5 s, restore + verify 15 s |
| Wrong passphrase | restore fails ("bad decrypt"), verification fails |
| Corrupted dump (1 byte changed) | checksum mismatch, nothing restored |
| Row count differs from the manifest | verification fails, naming the table |
| Tampered audit row in the restored copy | verification fails, naming the broken record |
| Restore into a non-empty database | refused (needs `--force`) |
| Recovery drill, scenario A on the full Docker stack | a change made after the backup was rolled back, migrations re-ran, API ready, sign-in works (≈ 1 min) |

Uploaded files: logos and signatures are stored in the database, so the dump covers them.
When patient attachments are added, point `FILES_DIR` at the upload directory and it is
archived with every backup.

Manual backup at any time:

```bash
docker compose -f docker-compose.prod.yml --env-file env/production.env run --rm backup backup-scheduler.sh --once
```

## Restore / disaster recovery

**Targets:** RPO ≤ 24 h (daily backups; add WAL archiving or a second daily run for less) ·
RTO ≤ 1 h (demo-size restore in seconds; 100k patients in ~15 s, plus deployment time).

**Scenario A: bad data or a bad migration, server intact**

```bash
cd deploy
C="docker compose -f docker-compose.prod.yml --env-file env/production.env"
$C stop api web                                          # stop writes
$C exec db psql -U postgres -c "ALTER DATABASE chamber RENAME TO chamber_broken_$(date +%Y%m%d)"
$C exec db psql -U postgres -c "CREATE DATABASE chamber OWNER chamber_app"
$C run --rm -e TARGET_DATABASE_URL="postgresql://postgres:$(cat secrets/postgres_password)@db:5432/chamber" \
   -e BACKUP_PASSPHRASE_FILE=/run/secrets/backup_passphrase -e RESTORE_OWNER=chamber_app \
   backup /app/scripts/backup/restore.sh /backups/daily/chamber_<timestamp>.manifest.json
$C run --rm -e DATABASE_URL="postgresql://postgres:$(cat secrets/postgres_password)@db:5432/chamber" \
   backup node /app/apps/api/dist/cli/verify-database.js --expect /backups/daily/chamber_<timestamp>.manifest.json
$C up -d                                                 # migrate job re-applies newer migrations if any
```

Keep `chamber_broken_*` until the restore is confirmed, then drop it.

**Scenario B: server lost**

1. Provision a new host, then clone the repository and restore `deploy/env/production.env`
   and `deploy/secrets/*` from your secure store (at least `backup_passphrase`).
2. Fetch the newest verified backup from off-site storage into `deploy/backups/daily/`.
3. `docker compose … up -d db`, restore as in scenario A (the `chamber` database is created
   empty by the init script), then `docker compose … up -d`.
4. Point DNS at the new host. Caddy obtains a new certificate automatically.
5. Tell users to sign in again. Sessions from the old server are not valid.

**Drills:** the daily verification is an automated restore drill. Additionally, perform
scenario B on a staging host **every quarter** and record the time taken.

## Monitoring (spec §64)

| Signal | Where |
|---|---|
| Liveness | `GET /api/health` (process up, version, uptime); Docker `HEALTHCHECK` |
| Readiness | `GET /api/health/ready`: database reachable, no failed migrations; 503 otherwise |
| Application logs | JSON lines on stdout (`LOG_FORMAT=json`): one `http.request` event per request with request id, method, route pattern, status, duration, user and chamber ids |
| Error monitoring | `http.error` events (5xx) with request id; stack traces stay server-side. Ship stdout to Loki/ELK/CloudWatch and alert on `level=error` |
| API latency | `/api/metrics` (Prometheus): `http_request_duration_seconds` histogram and `http_requests_total` per route and status. Blocked at the edge; scrape it inside the network with `Authorization: Bearer $(cat secrets/metrics_token)` |
| Database | `db_query_duration_seconds`, `db_slow_queries_total`; `db.slow_query` log events (SQL only) above `SLOW_QUERY_MS`; Postgres logs statements > 500 ms |
| Authentication and security events | `security.*` log events (failed and blocked logins, lockouts, password resets and changes, permission and security-setting changes, exports, 401/403/429); the audit log in the app |
| Platform overview | Super admin dashboard → **System health**: database latency and size, p95 latency, error rate, failed sign-ins (24 h), active sessions, version and uptime |
| Backups | `backup` container health; `backups/*.verify.json` reports |
| Audit integrity | Dashboard "Audit trail integrity" and `GET /api/audit-logs/verify` |

Suggested alerts:
* readiness failing for more than 2 minutes;
* 5xx rate above 1% over 5 minutes;
* p95 latency above 1 s over 10 minutes;
* backup container unhealthy;
* more than 20 `security.auth.account_locked` events per hour;
* audit chain invalid;
* disk above 80%.

Logs never contain request bodies, query strings, patient names or clinical values.

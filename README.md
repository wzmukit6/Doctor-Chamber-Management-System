# Chamber Assistant

**Modern doctor practice & prescription management system** — patients, appointments, queue,
consultations, prescriptions, billing and reports for doctors' chambers, with strict role-based
access control, multi-chamber tenancy and a tamper-evident audit trail.

> All **eight delivery phases are complete**: foundation
> (authentication, users, roles & permissions, organizations/chambers, audit logs), patient
> management (registration, search, profile, medical history, timeline) and appointments & queue
> (calendar, doctor schedules, booking with conflict prevention, check-in, live token queue) and the
> clinical workflow (consultation workspace, vitals, diagnoses, investigations, finalization) and
> prescriptions (medicine database, smart builder, templates, versioned revisions, A4/A5 print & PDF,
> QR verification) and billing (bills, payments & refunds ledger, receipts, dues, fee schedule) and reports &
> administration (19 role-scoped reports with CSV/Excel/PDF export, dashboard analytics, chamber,
> doctor-profile and security settings) and hardening (security audit, every-role × every-endpoint
> authorization tests, performance tuning on 100k patients, verified backups, disaster recovery,
> Docker production deployment, monitoring).
> See [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, request/authorization lifecycle, tenancy, security controls, folder structure |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD (current + planned), conventions, constraints |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Generated permission matrix and scope rules |
| [docs/API.md](docs/API.md) | API conventions, error codes, endpoint list (OpenAPI at `/api/docs`) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and status |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Production deployment, environments, backups, disaster recovery, monitoring |
| [docs/SECURITY.md](docs/SECURITY.md) | Security audit: controls, test coverage, findings fixed, residual risks |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Benchmark method, optimizations, results on a 100k-patient dataset |

## Tech stack

* **API** — Node.js 22, NestJS 11, Prisma 6, PostgreSQL 16, zod, Argon2id
* **Web** — React 19, Vite, TanStack Query, react-hook-form, Tailwind CSS, i18next (English / বাংলা)
* **Shared** — `@chamber/shared`: permissions, roles, validation schemas, error codes, DTO types

## Getting started

Prerequisites: Node.js ≥ 20 and either Docker or PostgreSQL ≥ 14.

**Quick start: two commands**

```bash
npm run setup     # .env, dependencies, database (Docker if available), migrations, demo data
npm run dev       # API on http://localhost:4000 and web app on http://localhost:5173
```

Open http://localhost:5173 and sign in with a demo account below. `npm run setup` is safe to
re-run; pass `-- --no-docker` to use your own PostgreSQL from `apps/api/.env`.

**Step by step (what `setup` does)**

```bash
npm install
cp apps/api/.env.example apps/api/.env      # adjust DATABASE_URL if needed
npm run build:shared
npm run db:migrate                          # apply migrations (dev database)
npm run db:seed                             # roles, permissions and clearly-marked demo data
npm run dev:api                             # http://localhost:4000  (docs: /api/docs)
npm run dev:web                             # http://localhost:5173  (proxies /api)
```

### Demo accounts (development only)

All use the password `Demo@12345`. Demo data contains no real patient information.

| Role | Email | Chamber |
|---|---|---|
| Super Admin | superadmin@demo.chamber.local | — (platform) |
| Manager | manager@demo.chamber.local | Dhanmondi |
| Doctor | doctor@demo.chamber.local | Dhanmondi |
| Assistant | assistant@demo.chamber.local | Dhanmondi |
| Manager | manager.b@demo.chamber.local | Uttara |
| Doctor | doctor.b@demo.chamber.local | Uttara |

The second chamber exists to demonstrate tenant isolation: Dhanmondi staff cannot see Uttara data.
Both chambers have fictional demo patients (phones `01700000100`–`…111` in Dhanmondi).
Running `npm run db:seed` also creates a live-looking queue for Dr. Demo Rahman around the current
time (finished visits, a patient with the doctor, patients waiting) if today has no appointments yet.

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | shared build + API unit tests + web unit tests |
| `npm run test:e2e` | API integration tests (creates and drops a throwaway `chamber_e2e_*` database) |
| `npm run typecheck` | type-check all workspaces |
| `npm run build` | production build of all workspaces |
| `npm run docs:permissions` | regenerate `docs/PERMISSIONS.md` from the code |
| `scripts/backup/backup.sh` · `restore.sh` · `verify.sh` | database backup, restore, and restore-verification (see OPERATIONS.md) |
| `node apps/api/dist/cli/verify-database.js` | integrity check: migrations, audit hash chain, row counts |
| `scripts/perf/benchmark.mjs` | API latency benchmark (see PERFORMANCE.md) |

## Production deployment

```bash
cd deploy
cp env/production.env.example env/production.env   # set SITE_DOMAIN, BOOTSTRAP_ADMIN_EMAIL
./make-secrets.sh
docker compose -f docker-compose.prod.yml --env-file env/production.env up -d --build
```

This runs PostgreSQL, a one-shot migration and bootstrap job (creates the first super admin,
who must change the password), the API, Caddy (automatic HTTPS, static SPA, `/api` proxy) and a
backup worker that takes a daily encrypted backup and proves it by a test restore.
Full runbook: [docs/OPERATIONS.md](docs/OPERATIONS.md).

Integration tests need a PostgreSQL user that may create databases; configure it in
`apps/api/.env.test`.

## Repository layout

```
apps/api         NestJS REST API, Prisma schema, migrations, seed, tests
apps/web         React web client
packages/shared  Permission model, zod schemas, error codes, shared types
deploy/          Production stack: compose file, Caddyfile, env templates, secrets script
docs/            Architecture, database, permissions, API, security, performance, operations
scripts/         Documentation generator, backup/restore/verify, performance tooling
```

## Clinical safety

This is a practice-management and prescription-recording system. It never makes clinical
decisions; the doctor remains responsible for diagnosis, medicines, dosage, investigations and
advice. Finalized clinical records are versioned and traceable, never silently modified.

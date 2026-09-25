# Chamber Assistant

**Modern doctor practice & prescription management system** — patients, appointments, queue,
consultations, prescriptions, billing and reports for doctors' chambers, with strict role-based
access control, multi-chamber tenancy and a tamper-evident audit trail.

> The application is delivered phase by phase. **Phases 1–7 are complete**: foundation
> (authentication, users, roles & permissions, organizations/chambers, audit logs), patient
> management (registration, search, profile, medical history, timeline) and appointments & queue
> (calendar, doctor schedules, booking with conflict prevention, check-in, live token queue) and the
> clinical workflow (consultation workspace, vitals, diagnoses, investigations, finalization) and
> prescriptions (medicine database, smart builder, templates, versioned revisions, A4/A5 print & PDF,
> QR verification) and billing (bills, payments & refunds ledger, receipts, dues, fee schedule) and reports &
> administration (19 role-scoped reports with CSV/Excel/PDF export, dashboard analytics, chamber,
> doctor-profile and security settings).
> See [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, request/authorization lifecycle, tenancy, security controls, folder structure |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD (current + planned), conventions, constraints |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Generated permission matrix and scope rules |
| [docs/API.md](docs/API.md) | API conventions, error codes, endpoint list (OpenAPI at `/api/docs`) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and status |

## Tech stack

* **API** — Node.js 22, NestJS 11, Prisma 6, PostgreSQL 16, zod, Argon2id
* **Web** — React 19, Vite, TanStack Query, react-hook-form, Tailwind CSS, i18next (English / বাংলা)
* **Shared** — `@chamber/shared`: permissions, roles, validation schemas, error codes, DTO types

## Getting started

Prerequisites: Node.js ≥ 20 and PostgreSQL ≥ 14 (or `docker compose up -d db`).

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

Integration tests need a PostgreSQL user that may create databases; configure it in
`apps/api/.env.test`.

## Repository layout

```
apps/api         NestJS REST API, Prisma schema, migrations, seed, tests
apps/web         React web client
packages/shared  Permission model, zod schemas, error codes, shared types
docs/            Architecture, database, permissions, API, roadmap
scripts/         Tooling (documentation generators)
```

## Clinical safety

This is a practice-management and prescription-recording system. It never makes clinical
decisions; the doctor remains responsible for diagnosis, medicines, dosage, investigations and
advice. Finalized clinical records are versioned and traceable, never silently modified.

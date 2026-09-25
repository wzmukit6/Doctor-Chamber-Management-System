# Performance (Phase 8)

Spec §44 asks for a fast initial load, fast patient search and fast prescription creation.
This page records how the system was measured, what was changed and the results.

## Method

* **Dataset** (`scripts/perf/seed-large.sql`), loaded into a dedicated `chamber_perf` database:
  * 100,000 patients;
  * 120,000 appointments over 400 days for a single doctor (≈ 300/day, several times a busy
    real chamber);
  * 110,000 finalized consultations, each with a diagnosis;
  * 110,000 paid bills with payments.
* **Benchmark** (`scripts/perf/benchmark.mjs`): 15 timed runs after 3 warm-up runs per
  endpoint, measured end to end over HTTP (routing, auth, database, serialization) against a
  production build of the API.
* **Hardware:** a shared 4-vCPU cloud container with PostgreSQL 16 on the same machine.
  Treat the absolute numbers as indicative; the before/after comparison is what matters.

## Changes

| Change | Why |
|---|---|
| Trigram indexes on `lower(patient_code)` and `email` (migration `20260925080000_performance_hardening`) | Patient search ORs code, name, phone and email. One unindexed branch forced a sequential scan of all patients. |
| `jit = off` for the database (same migration, and in the production Postgres config) | JIT compilation added **~430 ms** to every report and dashboard query and never paid off for this workload. |
| Revenue report joins `invoices` only when filtering by doctor | Removed a 110k-row hash join from the default report. |
| Bangla translations lazy-loaded (separate chunk, loaded on first use) | English users no longer download 108 kB of Bangla strings; Bangla users get the saved language before the first render. |
| Vendor code in long-cached chunks (`react`, `data`, `i18n`, `icons`, `shared`, `vendor`) | A deploy invalidates only the ~44 kB (gzip) app chunk, not the libraries. |
| Edge compression (zstd/gzip) and immutable caching of hashed assets (Caddy) | The main JS chunk goes over the wire at ~46 kB. |

Already in place from earlier phases:
* route-level code splitting (25 lazy routes);
* debounced search and TanStack Query caching of catalogues;
* pagination everywhere;
* partial indexes for open bills and finalized consultations;
* exclusion constraints instead of lock-then-check for booking.

## Results (100k patients)

| Endpoint | Before p50 / p95 (ms) | After p50 / p95 (ms) |
|---|---|---|
| Patient search, name | 293 / 353 | **76 / 92** |
| Patient search, typo ("Nasrn Aktr") | 268 / 288 | **26 / 39** |
| Patient search, phone fragment | 217 / 259 | **10 / 14** |
| Patient search, patient ID | 270 / 302 | **10 / 10** |
| Patient list (page 1 / page 2000) | 24 / 49 | 22 / 47 |
| Patient profile · timeline | 10 · 13 | 9 · 14 |
| Appointments, day | 38 / 56 | 36 / 47 |
| Queue | 11 / 22 | 11 / 13 |
| Medicine search (Rx builder) | 6 / 9 | 7 / 10 |
| Diagnosis search | 5 / 6 | 7 / 13 |
| Bills list | 19 / 20 | 21 / 25 |
| Dashboard analytics, 30 days | 50 / 66 | 51 / 63 |
| Dashboard analytics, 90 days | 511 / 730 | **103 / 119** |
| Report: daily revenue, 1 year | 411 / 465 | **240 / 266** |
| Report: appointments by day, 1 year | 186 / 211 | 180 / 196 |
| Report: patients seen, 1 year | 165 / 176 | 185 / 203 |
| Report: top diagnoses, 1 year | 307 / 364 | 333 / 377 |
| Report: patient list, 1 year (5,000-row cap) | 31 / 52 | 37 / 51 |
| Audit log page | 8 / 13 | 8 / 8 |

Everything on the prescription path (patient search, profile, medicine and diagnosis search,
queue) answers in **under 100 ms at p95**.

Known heavier cases:
* The yearly reports (0.2–0.4 s over 110k consultations) are acceptable for on-demand
  reporting.
* The appointment **week** view at 300 appointments/day (2,100 rows, 1.8 MB before
  compression) takes ~0.3 s. A real chamber's week is 3–5× smaller.

## Web bundle

| Chunk | Size (gzip) | Notes |
|---|---|---|
| `index` (app shell, dashboard, login) | 44 kB | changes on every deploy |
| `react` | 84 kB | long-cached |
| `data` (TanStack Query, zod, forms) | 51 kB | long-cached |
| `i18n` | 15 kB | long-cached |
| `icons`, `shared` | 8 kB each | long-cached |
| `bn` (Bangla strings) | 21 kB | loaded only when Bangla is selected |
| Route chunks (consultation, settings, print, …) | 3–13 kB each | loaded on navigation |

## Reproducing

```bash
# 1. a copy of the dev database (never run the generator against real data)
createdb chamber_perf && pg_dump -Fc "$DEV_DB" | pg_restore -d chamber_perf --no-owner
# 2. synthetic data (superuser, because triggers are disabled for the bulk load)
psql -d chamber_perf -v patients=100000 -v appointments=120000 -v days=400 -f scripts/perf/seed-large.sql
# 3. an API instance on it
DATABASE_URL=postgresql://…/chamber_perf PORT=4100 node apps/api/dist/main.js &
# 4. benchmark
PERF_API=http://localhost:4100/api node scripts/perf/benchmark.mjs 15
```

In production, `SLOW_QUERY_MS` (default 300) logs slow statements, and `/api/metrics` exposes
latency histograms per route for Prometheus/Grafana.

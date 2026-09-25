# Delivery roadmap

The system is built incrementally in the order defined by the specification (§69). Each phase
ships working backend, frontend, tests and documentation before the next one starts.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Project setup, database, authentication, user management, RBAC, organization/chamber architecture, audit trail, API docs | ✅ Done |
| 2. Patient management | Registration, fast/fuzzy search, profile (demographics + medical info), timeline, Ctrl+K patient search | ✅ Done |
| 3. Appointments & queue | Calendar (day/week/month), booking with conflict detection, check-in, live token queue | ✅ Done |
| 4. Clinical workflow | Consultation, configurable vitals, complaints, diagnosis (ICD-ready), investigations, clinical notes | ✅ Done |
| 5. Prescriptions | Medicine database, smart builder, templates, finalization, versioning, A4 PDF, QR verification | ✅ Done |
| 6. Billing | Fees, payments, receipts, dues, financial reports | ✅ Done |
| 7. Reports & administration | Dashboard analytics, reports, exports (PDF/CSV/Excel), settings | ✅ Done |
| 8. Hardening | Security audit, full RBAC matrix tests, performance, backups/restore, deployment | ✅ Done |

## Phase 8 — delivered

* **Security audit** ([SECURITY.md](SECURITY.md)): automated tests cover brute force, session
  fixation, token theft, password-reset abuse, SQL/NUL injection, mass assignment, headers and
  error hygiene. Findings fixed:
  * a response-timing difference on forgot-password that revealed which accounts exist;
  * NUL bytes and oversized or malformed bodies causing 500s;
  * API responses that could be cached;
  * the session cookie is now SameSite=Strict;
  * two transitive dependency advisories (now 0 vulnerabilities; CI fails on new
    high-severity ones).
* **Every role × every endpoint**: routes are discovered from the running app (145).
  * Anonymous requests get 401 everywhere.
  * Every endpoint must declare a permission or be on a reviewed allow-list.
  * Each role gets 403 wherever it lacks a permission and passes the guard wherever it has one.
  * Plus the spec's scenarios (assistant → prescription edit, doctor A → chamber B patient,
    manager A → chamber B, doctor → system settings).
* **Performance** ([PERFORMANCE.md](PERFORMANCE.md)), benchmarked on 100k patients, 120k
  appointments and 110k consultations:
  * two trigram indexes: patient search 220–290 ms → 10–76 ms;
  * JIT off: the 90-day dashboard went from 511 ms to 103 ms, and yearly reports got up to 40% faster;
  * Bangla translations lazy-loaded, and vendor code in long-cached chunks (the app chunk is
    44 kB gzip).
* **Observability:**
  * structured JSON request logs with request ids, never bodies or query strings;
  * security event logs and a slow-query log;
  * a Prometheus `/api/metrics` endpoint (token protected) and a readiness probe
    (`/api/health/ready`);
  * a **System health** card for super admins (database, p95 latency, errors, failed sign-ins,
    sessions, version).
* **Backups & recovery** ([OPERATIONS.md](OPERATIONS.md)):
  * encrypted daily `pg_dump` with checksums, manifests and grandfather-father-son retention,
    plus an off-site copy hook;
  * **every backup is verified by restoring it** into a temporary database and checking
    migrations, the audit hash chain and row counts;
  * the backup container turns unhealthy on any failure;
  * restore procedure, RPO/RTO and a disaster-recovery drill performed on the full stack.
* **Production deployment:**
  * Dockerfiles for the API, web and backup worker; `deploy/docker-compose.prod.yml` with
    Caddy (automatic HTTPS, HSTS/CSP, compression);
  * PostgreSQL on an internal network with a non-superuser application role;
  * a one-shot migrate + bootstrap job that creates the first super admin, who must change the
    password;
  * Docker secrets, non-root read-only containers with dropped capabilities;
  * staging and production env templates;
  * CI builds the images and validates the configuration.

## Phase 7 — delivered

* **Reports** (spec §19) — 19 reports in three groups, each gated by its own permission:
  * operational (`reports.view`): appointments by day, no-show rate by doctor, patient
    registrations, queue & waiting time, patient list, appointment list;
  * clinical (`reports.clinical`): patients seen (new vs returning), consultations by day, top
    diagnoses, prescription statistics, follow-ups, doctor activity, consultation register,
    prescription history;
  * financial (`reports.financial`): daily and monthly revenue, revenue by doctor, payment
    methods, outstanding dues.
  Every report has a period (presets or custom, up to 366 days), a doctor filter, summary tiles, a
  chart and a table. Days and months with no activity are filled with zeros. Tables are capped at
  5,000 rows and say so when truncated.
* **Scope**: reports always run inside the active chamber. Doctors see only their own patients and
  visits ("personal"). A super admin without a chamber sees all chambers.
* **Exports** (`reports.export`, spec §59):
  * CSV is UTF-8 with a BOM, so Excel shows Bangla correctly.
  * Excel files carry a header block (chamber, period, generated by/at) and typed number formats.
  * PDF comes from the print view.
  * Labels and coded values are exported in the user's language. Every export is audited
    (`report.exported`).
* **Dashboard analytics** (spec §33): appointments per day, new vs returning patients, revenue
  collected, top diagnoses, appointment status and doctor workload, over 7, 30 or 90 days. The
  manager and doctor dashboards show the charts relevant to them. Charts are accessible SVG with
  tooltips and a table view.
* **Settings → Chamber**: name/contact details, logo (resized in the browser), tagline, weekly
  opening hours and a note. The logo and tagline are printed on prescriptions and receipts.
* **Settings → Doctor profile**: qualifications, specialty, BMDC registration no., bio,
  **signature image** (printed only on finalized prescriptions) and a prescription footer. The
  doctor edits their own profile; managers can edit any doctor's.
* **Settings → Security** (platform, `system.manage`): password policy (length, character classes),
  inactivity and absolute session timeouts, failed-attempt lockout. Changes take effect
  immediately and are audited. Password forms show the live policy.

## Phase 6 — delivered

* **Bills per visit**: consultation / follow-up / report-review fee (from the doctor's fees and
  the visit type), investigation, procedure and other charges, discount (amount or %) with a
  reason, total, paid and due; per-chamber bill numbers (`INV-000123`); one active bill per
  appointment. Ordered investigations with a chamber fee are suggested as extras.
* **Payments** at the counter (with the bill or later): cash, card, mobile banking (bKash, Nagad,
  Rocket…), bank transfer, other — methods and providers are configurable per chamber. Every
  payment gets a receipt number (`RCPT-000045`); full card numbers are rejected (last 4 digits only).
* **Append-only ledger**: payments are never edited or deleted (database trigger); refunds are
  separate entries (`RF-000001`) with a reason; bills are voided (with a reason, only once no money
  is left on them), never deleted; void bills are frozen.
* **Edits** of an issued bill need `billing.update` and a reason (audited with old/new charges)
  and can never drop the total below what was already paid. CHECK constraints keep subtotal,
  discount, total, paid, due and status consistent in the database.
* **Roles**: assistants create bills with standard fees and take payments; discounts, edits,
  refunds, voids and fee changes are manager actions; doctors can view.
* **Fees**: doctor fees (new visit, follow-up, report review — changes audited, spec §20
  "MANAGER modified consultation fee") and a chamber charge schedule linked to the investigation
  catalogue.
* **Collections**: today's collected/billed/outstanding tiles, period summary by payment method,
  doctor and staff member (day-end cash check); outstanding dues filter.
* **Receipt** (A5 money receipt) with every payment and refund; printing is audited.
* Queue shows each visit's bill status (Paid / Due ৳…) with Bill / Collect actions; patient
  profile gains **Prescriptions** and **Billing** tabs (dues highlighted); payment events on the
  timeline; dashboard "Collected today / pending dues"; **Settings → Billing**.

## Phase 5 — delivered

* **Medicine database**: 89 global generic medicines (no brand names, so no manufacturer is
  misattributed) with form, strength, category, route, default dose, common frequencies and
  durations; chambers add their own medicines and brands; typo-tolerant search over brand,
  generic and keywords; deactivate instead of delete; doctor favourites.
* **Smart prescription builder** inside the consultation: medicine autocomplete (Alt+M), one-click
  favourites / frequently / recently prescribed, dose-pattern chips (1+0+1 …), meal timing,
  duration, **automatic quantity** for tablets and capsules (overridable), route, timing and
  instructions, drag-and-drop or keyboard reordering, exact-duplicate blocking and a warning for the
  same generic twice, advice with the chamber's default text, **copy previous prescription**.
* **Templates** (personal or chamber-shared) with diagnoses, investigations, medicines, advice and
  follow-up instructions; apply in one click (everything stays editable) or save the current visit.
* **Finalization**: the prescription is issued together with the consultation in one transaction —
  per-chamber Rx number (`RX-000145`), verification token and SHA-256 content hash.
* **Versioning & state machine** (DRAFT → FINALIZED → REVISED; versions FINALIZED → SUPERSEDED):
  finalized versions can never be edited (API and database triggers). The prescribing doctor revises
  with a mandatory reason; the revision draft autosaves and is finalized or discarded; history shows
  every version with who/when/why. All steps are audited.
* **Printing**: dedicated A4/A5 print view (header, patient section, clinical summary, Rx, advice,
  follow-up, signature line, QR code, footer) with print CSS; "Save as PDF" from the print dialog
  (keeps Bangla text intact). Drafts print with a "not valid" watermark; printing is audited.
* **QR verification**: public page `/verify/:token` shows valid/superseded status, Rx number, issue
  date, doctor and chamber — never patient information.
* **Access**: assistants and managers see issued prescriptions only and can print; only the
  prescribing doctor revises; other chambers get 404.
* **Settings → Prescriptions**: page size, printed label language (English/Bangla), medicine name
  format, QR/clinical section/signature toggles, header note, default advice, footer.
* Prescriptions page (search, filters, print), prescription detail with version history, Medicines
  page, patient timeline events for issued and revised prescriptions, "Recent prescriptions" on the
  doctor and assistant dashboards.

## Phase 4 — delivered

* **Consultation workspace**: patient summary (allergies, conditions, medications, previous visits)
  beside chief complaints (catalogue search, frequently used, free text, durations), history,
  examination with configurable vitals (BP format, ranges, decimals, automatic BMI), diagnoses
  (typo-tolerant search by name, ICD-10 code or keyword; primary/secondary; certainty), investigations
  (priority, instructions, drag to reorder), private clinical notes and follow-up (quick presets).
* **Autosave** of the whole draft with optimistic locking, Ctrl+S, retry on network errors and a
  conflict banner if the record changed elsewhere.
* **Finalize** validates completeness (a complaint or diagnosis, one primary diagnosis, a future
  follow-up date), locks the record and completes the appointment in one transaction.
  **Discard draft** keeps the record as cancelled and returns the patient to the queue.
* **Immutability**: database triggers make finalized consultations and all their child rows
  unchangeable; consultations can never be deleted; only append-only **addenda** can be added.
* **Access**: only the consultation's doctor edits/finalizes; managers can read consultations but not
  private notes or medical history; assistants have no consultation access but can record vitals
  before the visit (`vitals.record`), which the consultation adopts.
* **Clinical catalogue** page (investigations, diagnoses, complaints) with global master data
  (super admin) and chamber-specific entries; deactivate instead of delete. Seeded reference data:
  38 ICD-10 diagnoses, 30 investigations, 30 complaints, 8 vital fields.
* **Settings → Vitals & examination** to add chamber-specific fields.
* Queue "Start consultation" opens the workspace; patient profile gains Start consultation and a
  Consultations tab; timeline shows consultations, diagnoses, investigations and follow-ups
  (details hidden without medical access); doctor dashboard shows follow-ups due.

## Phase 3 — delivered

* **Doctor schedules**: weekly availability windows per doctor (several per day), per-doctor slot
  length and daily patient limit; edited by managers (`schedules.manage`), viewable by all staff.
* **Chamber appointment settings**: default slot length, daily limit, token numbering (per doctor or
  chamber-wide, optional prefix), auto-queue on check-in (`settings.manage`).
* **Booking** in chamber-local time (timezone-aware, stored in UTC) from a slot grid or a custom time;
  visit type, reason, notes; walk-ins that are checked in immediately.
* **Conflict prevention**: a patient can never be double-booked; a doctor clash, a time outside the
  schedule or exceeding the daily limit needs explicit confirmation ("overbook"). Both rules are
  enforced by PostgreSQL exclusion constraints, so concurrent requests cannot both succeed.
* **Status machine**: BOOKED → CONFIRMED → CHECKED_IN → WAITING → IN_CONSULTATION → COMPLETED, plus
  CANCELLED (reason required) and NO_SHOW (only after the start time); check-in only on the day.
  Every change is recorded in `appointment_status_history` and the audit log.
* **Ownership**: only the appointment's doctor can start, complete or return a consultation and call
  from their own queue; a doctor sees one patient at a time.
* **Live queue**: tokens issued atomically at check-in, call next (skips held patients), call again,
  hold/resume, now-serving panel, summary counts, 10-second auto-refresh, screen-reader announcements.
* **Calendar**: day (columns per doctor), week and month views, click an empty slot to book,
  side-by-side lanes for overbooked slots, current-time line.
* Patient profile gains an Appointments tab and "New appointment"; the timeline shows visits.
* Dashboards show today's real appointment/queue numbers and upcoming appointments.

## Phase 2 — delivered

* Patients with per-chamber sequential IDs (`DHN-00042`) issued atomically; date of birth **or**
  age (stored as an estimated date of birth, flagged as such); blood group, contacts, occupation,
  nationality; up to three emergency contacts.
* Medical information (existing conditions, surgeries, current medications, relevant/family history,
  lifestyle) and allergies with severity — separate permissions to view (`patients.view_medical`)
  and edit (`patients.update_medical`); versioned for concurrent edits; allergy removal needs a reason.
* Search: patient ID, partial and typo-tolerant names (PostgreSQL `pg_trgm`), phone in any format
  (`+8801…`, `8801…`, `01…`, partial), email, date of birth (`YYYY-MM-DD`, `DD/MM/YYYY`); relevance
  ranking; keyboard navigation; recent patients; patient search in Ctrl+K.
* Duplicate prevention: live warnings while registering; likely duplicates (same phone + similar name,
  or similar name + same exact date of birth) require explicit confirmation, which is audited.
  Shared family phone numbers only warn.
* Profile with prominent allergy alert, overview, medical history and a filterable timeline built
  from pluggable providers (registration and record changes now; appointments, consultations,
  prescriptions, investigations and payments join in later phases).
* Privacy: profile views are access-logged; medical values are redacted in the audit log and
  timeline for viewers without medical access; archive (soft delete) requires a reason.
* Dashboard: recent patients, registered/new patient counts; "New patient" quick action.

## Phase 1 — delivered

* Monorepo (npm workspaces): `packages/shared`, `apps/api`, `apps/web`.
* PostgreSQL schema + migration: organizations, chambers, users, roles, permissions,
  role_permissions, user_roles, doctors, sessions, password_reset_tokens, audit_logs, settings.
* Auth: login/logout, server-side sessions, CSRF, Argon2id, lockout, rate limits, forgot/reset
  password, change password, forced change after admin-set passwords, session management,
  chamber switching. MFA columns reserved (not enforced yet).
* RBAC: permission catalogue, default matrix, forbidden grants, runtime matrix editing (audited).
* User, organization and chamber management with tenant isolation, optimistic locking, soft delete.
* Tamper-evident audit trail with scoped viewer and chain verification.
* Web: design system, permission-aware shell, Ctrl+K palette, role dashboards, admin screens, en/bn.
* Tests: API unit + integration (auth flows, RBAC matrix, cross-chamber isolation, audit immutability), web unit tests.

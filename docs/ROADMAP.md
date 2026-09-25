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
| 6. Billing | Fees, payments, receipts, dues, financial reports | ⏭ Next |
| 7. Reports & administration | Dashboard analytics, reports, exports (PDF/CSV/Excel), settings | Planned |
| 8. Hardening | Security audit, full RBAC matrix tests, performance, backups/restore, deployment | Planned |

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

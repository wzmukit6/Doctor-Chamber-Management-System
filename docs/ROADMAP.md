# Delivery roadmap

The system is built incrementally in the order defined by the specification (§69). Each phase
ships working backend, frontend, tests and documentation before the next one starts.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Project setup, database, authentication, user management, RBAC, organization/chamber architecture, audit trail, API docs | ✅ Done |
| 2. Patient management | Registration, fast/fuzzy search, profile (demographics + medical info), timeline, Ctrl+K patient search | ✅ Done |
| 3. Appointments & queue | Calendar (day/week/month), booking with conflict detection, check-in, live token queue | ⏭ Next |
| 4. Clinical workflow | Consultation, configurable vitals, complaints, diagnosis (ICD-ready), investigations, clinical notes | Planned |
| 5. Prescriptions | Medicine database, smart builder, templates, finalization, versioning, A4 PDF, QR verification | Planned |
| 6. Billing | Fees, payments, receipts, dues, financial reports | Planned |
| 7. Reports & administration | Dashboard analytics, reports, exports (PDF/CSV/Excel), settings | Planned |
| 8. Hardening | Security audit, full RBAC matrix tests, performance, backups/restore, deployment | Planned |

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

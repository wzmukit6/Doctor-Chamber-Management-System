# Delivery roadmap

The system is built incrementally in the order defined by the specification (§69). Each phase
ships working backend, frontend, tests and documentation before the next one starts.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Project setup, database, authentication, user management, RBAC, organization/chamber architecture, audit trail, API docs | ✅ Done |
| 2. Patient management | Registration, fast/fuzzy search, profile (demographics + medical info), timeline, Ctrl+K patient search | ⏭ Next |
| 3. Appointments & queue | Calendar (day/week/month), booking with conflict detection, check-in, live token queue | Planned |
| 4. Clinical workflow | Consultation, configurable vitals, complaints, diagnosis (ICD-ready), investigations, clinical notes | Planned |
| 5. Prescriptions | Medicine database, smart builder, templates, finalization, versioning, A4 PDF, QR verification | Planned |
| 6. Billing | Fees, payments, receipts, dues, financial reports | Planned |
| 7. Reports & administration | Dashboard analytics, reports, exports (PDF/CSV/Excel), settings | Planned |
| 8. Hardening | Security audit, full RBAC matrix tests, performance, backups/restore, deployment | Planned |

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

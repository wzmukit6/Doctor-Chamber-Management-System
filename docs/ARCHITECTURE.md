# Chamber Assistant — System architecture

Chamber Assistant is a practice-management and prescription-recording system for doctors'
chambers. It records the doctor's decisions; it never makes clinical decisions itself.

## 1. High-level view

```
┌──────────────────────────────┐
│  Web / tablet / mobile UI    │  React 19 · Vite · TanStack Query · i18n (en/bn)
└──────────────┬───────────────┘
               │ HTTPS, same-origin /api, HttpOnly session cookie + CSRF header
┌──────────────▼───────────────┐
│  API layer (NestJS)          │  helmet · CORS allow-list · rate limiting · JSON-only bodies
│  ThrottlerGuard → AuthGuard  │  AuthGuard: session → identity → role → permissions → scope
│  → PermissionsGuard          │  PermissionsGuard: @RequirePermissions(...) per endpoint
└──────────────┬───────────────┘
               │ controllers are thin; they validate (zod) and delegate
┌──────────────▼───────────────┐
│  Application services        │  AuthService, UsersService, ChambersService, RolesService, …
│  + AuthorizationService      │  tenant scope, role manageability, ownership, state rules
│  + AuditService              │  append-only, hash-chained audit trail (same transaction)
└──────────────┬───────────────┘
               │ Prisma (parameterized queries only)
┌──────────────▼───────────────┐
│  PostgreSQL                  │  FKs, unique/partial indexes, CHECK constraints, triggers
└──────────────────────────────┘
      Future: object storage (attachments), Redis (cache / rate-limit store), job queue
      (notifications, PDF rendering), SMTP/SMS/WhatsApp providers behind interfaces.
```

## 2. Request lifecycle & authorization

Every protected request goes through the same chain (spec §22):

```
Authentication   ca_session cookie → SHA-256 → sessions row (not revoked, not idle/absolute-expired)
      ↓
Identity         user is active and not deleted
      ↓
Role             the session is bound to one membership (user_roles row) → role
      ↓
Permissions      role_permissions (cached 30 s, invalidated on change)
      ↓
Scope            membership.chamber / organization must be active; services filter by chamber
      ↓
Action           service-level rules (manageable role, ownership, state machine)
```

* **Never trust the client**: the role, permissions and chamber come from the database
  session, never from request data. The UI hides what a user cannot do, but the API
  enforces it independently.
* **Cross-tenant access** returns `404 NOT_FOUND`, indistinguishable from a missing record.
* **CSRF**: state-changing requests must send `X-CSRF-Token` equal to the per-session token
  (stored hashed on the session), bodies must be `application/json`, cookies are `SameSite=Lax`.

## 3. Multi-tenancy

```
Platform ─┬─ Organization ─┬─ Chamber ─┬─ Doctors (doctor profiles)
          │                │           ├─ Staff (memberships: MANAGER / DOCTOR / ASSISTANT)
          │                │           └─ Patients → Appointments → Consultations → Prescriptions  (later phases)
          └─ Super Admin (platform membership, no chamber)
```

* A **user** is a global identity (email). Access is granted through **memberships**
  (`user_roles`: user + role + organization + chamber). A user may belong to several chambers
  and switches the active one; switching rotates the session.
* Every tenant-owned table carries `chamber_id` (and `organization_id` where useful); services
  apply `AuthorizationService.chamberScope(actor)` to every query.

## 4. Backend structure (`apps/api`)

```
src/
  main.ts / bootstrap.ts      HTTP hardening, CORS, Swagger (/api/docs, non-production)
  config/                     zod-validated environment (fails fast)
  common/
    decorators/               @Public, @RequirePermissions, @CurrentActor, @ValidBody/@ValidQuery
    guards/                   AuthGuard (session + CSRF), PermissionsGuard, JSON-content middleware
    filters/                  AllExceptionsFilter → { success:false, error:{ code, message } }
    interceptors/             ResponseInterceptor → { success:true, data, meta? }
    pipes/                    ZodValidationPipe (shared schemas)
    utils/                    crypto, pagination (sort allow-lists), audit sanitizing/diffing
  modules/
    auth/                     login/logout, sessions, password change/reset, profile
    authorization/            permission resolution + tenant scope helpers
    users/ roles/ organizations/ chambers/
    audit/                    AuditService (hash chain) + scoped read API + chain verification
    notifications/            provider interface (console/in-memory now; SMTP/SMS later)
    patients/                 registration, search, medical info, pluggable timeline providers
    doctors/ appointments/    schedules, booking, status machine, token queue
    catalog/ consultations/   clinical master data, consultation workflow
    prescriptions/            medicines, prescriptions (versions, revisions, print, public
                              verification), templates; prescription-writer shared with consultations
    settings/                 chamber settings (appointments, prescriptions)
    health/
prisma/                       schema, migrations (with hand-written constraints/triggers), seed
test/                         integration tests against a throwaway database per run
```

Rules: controllers contain no business logic; services own workflows and transactions;
every sensitive write records an audit event **inside the same transaction**.

## 5. Frontend structure (`apps/web`)

```
src/
  components/ui/     design-system components (Button, Field, DataTable, Modal, ConfirmDialog, Toast…)
  components/        CommandPalette (Ctrl+K)
  features/<module>/ pages + module components (auth, dashboard, users, roles, chambers, …)
  layouts/           AppLayout (permission-filtered nav, chamber switcher), AuthLayout
  permissions/       <Can>, <RequirePermission>, navigation config
  services/          api client (CSRF header, error mapping), endpoint modules, query client
  stores/            AuthProvider (server-resolved current user)
  hooks/ utils/ i18n/
```

* Server state lives in TanStack Query; UI state stays local. No global store is needed yet.
* Forms use react-hook-form with the **same zod schemas** as the API (`@chamber/shared`), and
  server-side field errors are mapped back onto fields.
* Every UI string is a translation key (`en.json`, `bn.json`).

## 6. Security controls (Phase 1)

| Control | Implementation |
|---|---|
| Password hashing | Argon2id (m=19 MiB, t=2, p=1) via `@node-rs/argon2` |
| Password policy | ≥10 chars, upper, lower, digit — shared by UI and API |
| Sessions | opaque 256-bit tokens, stored as SHA-256; idle (30 min) + absolute (12 h) expiry; revoked on logout, password change/reset, deactivation, chamber deletion |
| Cookies | `HttpOnly`, `Secure` (enforced in production), `SameSite=Lax`, path-scoped |
| CSRF | per-session double-submit token + JSON-only bodies |
| Brute force | per-account lockout (5 failures → 15 min), IP rate limits (login 10/min, reset 5/15 min, global 300/min) |
| Enumeration | identical responses and comparable timing for unknown emails; generic forgot-password response |
| Validation | zod at UI, API and service; DB constraints (FKs, unique, CHECK) |
| Output | structured errors only; stack traces/DB errors never sent to clients; helmet headers |
| Audit | append-only table (trigger blocks UPDATE/DELETE/TRUNCATE) + SHA-256 hash chain, verifiable via `/api/audit-logs/verify`; secrets stripped from audit values |
| Concurrency | optimistic locking (`version`) on users, chambers, organizations → `409 STALE_VERSION` |
| Deletion | soft delete (`deleted_at`, `deleted_by`, `deletion_reason`) with required reason |
| Secrets | environment variables only; `.env` is git-ignored |

## 7. Key decisions

* **Server-side sessions instead of JWTs** — instant revocation (deactivation, password reset)
  matters more than statelessness for a clinical system; the lookup is a single indexed query.
* **Shared package** — permissions, roles, schemas and error codes are defined once and used by
  the API, the web client, tests and generated docs.
* **Hash-chained audit log** — makes silent tampering detectable even by someone with database
  access, on top of the trigger that blocks edits.
* **Forbidden grants** — some permissions can never be given to some roles (e.g. an assistant can
  never finalize prescriptions), even by a super admin editing the matrix.
* **Modules not yet built are visible but disabled** in the navigation so the product structure
  is clear while it is delivered phase by phase.

## 8. Extensibility

New modules (pharmacy, laboratory, telemedicine, patient portal, …) plug in as new NestJS
modules + feature folders, reuse `AuthorizationService` scope helpers and `AuditService`, and
add permissions to `@chamber/shared` (the seed syncs them; Super Admin receives them automatically).
Notification channels implement `NotificationProvider`. Any future AI features must live behind a
dedicated service and can never silently change a finalized clinical record.

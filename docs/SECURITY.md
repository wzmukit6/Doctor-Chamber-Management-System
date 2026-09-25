# Security audit (Phase 8)

This is the pre-production security audit required by the specification (§48). Each control
below is backed by automated tests that run in CI against the real API and database:

* `apps/api/test/security.e2e-spec.ts`: authentication attacks, token theft, session fixation,
  password-reset abuse, injection, headers.
* `apps/api/test/rbac-matrix.e2e-spec.ts`: every role against every endpoint.
* `apps/api/test/rbac.e2e-spec.ts`, `auth.e2e-spec.ts` and the per-module suites: tenant
  isolation, ownership, state rules.

Audit date: September 2026 · Scope: API, web app, database, deployment configuration.

## Summary

| Area | Result |
|---|---|
| Authentication (brute force, lockout, enumeration) | ✅ pass |
| Session fixation | ✅ pass |
| Token theft mitigations | ✅ pass (SameSite changed Lax → **Strict**) |
| Password reset abuse | ✅ pass (**timing leak fixed**) |
| Authorization: every role × every endpoint | ✅ pass (145 routes, 4 roles; 1 open endpoint documented) |
| Tenant isolation (chamber A ↔ chamber B) | ✅ pass |
| Injection (SQL, NUL bytes, mass assignment) | ✅ pass (**NUL-byte 500 fixed**) |
| Error hygiene (no stack traces / SQL to clients) | ✅ pass (**body-parser 500s fixed**) |
| Transport & headers | ✅ pass (**`Cache-Control: no-store` added**) |
| Dependencies (`npm audit --omit=dev`) | ✅ 0 vulnerabilities (**2 transitive advisories fixed**) |

## Findings fixed during the audit

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | `forgot-password` answered faster for unknown emails than for real accounts, so response timing revealed whether an account exists. | Medium | The reset e-mail is prepared in the background; the response is identical and immediate in both cases. |
| 2 | A NUL byte (`%00`) in a search or JSON field reached PostgreSQL and produced a 500. | Low | Requests containing NUL bytes are rejected with 400 at the edge (`JsonContentMiddleware`). |
| 3 | Oversized (> 1 MB) or malformed JSON bodies returned 500 instead of 413 / 400. | Low | The exception filter maps body-parser errors to `VALIDATION_FAILED` with the right status. |
| 4 | API responses carried no `Cache-Control`, so a shared browser or proxy could keep patient data. | Low | All API responses are `Cache-Control: no-store`. |
| 5 | Session cookie `SameSite=Lax`. | Hardening | `SameSite=Strict` (the SPA and API are same-site; cross-site navigations never need the cookie). |
| 6 | Transitive `deepmerge-ts` < 8 (Prisma CLI) and `uuid` < 11.1.1 (exceljs) advisories. | Low (not reachable) | Pinned patched versions with npm `overrides`; CI now fails on high-severity advisories. |
| 7 | `GET /vital-definitions` has no permission requirement. | Info | Intentional (chamber configuration, no patient data). Listed explicitly in the matrix test's allow-list so any *new* unprotected endpoint fails CI. |

## Authentication

* **Brute force:** the account locks after *n* failed attempts, for *m* minutes (both
  configurable in Settings → Security). Login is rate limited per IP (10/min) and so are
  password-reset requests (5 per 15 min). Unknown emails and wrong passwords return the same
  error in the same time: a dummy Argon2 hash is checked when the email is unknown.
* **Passwords:** Argon2id (m = 19 MiB, t = 2, p = 1). The policy (length and character
  classes) is configurable and enforced on the server. Accounts created by an administrator,
  including the production bootstrap admin, must change their password at first sign-in.
* **Session fixation:** a session id planted before sign-in is ignored, and every sign-in
  issues a fresh random 256-bit token. *Test: "ignores a session id planted before sign-in".*
* **Token theft:**
  * The session cookie is `HttpOnly` (unreadable to scripts), `SameSite=Strict`, `Secure` in
    production (enforced at startup) and scoped to `/api`.
  * The database stores only the SHA-256 of the token.
  * Every write needs the per-session CSRF token (double submit). A stolen cookie alone cannot
    change data, and a CSRF token from another session is rejected.
  * Sessions expire after inactivity and have an absolute lifetime. They are revoked on
    logout, password change, password reset and deactivation.
  * Users can see and revoke their own sessions only; another user's session id returns 404.
* **Password reset:**
  * The response is always the same, whether or not the account exists.
  * Tokens are 256-bit random values, stored hashed and single-use, and expire after 30 minutes.
  * A new request invalidates older tokens, and a completed reset revokes all sessions.
  * Guessed, malformed and oversized tokens all fail the same way.

## Authorization

The **endpoint matrix** (`rbac-matrix.e2e-spec.ts`) discovers every route from the running
application and asserts:

1. every non-public route answers anonymous requests with 401 (145 routes);
2. every route declares `@RequirePermissions` or is on a short, reviewed allow-list, so a
   forgotten decorator fails CI;
3. each role receives **403 on every endpoint it lacks a permission for**. The guard runs
   before validation and the handler, so nothing is changed;
4. each role passes the guard on every read endpoint it *is* granted;
5. the public surface is exactly: login, forgot/reset password, password policy, health,
   readiness, metrics (token-protected; 404 without it) and prescription verification.

Spec §48 scenarios, tested explicitly:

| Scenario | Result |
|---|---|
| Assistant → prescription modification | 403, prescription unchanged |
| Doctor A → Doctor B's (chamber B) patient | 404 (existence not revealed) |
| Manager A → chamber B bills, appointments, reports | 404; reports always scoped to chamber A |
| Doctor → system / role / billing settings | 403 |

Beyond permissions, services enforce tenant scope (chamber), ownership (only the prescribing
doctor revises, only the consultation's doctor finalizes) and state (finalized records are
immutable; the database triggers enforce this too). See [PERMISSIONS.md](PERMISSIONS.md).

## Input handling

* Every body, query and parameter is validated with zod schemas; unknown fields are stripped,
  so mass-assignment attempts (`role`, `permissions`, `isActive` on self-service endpoints) are
  ignored.
* All SQL is parameterized (Prisma or `Prisma.sql` tagged templates). The only raw fragments
  are hard-coded column aliases in report definitions. Search input such as `' OR 1=1 --` is
  treated as text.
* Only `application/json` bodies up to 1 MB are accepted. NUL bytes are rejected.
* React escapes all output; there is no `dangerouslySetInnerHTML`. Uploaded images (logo,
  signature) must be PNG/JPEG/WebP data URLs (CHECK constraint and schema).

## Transport, headers and deployment

* **API:** Helmet defaults (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`),
  no `X-Powered-By`, `Cache-Control: no-store`, an `X-Request-Id` on every response, and CORS
  limited to configured origins with credentials.
* **Edge (Caddy):**
  * automatic HTTPS, HTTP → HTTPS redirect, HSTS (1 year);
  * a strict CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), plus
    `X-Frame-Options: DENY`, a `Permissions-Policy` and no `Server` header;
  * `/api/metrics` is never served publicly.
* **Containers:**
  * non-root users, `no-new-privileges`, all Linux capabilities dropped (only those needed are
    added back);
  * the API runs on a read-only root filesystem;
  * the database sits on an internal-only network.
* **Secrets:**
  * kept in files mounted as Docker secrets, never in images, environment definitions or git;
  * the application uses a non-superuser database role;
  * production refuses to start with insecure cookies or non-HTTPS origins.

## Logging and privacy

Request logs record method, **route pattern** (never the concrete URL or query string), status,
duration, user and chamber ids and client IP. Bodies are never logged. The slow-query log
contains SQL text only, never parameter values. Security events are emitted as structured warnings:
* failed and blocked sign-ins, lockouts;
* password changes and resets;
* role or permission changes, security-settings changes;
* deactivations, report exports;
* HTTP 401/403/429.

## Residual risks and recommendations

* **MFA** is designed for (columns reserved, flow prepared) but not yet enabled. Enable it
  for super admins before onboarding multiple organizations.
* **Report exports** are audited but not watermarked. Consider watermarking PDF/Excel exports
  with the user's name.
* **The rate limiter** is per API instance (in memory). When running more than one API
  replica, use a shared store (Redis) or rate limit at the edge.
* Run an external penetration test before handling real patient data at scale.

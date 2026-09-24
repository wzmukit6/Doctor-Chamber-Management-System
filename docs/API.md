# API specification

Base path `/api`. Interactive OpenAPI docs (generated from the code, including each endpoint's
required permissions under `x-permissions`) are served at **`/api/docs`** in non-production
environments.

## Conventions

**Success**

```json
{ "success": true, "data": { … }, "meta": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```

**Failure**

```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "Some fields are invalid",
  "details": [{ "path": "email", "message": "validation.email" }] } }
```

`details[].message` values are translation keys shared with the web client.

| HTTP | Codes |
|---|---|
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED` |
| 403 | `FORBIDDEN`, `CSRF_INVALID`, `ACCOUNT_INACTIVE`, `ROLE_NOT_MANAGEABLE`, `CANNOT_MODIFY_SELF`, `GRANT_NOT_ALLOWED` |
| 404 | `NOT_FOUND` (also returned for records in another chamber) |
| 409 (patients) | `POSSIBLE_DUPLICATE` — `error.data.candidates` lists matching patients; resend with `allowDuplicate: true` to confirm |
| 409 | `DUPLICATE`, `CONFLICT`, `STALE_VERSION` |
| 415 | body is not `application/json` |
| 422 | `VALIDATION_FAILED`, `WEAK_PASSWORD`, `GRANT_NOT_ALLOWED` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` |

**Lists** accept `page` (≥1), `pageSize` (1–100), `q` (search), `sort` (allow-listed column),
`order` (`asc`/`desc`) plus endpoint-specific filters.

**Auth** — `POST /api/auth/login` sets `ca_session` (HttpOnly) and `ca_csrf` (readable) cookies.
Every non-GET request must send header `X-CSRF-Token: <ca_csrf value>`.

**Concurrency** — update bodies include the `version` last read; a mismatch returns `409 STALE_VERSION`.

**Sensitive actions** (deactivate, delete, admin password reset, permission changes) require a
`reason`, stored in the audit log.

## Phase 1 endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | public | DB connectivity + latency |
| POST | `/auth/login` | public | rate limited; lockout after 5 failures |
| POST | `/auth/logout` | session | revokes the session |
| GET | `/auth/me` | session | identity, active membership, memberships, permissions |
| PATCH | `/auth/profile` | session | own name, phone, language |
| POST | `/auth/switch-chamber` | session | rotates session to another membership |
| POST | `/auth/change-password` | session | signs out other sessions |
| POST | `/auth/forgot-password` | public | always generic response |
| POST | `/auth/reset-password` | public | single-use token; revokes all sessions |
| GET | `/auth/sessions` | session | own active sessions |
| DELETE | `/auth/sessions/:id` | session | sign out one of own sessions |
| GET | `/users` | `users.view` | filters: `role`, `status`, `chamberId` (super admin) |
| GET | `/users/:id` | `users.view` | chamber-scoped |
| POST | `/users` | `users.create` | role must be manageable by the actor |
| PATCH | `/users/:id` | `users.update` | optimistic locking; doctor profile |
| POST | `/users/:id/status` | `users.update` | `{ isActive, reason }` |
| POST | `/users/:id/reset-password` | `users.update` | `{ newPassword, reason }` |
| POST | `/users/:id/unlock` | `users.update` | clears lockout |
| DELETE | `/users/:id` | `users.delete` | soft delete / remove chamber access, `{ reason }` |
| GET | `/roles` | `roles.view` | roles with grants, forbidden grants, user counts |
| GET | `/roles/permission-groups` | `roles.view` | catalogue for the matrix UI |
| PUT | `/roles/:id/permissions` | `roles.manage` | `{ permissions[], reason }` |
| GET | `/organizations` | `organizations.view` | |
| GET | `/organizations/:id` | `organizations.view` | |
| POST | `/organizations` | `organizations.manage` | |
| PATCH | `/organizations/:id` | `organizations.manage` | optimistic locking |
| DELETE | `/organizations/:id` | `organizations.manage` | only without chambers, `{ reason }` |
| GET | `/chambers` | `chambers.view` | non-admins see only their chamber |
| GET | `/chambers/:id` | `chambers.view` | |
| POST | `/chambers` | `chambers.create` | |
| PATCH | `/chambers/:id` | `chambers.update` | managers: own chamber, cannot toggle `isActive` |
| DELETE | `/chambers/:id` | `chambers.delete` | only without active staff, `{ reason }` |
| GET | `/audit-logs` | `audit_logs.view` | scoped by role; filters `from,to,userId,role,action,resourceType,resourceId,chamberId` |
| GET | `/audit-logs/verify` | `system.manage` | verifies the hash chain |

## Phase 2 endpoints — patients

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/patients` | `patients.view` | `q` (ID / name / phone / email / DOB), `gender`, `registeredFrom`, `registeredTo`, `sort` = `createdAt`\|`fullName`\|`patientCode`; relevance-ranked when `q` is set |
| GET | `/patients/search` | `patients.view` | `q`, `limit` (≤20) — lightweight results for Ctrl+K and pickers |
| GET | `/patients/recent` | `patients.view` | the caller's recently opened patients in the active chamber |
| POST | `/patients/duplicates` | `patients.create` | `{ fullName?, phone?, dateOfBirth?, excludeId? }` → candidates with `matchReasons` |
| POST | `/patients` | `patients.create` | registered in the caller's chamber; `medicalHistory` / `allergies` additionally need `patients.update_medical` |
| GET | `/patients/:id` | `patients.view` | `medical` is `null` without `patients.view_medical`; the view is access-logged |
| GET | `/patients/:id/timeline` | `patients.view` | `types` (comma-separated), `before` (ISO cursor), `limit` |
| PATCH | `/patients/:id` | `patients.update` | demographics + emergency contacts; optimistic locking |
| PUT | `/patients/:id/medical-history` | `patients.update_medical` + `patients.view_medical` | `version` 0 creates the record |
| POST | `/patients/:id/allergies` | `patients.update_medical` + `patients.view_medical` | duplicate allergens rejected |
| DELETE | `/patients/:id/allergies/:allergyId` | `patients.update_medical` + `patients.view_medical` | `{ reason }`, soft delete |
| DELETE | `/patients/:id` | `patients.delete` | `{ reason }`, archive (soft delete) |

## Planned resources

`/api/appointments`, `/api/queue`, `/api/consultations`, `/api/prescriptions`,
`/api/medicines`, `/api/diagnoses`, `/api/investigations`, `/api/billing`, `/api/reports`,
`/api/settings` — delivered phase by phase (see [ROADMAP.md](ROADMAP.md)) with the same conventions.

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
| 409 (appointments) | `APPOINTMENT_CONFLICT`, `OUTSIDE_SCHEDULE`, `DAILY_LIMIT_REACHED` — `error.data = { issues, overridable, conflicting }`; resend with `allowOverbook: true` when `overridable`. `INVALID_STATUS_TRANSITION` for actions not allowed in the current status |
| 403 (appointments) | `NOT_APPOINTMENT_DOCTOR` — only the appointment's doctor may start/complete/return a consultation or call from their queue |
| 409/422/403 (consultations) | `CONSULTATION_FINALIZED` (edits after finalization), `CONSULTATION_INCOMPLETE` (finalize validation, with `details`), `NOT_CONSULTATION_DOCTOR` |
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

## Phase 3 endpoints — appointments, queue, schedules

Dates (`YYYY-MM-DD`) and times (`HH:MM`) are chamber-local; returned instants are ISO-8601 UTC.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/doctors` | `appointments.view` | active doctors of the chamber with weekly schedule, slot length, daily limit |
| PUT | `/doctors/:id/schedule` | `schedules.manage` | `{ windows: [{ weekday, startTime, endTime }], slotMinutes?, maxDailyPatients? }`; overlapping windows rejected |
| GET | `/settings/appointments` | `appointments.view` | slot length, daily limit, token scope/prefix, auto-queue |
| PUT | `/settings/appointments` | `settings.manage` | optimistic locking (`version`) |
| GET | `/appointments` | `appointments.view` | `from`, `to` (≤ 62 days; ≤ 5 years with `patientId`), `doctorId`, `patientId`, `status` (comma-separated) |
| GET | `/appointments/availability` | `appointments.view` | `doctorId`, `date`, `excludeAppointmentId?` → slots with `available` / `past` |
| GET | `/appointments/:id` | `appointments.view` | includes status history |
| POST | `/appointments` | `appointments.create` | `{ patientId, doctorId, date, time, durationMinutes?, visitType, reason?, notes?, checkInNow?, allowOverbook? }` |
| POST | `/appointments/:id/reschedule` | `appointments.update` | BOOKED/CONFIRMED only; `{ date, time, doctorId?, durationMinutes?, reason?, allowOverbook?, version }` |
| PATCH | `/appointments/:id` | `appointments.update` | visit type, reason, notes |
| POST | `/appointments/:id/actions/:action` | per action | `confirm` (appointments.update), `check-in` / `send-to-queue` / `complete` / `return-to-queue` (queue.manage), `start` (consultations.create + own doctor), `cancel` (appointments.cancel, `reason` required), `no-show` (appointments.update) |
| GET | `/queue` | `queue.view` | `date?` (default today), `doctorId?` → ordered entries + summary |
| POST | `/queue/call-next` | `queue.manage` | `{ doctorId }` → next waiting, not-held patient by token, or `null` |
| POST | `/queue/:appointmentId/call` | `queue.manage` | call / call again |
| POST | `/queue/:appointmentId/hold` · `/resume` | `queue.manage` | |

## Phase 4 endpoints — clinical workflow

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/consultations` | `consultations.view` | `patientId`, `doctorId`, `status`, `from`, `to`, paging |
| GET | `/consultations/follow-ups` | `consultations.view` | `from`, `to`, `doctorId?` — finalized consultations with follow-up in range |
| GET | `/consultations/:id` | `consultations.view` | includes `context` (allergies, conditions, medications, previous visits); private notes need `clinical_notes.view` |
| POST | `/consultations` | `consultations.create` (doctors) | `{ patientId, appointmentId? }` — resumes a draft or starts/links today's waiting appointment |
| PUT | `/consultations/:id` | `consultations.update` + own doctor | whole draft: complaints, history, vitals, examination, diagnoses, investigations, clinicalNotes, follow-up, `version` |
| POST | `/consultations/:id/finalize` | `consultations.finalize` + own doctor | `{ version }` |
| POST | `/consultations/:id/cancel` | `consultations.update` + own doctor | `{ reason, version }` |
| POST | `/consultations/:id/addenda` | `consultations.update` + own doctor | finalized only; append-only |
| GET / PUT | `/appointments/:id/vitals` | `appointments.view` / `vitals.record` | vitals before the consultation |
| POST | `/appointments/:id/actions/start` | (Phase 3) | now also opens the draft consultation; response has `consultationId` |
| GET | `/diagnoses`, `/investigations`, `/complaints` | `diagnosis.view` / `investigations.view` | `q`, `scope` (`all`/`global`/`chamber`), `includeInactive`, `limit` |
| GET | `/{catalogue}/frequent` | same | most used by the doctor in 180 days |
| POST / PATCH | `/{catalogue}`, `/{catalogue}/:id` | `diagnosis.manage` / `investigations.manage` | `global: true` or editing global entries needs `system.manage` |
| POST | `/{catalogue}/:id/status` | same | `{ isActive }` |
| GET | `/vital-definitions` | signed in | effective fields for the chamber |
| POST / PATCH | `/vital-definitions`, `/vital-definitions/:id` | `settings.manage` | global fields need `system.manage` |

## Phase 5 endpoints — prescriptions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/medicines` | `medicines.view` | `q` (brand/generic/keywords, typo tolerant), `form`, `scope` (`all`/`global`/`chamber`/`favorites`), `includeInactive`, `limit` |
| GET | `/medicines/suggestions` | `medicines.view` | `{ favorites, frequent, recent }` for the builder |
| GET | `/medicines/:id` | `medicines.view` | |
| POST / PATCH | `/medicines`, `/medicines/:id` | `medicines.create` / `medicines.update` | `global: true` or editing global entries needs `medicines.manage_global` |
| POST | `/medicines/:id/status` | `medicines.update` (+ `medicines.delete` to deactivate) | `{ isActive }` — never deleted |
| PUT / DELETE | `/medicines/:id/favorite` | `medicines.view` + `prescriptions.create` (doctors) | personal favourites |
| PUT | `/consultations/:id` | (Phase 4) | optional `prescription: { items[], advice }` saves the version-1 draft; exact duplicate medicines → 422 `validation.duplicate_medicine` |
| POST | `/consultations/:id/finalize` | (Phase 4) | also issues the prescription (Rx number, verification token, content hash) in the same transaction |
| GET | `/prescriptions` | `prescriptions.view` | `q` (Rx number, patient name/ID), `patientId`, `doctorId`, `status`, `from`, `to`, paging; drafts only for prescribers |
| GET | `/prescriptions/latest` | `prescriptions.view` | `patientId`, `excludeConsultationId?` — "copy previous prescription" |
| GET | `/prescriptions/:id` | `prescriptions.view` | with version history; draft versions only for prescribers |
| GET | `/prescriptions/:id/print` | `prescriptions.print` | `version?` — everything for the A4/A5 print view (drafts: preview for prescribers) |
| POST | `/prescriptions/:id/print-log` | `prescriptions.print` | `{ versionNumber }` — audited as `prescription.printed` |
| POST | `/prescriptions/:id/revisions` | `prescriptions.revise` + prescribing doctor | `{ reason, version }` → draft version N+1; `REVISION_IN_PROGRESS` if one is open |
| PUT | `/prescriptions/:id/draft` | `prescriptions.update` + prescribing doctor | `{ items, advice, version }` — revision drafts only; issued versions → `PRESCRIPTION_ALREADY_FINALIZED` |
| POST | `/prescriptions/:id/finalize` | `prescriptions.finalize` + prescribing doctor | `{ version }` — previous version → SUPERSEDED, prescription → REVISED |
| POST | `/prescriptions/:id/discard` | `prescriptions.revise` + prescribing doctor | `{ version }` — draft revision → DISCARDED |
| GET | `/public/prescriptions/verify/:token` | public (rate limited) | status VALID / SUPERSEDED, Rx number, issue date, doctor, chamber — no patient data |
| GET | `/prescription-templates` | `prescriptions.view` | own personal + chamber-shared templates |
| POST / PATCH / DELETE | `/prescription-templates`, `/prescription-templates/:id` | `templates.manage` | diagnoses, investigations, medicines, advice, follow-up instructions; `shared`; PATCH needs `version` |
| GET / PUT | `/settings/prescriptions` | `prescriptions.view` / `settings.manage` | page size, print language, medicine name format, QR, clinical section, signature line, header note, default advice, footer |

## Planned resources

`/api/billing`, `/api/reports`,
`/api/settings` (remaining sections) — delivered phase by phase (see [ROADMAP.md](ROADMAP.md)) with the same conventions.

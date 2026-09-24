# Database design

PostgreSQL, managed with Prisma migrations (`apps/api/prisma`). Conventions:

* UUID primary keys; `snake_case` tables and columns; `timestamptz(3)` timestamps.
* `created_at` / `updated_at` on every mutable table; `version` for optimistic locking.
* Soft delete for business records: `deleted_at`, `deleted_by`, `deletion_reason`.
* Clinical records (later phases) are **versioned, never overwritten** once finalized.
* Tenant-owned rows carry `chamber_id` (+ `organization_id` where queries need it) with indexes.
* Constraints Prisma cannot express live in the migration SQL (partial unique indexes, CHECK
  constraints, the audit-log immutability trigger).

## ERD

Solid entities exist now (Phase 1). Entities marked *(planned)* arrive with their phase and
are shown so the foundation is designed for them.

```mermaid
erDiagram
    organizations ||--o{ chambers : owns
    organizations ||--o{ user_roles : scopes
    chambers ||--o{ user_roles : scopes
    chambers ||--o{ doctors : "doctor profiles"
    users ||--o{ user_roles : "memberships"
    users ||--o{ doctors : "is"
    users ||--o{ sessions : has
    users ||--o{ password_reset_tokens : has
    roles ||--o{ user_roles : grants
    roles ||--o{ role_permissions : has
    permissions ||--o{ role_permissions : in
    user_roles ||--o{ sessions : "active membership"

    chambers ||--o{ patients : "registers (planned)"
    patients ||--o{ patient_allergies : "(planned)"
    patients ||--o{ patient_medical_histories : "(planned)"
    patients ||--o{ appointments : "(planned)"
    doctors ||--o{ appointments : "(planned)"
    appointments ||--o{ appointment_status_history : "(planned)"
    appointments ||--o| queue_tokens : "(planned)"
    appointments ||--o| consultations : "(planned)"
    consultations ||--o{ consultation_vitals : "(planned)"
    consultations ||--o{ consultation_diagnoses : "(planned)"
    consultations ||--o{ consultation_investigations : "(planned)"
    consultations ||--o{ consultation_notes : "(planned)"
    consultations ||--o| prescriptions : "(planned)"
    prescriptions ||--o{ prescription_versions : "(planned)"
    prescription_versions ||--o{ prescription_items : "(planned)"
    medicines ||--o{ prescription_items : "(planned)"
    diagnoses ||--o{ consultation_diagnoses : "(planned)"
    investigations ||--o{ consultation_investigations : "(planned)"
    doctors ||--o{ prescription_templates : "(planned)"
    prescription_templates ||--o{ prescription_template_items : "(planned)"
    consultations ||--o| billing : "(planned)"
    billing ||--o{ payments : "(planned)"
    patients ||--o{ attachments : "(planned)"

    organizations {
      uuid id PK
      varchar name
      varchar slug UK
      bool is_active
      bool is_demo
      int version
      timestamptz deleted_at
    }
    chambers {
      uuid id PK
      uuid organization_id FK
      varchar name
      varchar code "unique per organization"
      varchar timezone
      bool is_active
      int version
      timestamptz deleted_at
    }
    users {
      uuid id PK
      varchar email UK "lower-case CHECK"
      varchar full_name
      varchar password_hash "argon2id"
      bool is_active
      bool must_change_password
      int failed_login_count
      timestamptz locked_until
      bool mfa_enabled "architecture only"
      int version
      timestamptz deleted_at
    }
    roles {
      uuid id PK
      varchar key UK "SUPER_ADMIN | MANAGER | DOCTOR | ASSISTANT"
    }
    permissions {
      uuid id PK
      varchar key UK "resource.action"
      varchar group
    }
    role_permissions {
      uuid role_id PK,FK
      uuid permission_id PK,FK
    }
    user_roles {
      uuid id PK
      uuid user_id FK
      uuid role_id FK
      uuid organization_id FK "nullable"
      uuid chamber_id FK "null = platform"
      bool is_active
    }
    doctors {
      uuid id PK
      uuid user_id FK
      uuid chamber_id FK
      varchar qualifications
      varchar specialty
      varchar registration_no
      decimal consultation_fee
      decimal follow_up_fee
    }
    sessions {
      uuid id PK
      char token_hash UK "sha256"
      char csrf_hash
      uuid user_id FK
      uuid membership_id FK
      timestamptz idle_expires_at
      timestamptz expires_at
      timestamptz revoked_at
    }
    password_reset_tokens {
      uuid id PK
      uuid user_id FK
      char token_hash UK
      timestamptz expires_at
      timestamptz used_at
    }
    audit_logs {
      uuid id PK
      bigint seq UK
      uuid chamber_id
      uuid user_id
      varchar role
      varchar action
      varchar resource_type
      varchar resource_id
      jsonb old_value
      jsonb new_value
      varchar reason
      varchar ip_address
      char prev_hash
      char hash
    }
    settings {
      uuid id PK
      enum scope "PLATFORM|ORGANIZATION|CHAMBER|USER"
      uuid scope_id
      varchar key
      jsonb value
    }
```

## Notable constraints and indexes

| Object | Purpose |
|---|---|
| `user_roles (user_id, chamber_id)` unique + partial unique `(user_id) WHERE chamber_id IS NULL` | one membership per chamber, at most one platform membership |
| `chambers (organization_id, code)` unique | human-friendly chamber codes |
| `users_email_lowercase` CHECK | case-insensitive email uniqueness |
| `*_version_positive` CHECKs | optimistic-locking integrity |
| `audit_logs_no_update`, `audit_logs_no_truncate` triggers | append-only audit trail |
| `audit_logs (chamber_id, created_at)`, `(user_id, created_at)`, `(resource_type, resource_id)` | scoped, filtered audit queries |
| `sessions.token_hash` unique | O(1) session lookup |

## Planned (next phases)

* **Patients** — `patients` (chamber-scoped patient code, demographics, trigram indexes for
  fuzzy name/phone search), `patient_contacts`, `patient_allergies`, `patient_medical_histories`.
* **Appointments & queue** — status history table, exclusion/unique constraints to prevent
  double booking, daily token sequences per chamber.
* **Clinical** — consultations with configurable vitals (key/value definitions, not hard-coded
  columns), ICD-compatible `diagnoses.code`.
* **Prescriptions** — `prescriptions` (RX number, state machine DRAFT → FINALIZED → REVISED →
  SUPERSEDED), immutable `prescription_versions` + `prescription_items`, unique constraint
  preventing two finalized versions for the same revision.

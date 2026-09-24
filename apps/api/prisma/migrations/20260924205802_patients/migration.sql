-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "patient_code" VARCHAR(24) NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "gender" "Gender" NOT NULL,
    "date_of_birth" DATE,
    "dob_estimated" BOOLEAN NOT NULL DEFAULT false,
    "blood_group" VARCHAR(3),
    "phone" VARCHAR(20),
    "phone_search" VARCHAR(20),
    "email" VARCHAR(254),
    "address" VARCHAR(500),
    "occupation" VARCHAR(100),
    "nationality" VARCHAR(60),
    "photo_file_id" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "deletion_reason" VARCHAR(500),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "relation" VARCHAR(60),
    "phone" VARCHAR(20) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "allergen" VARCHAR(120) NOT NULL,
    "reaction" VARCHAR(200),
    "severity" "AllergySeverity" NOT NULL DEFAULT 'UNKNOWN',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "deletion_reason" VARCHAR(500),

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medical_histories" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "existing_conditions" VARCHAR(2000),
    "previous_surgeries" VARCHAR(2000),
    "current_medications" VARCHAR(2000),
    "relevant_history" VARCHAR(4000),
    "family_history" VARCHAR(2000),
    "lifestyle" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID,
    "updated_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_medical_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_code_sequences" (
    "chamber_id" UUID NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "patient_code_sequences_pkey" PRIMARY KEY ("chamber_id")
);

-- CreateTable
CREATE TABLE "patient_recent_views" (
    "user_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_recent_views_pkey" PRIMARY KEY ("user_id","patient_id")
);

-- CreateIndex
CREATE INDEX "patients_chamber_id_created_at_idx" ON "patients"("chamber_id", "created_at");

-- CreateIndex
CREATE INDEX "patients_chamber_id_phone_search_idx" ON "patients"("chamber_id", "phone_search");

-- CreateIndex
CREATE INDEX "patients_chamber_id_date_of_birth_idx" ON "patients"("chamber_id", "date_of_birth");

-- CreateIndex
CREATE INDEX "patients_chamber_id_email_idx" ON "patients"("chamber_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "patients_chamber_id_patient_code_key" ON "patients"("chamber_id", "patient_code");

-- CreateIndex
CREATE INDEX "patient_contacts_patient_id_idx" ON "patient_contacts"("patient_id");

-- CreateIndex
CREATE INDEX "patient_allergies_patient_id_idx" ON "patient_allergies"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_medical_histories_patient_id_key" ON "patient_medical_histories"("patient_id");

-- CreateIndex
CREATE INDEX "patient_recent_views_user_id_chamber_id_viewed_at_idx" ON "patient_recent_views"("user_id", "chamber_id", "viewed_at");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_histories" ADD CONSTRAINT "patient_medical_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_recent_views" ADD CONSTRAINT "patient_recent_views_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-written: search indexes, constraints, permission rollout ─────────────

-- Trigram indexes power partial / fuzzy-friendly patient search (spec §6).
-- pg_trgm is a trusted extension, so the database owner can enable it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "patients_full_name_trgm" ON "patients" USING GIN (lower("full_name") gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX "patients_phone_search_trgm" ON "patients" USING GIN ("phone_search" gin_trgm_ops) WHERE "deleted_at" IS NULL;

ALTER TABLE "patients" ADD CONSTRAINT "patients_blood_group_valid"
  CHECK ("blood_group" IS NULL OR "blood_group" IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'));
ALTER TABLE "patients" ADD CONSTRAINT "patients_version_positive" CHECK ("version" > 0);
ALTER TABLE "patients" ADD CONSTRAINT "patients_dob_after_1900" CHECK ("date_of_birth" IS NULL OR "date_of_birth" >= DATE '1900-01-01');
ALTER TABLE "patients" ADD CONSTRAINT "patients_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "patient_medical_histories" ADD CONSTRAINT "patient_medical_histories_version_positive" CHECK ("version" > 0);
ALTER TABLE "patient_code_sequences" ADD CONSTRAINT "patient_code_sequences_chamber_fk"
  FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New permission `patients.view_medical`: grant to existing SUPER_ADMIN and DOCTOR roles.
-- (Fresh databases get it from the seed; this keeps already-running deployments consistent.)
INSERT INTO "permissions" ("id", "key", "group")
VALUES (gen_random_uuid(), 'patients.view_medical', 'patients')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" IN ('SUPER_ADMIN', 'DOCTOR') AND p."key" = 'patients.view_medical'
ON CONFLICT DO NOTHING;

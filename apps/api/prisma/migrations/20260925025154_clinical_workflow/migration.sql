-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiagnosisCertainty" AS ENUM ('CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL');

-- CreateEnum
CREATE TYPE "InvestigationPriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "VitalType" AS ENUM ('NUMBER', 'BLOOD_PRESSURE', 'TEXT');

-- CreateEnum
CREATE TYPE "ConsultationNoteType" AS ENUM ('CLINICAL', 'ADDENDUM');

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "chamber_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20),
    "code_system" VARCHAR(20) NOT NULL DEFAULT 'ICD-10',
    "category" VARCHAR(100),
    "description" VARCHAR(1000),
    "keywords" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" UUID NOT NULL,
    "chamber_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "short_name" VARCHAR(40),
    "category" VARCHAR(100),
    "sample_type" VARCHAR(60),
    "instructions" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "chamber_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vital_definitions" (
    "id" UUID NOT NULL,
    "chamber_id" UUID,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "unit" VARCHAR(20),
    "type" "VitalType" NOT NULL DEFAULT 'NUMBER',
    "min_value" DECIMAL(10,2),
    "max_value" DECIMAL(10,2),
    "decimals" SMALLINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vital_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'DRAFT',
    "visit_number" INTEGER NOT NULL,
    "present_illness" VARCHAR(4000),
    "past_history" VARCHAR(4000),
    "family_history" VARCHAR(2000),
    "medication_history" VARCHAR(2000),
    "other_history" VARCHAR(2000),
    "examination_notes" VARCHAR(4000),
    "follow_up_date" DATE,
    "follow_up_instructions" VARCHAR(500),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(3),
    "finalized_by" UUID,
    "finalized_by_name" VARCHAR(150),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" VARCHAR(500),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_symptoms" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "complaint_id" UUID,
    "text" VARCHAR(200) NOT NULL,
    "duration" VARCHAR(60),
    "note" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_symptoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_vitals" (
    "id" UUID NOT NULL,
    "consultation_id" UUID,
    "appointment_id" UUID,
    "definition_id" UUID NOT NULL,
    "value_text" VARCHAR(40) NOT NULL,
    "value_number" DECIMAL(10,2),
    "value_number2" DECIMAL(10,2),
    "recorded_by" UUID,
    "recorded_by_name" VARCHAR(150),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_diagnoses" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "diagnosis_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "certainty" "DiagnosisCertainty" NOT NULL DEFAULT 'CONFIRMED',
    "note" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_investigations" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "investigation_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "instructions" VARCHAR(300),
    "priority" "InvestigationPriority" NOT NULL DEFAULT 'ROUTINE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_notes" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "type" "ConsultationNoteType" NOT NULL,
    "text" VARCHAR(4000) NOT NULL,
    "created_by" UUID,
    "created_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagnoses_chamber_id_idx" ON "diagnoses"("chamber_id");

-- CreateIndex
CREATE INDEX "investigations_chamber_id_idx" ON "investigations"("chamber_id");

-- CreateIndex
CREATE INDEX "complaints_chamber_id_idx" ON "complaints"("chamber_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_appointment_id_key" ON "consultations"("appointment_id");

-- CreateIndex
CREATE INDEX "consultations_chamber_id_started_at_idx" ON "consultations"("chamber_id", "started_at");

-- CreateIndex
CREATE INDEX "consultations_patient_id_started_at_idx" ON "consultations"("patient_id", "started_at");

-- CreateIndex
CREATE INDEX "consultations_doctor_id_started_at_idx" ON "consultations"("doctor_id", "started_at");

-- CreateIndex
CREATE INDEX "consultations_chamber_id_follow_up_date_idx" ON "consultations"("chamber_id", "follow_up_date");

-- CreateIndex
CREATE INDEX "consultation_symptoms_consultation_id_idx" ON "consultation_symptoms"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_vitals_consultation_id_definition_id_key" ON "consultation_vitals"("consultation_id", "definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_vitals_appointment_id_definition_id_key" ON "consultation_vitals"("appointment_id", "definition_id");

-- CreateIndex
CREATE INDEX "consultation_diagnoses_consultation_id_idx" ON "consultation_diagnoses"("consultation_id");

-- CreateIndex
CREATE INDEX "consultation_diagnoses_diagnosis_id_idx" ON "consultation_diagnoses"("diagnosis_id");

-- CreateIndex
CREATE INDEX "consultation_investigations_consultation_id_idx" ON "consultation_investigations"("consultation_id");

-- CreateIndex
CREATE INDEX "consultation_investigations_investigation_id_idx" ON "consultation_investigations"("investigation_id");

-- CreateIndex
CREATE INDEX "consultation_notes_consultation_id_type_idx" ON "consultation_notes"("consultation_id", "type");

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_symptoms" ADD CONSTRAINT "consultation_symptoms_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_symptoms" ADD CONSTRAINT "consultation_symptoms_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_vitals" ADD CONSTRAINT "consultation_vitals_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_vitals" ADD CONSTRAINT "consultation_vitals_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "vital_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_diagnoses" ADD CONSTRAINT "consultation_diagnoses_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_diagnoses" ADD CONSTRAINT "consultation_diagnoses_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_investigations" ADD CONSTRAINT "consultation_investigations_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_investigations" ADD CONSTRAINT "consultation_investigations_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-written: search, uniqueness, immutability, permission rollout ─────────────

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_chamber_fk" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT;
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_chamber_fk" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_chamber_fk" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT;
ALTER TABLE "vital_definitions" ADD CONSTRAINT "vital_definitions_chamber_fk" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT;

-- Fuzzy, typo-tolerant catalogue search.
CREATE INDEX "diagnoses_name_trgm" ON "diagnoses" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX "diagnoses_keywords_trgm" ON "diagnoses" USING GIN (lower(coalesce("keywords", '')) gin_trgm_ops);
CREATE INDEX "investigations_name_trgm" ON "investigations" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX "complaints_name_trgm" ON "complaints" USING GIN (lower("name") gin_trgm_ops);

-- No duplicate names / codes within a scope (global or one chamber).
CREATE UNIQUE INDEX "diagnoses_scope_name_unique" ON "diagnoses" (coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE UNIQUE INDEX "diagnoses_scope_code_unique" ON "diagnoses" (coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid), "code_system", upper("code")) WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "investigations_scope_name_unique" ON "investigations" (coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE UNIQUE INDEX "complaints_scope_name_unique" ON "complaints" (coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE UNIQUE INDEX "vital_definitions_scope_key_unique" ON "vital_definitions" (coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid), "key");

-- At most one primary diagnosis and one private clinical note per consultation.
CREATE UNIQUE INDEX "consultation_diagnoses_one_primary" ON "consultation_diagnoses" ("consultation_id") WHERE "is_primary";
CREATE UNIQUE INDEX "consultation_notes_one_clinical" ON "consultation_notes" ("consultation_id") WHERE "type" = 'CLINICAL';

ALTER TABLE "consultation_vitals" ADD CONSTRAINT "consultation_vitals_owner"
  CHECK ("consultation_id" IS NOT NULL OR "appointment_id" IS NOT NULL);
ALTER TABLE "consultation_vitals" ADD CONSTRAINT "consultation_vitals_appointment_fk"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE;
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_version_positive" CHECK ("version" > 0);
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_finalized_fields"
  CHECK ("status" <> 'FINALIZED' OR ("finalized_at" IS NOT NULL AND "finalized_by" IS NOT NULL));
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_cancel_reason"
  CHECK ("status" <> 'CANCELLED' OR "cancelled_reason" IS NOT NULL);

-- Finalized consultations are immutable at the database level (spec §2, §12 principle):
-- clinical content can no longer change; only addenda may be appended.
CREATE OR REPLACE FUNCTION consultations_protect_finalized() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'FINALIZED' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."patient_id" IS DISTINCT FROM OLD."patient_id"
    OR NEW."doctor_id" IS DISTINCT FROM OLD."doctor_id"
    OR NEW."present_illness" IS DISTINCT FROM OLD."present_illness"
    OR NEW."past_history" IS DISTINCT FROM OLD."past_history"
    OR NEW."family_history" IS DISTINCT FROM OLD."family_history"
    OR NEW."medication_history" IS DISTINCT FROM OLD."medication_history"
    OR NEW."other_history" IS DISTINCT FROM OLD."other_history"
    OR NEW."examination_notes" IS DISTINCT FROM OLD."examination_notes"
    OR NEW."follow_up_date" IS DISTINCT FROM OLD."follow_up_date"
    OR NEW."follow_up_instructions" IS DISTINCT FROM OLD."follow_up_instructions"
    OR NEW."finalized_at" IS DISTINCT FROM OLD."finalized_at"
  ) THEN
    RAISE EXCEPTION 'finalized consultations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultations cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consultations_immutable BEFORE UPDATE ON "consultations"
  FOR EACH ROW EXECUTE FUNCTION consultations_protect_finalized();

CREATE OR REPLACE FUNCTION consultations_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consultations cannot be deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consultations_no_delete BEFORE DELETE ON "consultations"
  FOR EACH ROW EXECUTE FUNCTION consultations_no_delete();

-- Child rows of a finalized consultation cannot be inserted, changed or removed.
CREATE OR REPLACE FUNCTION consultation_children_protect() RETURNS trigger AS $$
DECLARE
  cid uuid;
  st text;
BEGIN
  cid := COALESCE(NEW."consultation_id", OLD."consultation_id");
  IF cid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT "status"::text INTO st FROM "consultations" WHERE "id" = cid;
  IF st = 'FINALIZED' THEN
    -- Addenda are the only permitted change after finalization.
    IF TG_TABLE_NAME = 'consultation_notes' AND TG_OP = 'INSERT' AND NEW."type" = 'ADDENDUM' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finalized consultations are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consultation_symptoms_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_symptoms"
  FOR EACH ROW EXECUTE FUNCTION consultation_children_protect();
CREATE TRIGGER consultation_vitals_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_vitals"
  FOR EACH ROW EXECUTE FUNCTION consultation_children_protect();
CREATE TRIGGER consultation_diagnoses_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_diagnoses"
  FOR EACH ROW EXECUTE FUNCTION consultation_children_protect();
CREATE TRIGGER consultation_investigations_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_investigations"
  FOR EACH ROW EXECUTE FUNCTION consultation_children_protect();
CREATE TRIGGER consultation_notes_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_notes"
  FOR EACH ROW EXECUTE FUNCTION consultation_children_protect();

-- New permission `vitals.record`: Super Admin, Doctor, Assistant.
INSERT INTO "permissions" ("id", "key", "group")
VALUES (gen_random_uuid(), 'vitals.record', 'clinical')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" IN ('SUPER_ADMIN', 'DOCTOR', 'ASSISTANT') AND p."key" = 'vitals.record'
ON CONFLICT DO NOTHING;

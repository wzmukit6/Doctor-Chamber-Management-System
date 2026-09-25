-- CreateEnum
CREATE TYPE "MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'DROPS', 'INJECTION', 'INHALER', 'NEBULIZER_SOLUTION', 'CREAM', 'OINTMENT', 'GEL', 'LOTION', 'EYE_DROPS', 'EAR_DROPS', 'NASAL_SPRAY', 'SACHET', 'SUPPOSITORY', 'MOUTHWASH', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicineRoute" AS ENUM ('ORAL', 'TOPICAL', 'INHALATION', 'IV', 'IM', 'SC', 'SUBLINGUAL', 'NASAL', 'OPHTHALMIC', 'OTIC', 'RECTAL', 'VAGINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MealInstruction" AS ENUM ('BEFORE_MEAL', 'AFTER_MEAL', 'WITH_MEAL', 'EMPTY_STOMACH', 'BEDTIME');

-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS', 'CONTINUE');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'FINALIZED', 'REVISED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrescriptionVersionStatus" AS ENUM ('DRAFT', 'FINALIZED', 'SUPERSEDED', 'DISCARDED');

-- CreateTable
CREATE TABLE "medicines" (
    "id" UUID NOT NULL,
    "chamber_id" UUID,
    "generic_name" VARCHAR(200) NOT NULL,
    "brand_name" VARCHAR(200),
    "manufacturer" VARCHAR(150),
    "form" "MedicineForm" NOT NULL,
    "strength" VARCHAR(80),
    "category" VARCHAR(100),
    "route" "MedicineRoute",
    "default_dose" VARCHAR(60),
    "common_frequencies" VARCHAR(60)[] DEFAULT ARRAY[]::VARCHAR(60)[],
    "common_durations" VARCHAR(60)[] DEFAULT ARRAY[]::VARCHAR(60)[],
    "keywords" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_medicine_favorites" (
    "doctor_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_medicine_favorites_pkey" PRIMARY KEY ("doctor_id","medicine_id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "rx_number" VARCHAR(20),
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_sequences" (
    "chamber_id" UUID NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prescription_sequences_pkey" PRIMARY KEY ("chamber_id")
);

-- CreateTable
CREATE TABLE "prescription_versions" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "PrescriptionVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "advice" VARCHAR(2000),
    "revision_reason" VARCHAR(500),
    "created_by" UUID,
    "created_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_by_name" VARCHAR(150),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "finalized_by" UUID,
    "finalized_by_name" VARCHAR(150),
    "superseded_at" TIMESTAMPTZ(3),
    "discarded_at" TIMESTAMPTZ(3),
    "verification_token" VARCHAR(64),
    "content_hash" VARCHAR(64),

    CONSTRAINT "prescription_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "medicine_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "generic_name" VARCHAR(200),
    "strength" VARCHAR(80),
    "form" "MedicineForm",
    "dose" VARCHAR(60),
    "frequency" VARCHAR(60),
    "route" "MedicineRoute",
    "duration_value" INTEGER,
    "duration_unit" "DurationUnit",
    "quantity" INTEGER,
    "meal_instruction" "MealInstruction",
    "timing" VARCHAR(100),
    "instructions" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_templates" (
    "id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "doctor_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "diagnoses" JSONB NOT NULL DEFAULT '[]',
    "investigations" JSONB NOT NULL DEFAULT '[]',
    "advice" VARCHAR(2000),
    "follow_up_instructions" VARCHAR(500),
    "created_by" UUID,
    "created_by_name" VARCHAR(150),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prescription_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "medicine_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "generic_name" VARCHAR(200),
    "strength" VARCHAR(80),
    "form" "MedicineForm",
    "dose" VARCHAR(60),
    "frequency" VARCHAR(60),
    "route" "MedicineRoute",
    "duration_value" INTEGER,
    "duration_unit" "DurationUnit",
    "quantity" INTEGER,
    "meal_instruction" "MealInstruction",
    "timing" VARCHAR(100),
    "instructions" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prescription_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicines_chamber_id_idx" ON "medicines"("chamber_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_consultation_id_key" ON "prescriptions"("consultation_id");

-- CreateIndex
CREATE INDEX "prescriptions_chamber_id_issued_at_idx" ON "prescriptions"("chamber_id", "issued_at");

-- CreateIndex
CREATE INDEX "prescriptions_patient_id_created_at_idx" ON "prescriptions"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "prescriptions_doctor_id_created_at_idx" ON "prescriptions"("doctor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_chamber_id_rx_number_key" ON "prescriptions"("chamber_id", "rx_number");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_versions_verification_token_key" ON "prescription_versions"("verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_versions_prescription_id_version_number_key" ON "prescription_versions"("prescription_id", "version_number");

-- CreateIndex
CREATE INDEX "prescription_items_version_id_idx" ON "prescription_items"("version_id");

-- CreateIndex
CREATE INDEX "prescription_items_medicine_id_idx" ON "prescription_items"("medicine_id");

-- CreateIndex
CREATE INDEX "prescription_templates_chamber_id_idx" ON "prescription_templates"("chamber_id");

-- CreateIndex
CREATE INDEX "prescription_template_items_template_id_idx" ON "prescription_template_items"("template_id");

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_medicine_favorites" ADD CONSTRAINT "doctor_medicine_favorites_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_medicine_favorites" ADD CONSTRAINT "doctor_medicine_favorites_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prescription_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_template_items" ADD CONSTRAINT "prescription_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prescription_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-written rules (Phase 5) ─────────────

-- Fuzzy, typo-tolerant medicine search on generic and brand names.
CREATE INDEX "medicines_generic_trgm" ON "medicines" USING GIN (lower("generic_name") gin_trgm_ops);
CREATE INDEX "medicines_brand_trgm" ON "medicines" USING GIN (lower(coalesce("brand_name", '')) gin_trgm_ops);

-- No duplicate medicine (same brand/generic, form and strength) within a scope.
CREATE UNIQUE INDEX "medicines_scope_unique" ON "medicines" (
  coalesce("chamber_id", '00000000-0000-0000-0000-000000000000'::uuid),
  lower(coalesce("brand_name", '')),
  lower("generic_name"),
  "form",
  lower(coalesce("strength", ''))
);

-- Template names are unique per owner (a doctor, or the chamber for shared ones).
CREATE UNIQUE INDEX "prescription_templates_owner_name_unique" ON "prescription_templates" (
  "chamber_id",
  coalesce("doctor_id", '00000000-0000-0000-0000-000000000000'::uuid),
  lower("name")
);

-- At most one current (finalized) version and one open draft per prescription.
CREATE UNIQUE INDEX "prescription_versions_one_finalized" ON "prescription_versions" ("prescription_id") WHERE "status" = 'FINALIZED';
CREATE UNIQUE INDEX "prescription_versions_one_draft" ON "prescription_versions" ("prescription_id") WHERE "status" = 'DRAFT';

ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_version_positive" CHECK ("version" > 0);
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_issued_fields"
  CHECK ("status" IN ('DRAFT', 'CANCELLED') OR ("rx_number" IS NOT NULL AND "issued_at" IS NOT NULL));
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_number_positive" CHECK ("version_number" > 0);
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_finalized_fields"
  CHECK ("status" IN ('DRAFT', 'DISCARDED') OR ("finalized_at" IS NOT NULL AND "finalized_by" IS NOT NULL AND "verification_token" IS NOT NULL AND "content_hash" IS NOT NULL));
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_revision_reason"
  CHECK ("version_number" = 1 OR "revision_reason" IS NOT NULL);
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_duration_positive" CHECK ("duration_value" IS NULL OR "duration_value" > 0);
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0);

-- Finalized prescription versions are immutable (spec §12, §39): the only
-- permitted change is FINALIZED → SUPERSEDED (setting superseded_at) when a
-- revision is finalized. Drafts may become FINALIZED or DISCARDED; nothing
-- else ever changes and no version is ever deleted.
CREATE OR REPLACE FUNCTION prescription_versions_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescription versions cannot be deleted';
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'FINALIZED' AND NEW."status" = 'SUPERSEDED'
     AND NEW."superseded_at" IS NOT NULL
     AND NEW."prescription_id" = OLD."prescription_id"
     AND NEW."version_number" = OLD."version_number"
     AND NEW."advice" IS NOT DISTINCT FROM OLD."advice"
     AND NEW."revision_reason" IS NOT DISTINCT FROM OLD."revision_reason"
     AND NEW."finalized_at" IS NOT DISTINCT FROM OLD."finalized_at"
     AND NEW."finalized_by" IS NOT DISTINCT FROM OLD."finalized_by"
     AND NEW."verification_token" IS NOT DISTINCT FROM OLD."verification_token"
     AND NEW."content_hash" IS NOT DISTINCT FROM OLD."content_hash" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finalized prescription versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescription_versions_immutable BEFORE UPDATE OR DELETE ON "prescription_versions"
  FOR EACH ROW EXECUTE FUNCTION prescription_versions_protect();

-- Items can only be written while their version is a draft.
CREATE OR REPLACE FUNCTION prescription_items_protect() RETURNS trigger AS $$
DECLARE
  vid uuid;
  st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    vid := OLD."version_id";
  ELSE
    vid := NEW."version_id";
  END IF;
  SELECT "status"::text INTO st FROM "prescription_versions" WHERE "id" = vid;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'finalized prescription versions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."version_id" <> NEW."version_id" THEN
    RAISE EXCEPTION 'prescription items cannot move between versions';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescription_items_protect BEFORE INSERT OR UPDATE OR DELETE ON "prescription_items"
  FOR EACH ROW EXECUTE FUNCTION prescription_items_protect();

-- Prescriptions are never deleted; the Rx number and ownership never change once issued.
CREATE OR REPLACE FUNCTION prescriptions_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescriptions cannot be deleted';
  END IF;
  IF (OLD."rx_number" IS NOT NULL AND NEW."rx_number" IS DISTINCT FROM OLD."rx_number")
     OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."doctor_id" <> OLD."doctor_id"
     OR NEW."consultation_id" <> OLD."consultation_id"
     OR (OLD."issued_at" IS NOT NULL AND NEW."issued_at" IS DISTINCT FROM OLD."issued_at") THEN
    RAISE EXCEPTION 'issued prescription identity is immutable';
  END IF;
  IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled prescriptions cannot be reopened';
  END IF;
  IF OLD."status" IN ('FINALIZED', 'REVISED') AND NEW."status" NOT IN ('FINALIZED', 'REVISED') THEN
    RAISE EXCEPTION 'invalid prescription status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescriptions_protect BEFORE UPDATE OR DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION prescriptions_protect();

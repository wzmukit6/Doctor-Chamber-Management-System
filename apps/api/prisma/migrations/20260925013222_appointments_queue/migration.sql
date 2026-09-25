-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('NEW', 'FOLLOW_UP', 'REPORT_REVIEW');

-- CreateEnum
CREATE TYPE "AppointmentHistoryAction" AS ENUM ('CREATED', 'STATUS_CHANGED', 'RESCHEDULED', 'UPDATED');

-- DropForeignKey
ALTER TABLE "patient_code_sequences" DROP CONSTRAINT "patient_code_sequences_chamber_fk";

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "max_daily_patients" INTEGER,
ADD COLUMN     "slot_minutes" INTEGER;

-- CreateTable
CREATE TABLE "doctor_schedule_windows" (
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_schedule_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "visit_type" "VisitType" NOT NULL DEFAULT 'NEW',
    "reason" VARCHAR(300),
    "notes" VARCHAR(1000),
    "is_walk_in" BOOLEAN NOT NULL DEFAULT false,
    "is_overbooked" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" TIMESTAMPTZ(3),
    "queued_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancelled_reason" VARCHAR(500),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "action" "AppointmentHistoryAction" NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus",
    "details" JSONB,
    "reason" VARCHAR(500),
    "changed_by" UUID,
    "changed_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tokens" (
    "id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "queue_date" DATE NOT NULL,
    "scope_key" VARCHAR(40) NOT NULL,
    "token_number" INTEGER NOT NULL,
    "label" VARCHAR(12) NOT NULL,
    "on_hold" BOOLEAN NOT NULL DEFAULT false,
    "called_at" TIMESTAMPTZ(3),
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_token_sequences" (
    "chamber_id" UUID NOT NULL,
    "scope_key" VARCHAR(40) NOT NULL,
    "queue_date" DATE NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "queue_token_sequences_pkey" PRIMARY KEY ("chamber_id","scope_key","queue_date")
);

-- CreateIndex
CREATE INDEX "doctor_schedule_windows_doctor_id_weekday_idx" ON "doctor_schedule_windows"("doctor_id", "weekday");

-- CreateIndex
CREATE INDEX "appointments_chamber_id_starts_at_idx" ON "appointments"("chamber_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_doctor_id_starts_at_idx" ON "appointments"("doctor_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_patient_id_starts_at_idx" ON "appointments"("patient_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_chamber_id_status_idx" ON "appointments"("chamber_id", "status");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_created_at_idx" ON "appointment_status_history"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tokens_appointment_id_key" ON "queue_tokens"("appointment_id");

-- CreateIndex
CREATE INDEX "queue_tokens_chamber_id_queue_date_idx" ON "queue_tokens"("chamber_id", "queue_date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tokens_chamber_id_scope_key_queue_date_token_number_key" ON "queue_tokens"("chamber_id", "scope_key", "queue_date", "token_number");

-- AddForeignKey
ALTER TABLE "doctor_schedule_windows" ADD CONSTRAINT "doctor_schedule_windows_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Hand-written: double-booking prevention, constraints, permission rollout ─────────────

-- btree_gist lets an exclusion constraint combine "=" on ids with "&&" on time ranges.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A doctor can never have two overlapping active appointments (spec §46).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_doctor_overlap"
  EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW') AND NOT "is_overbooked");

-- A patient can never be in two overlapping active appointments.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_patient_overlap"
  EXCLUDE USING gist ("patient_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW'));

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ends_after_start" CHECK ("ends_at" > "starts_at");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_version_positive" CHECK ("version" > 0);
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancel_reason"
  CHECK ("status" NOT IN ('CANCELLED') OR "cancelled_reason" IS NOT NULL);

ALTER TABLE "doctor_schedule_windows" ADD CONSTRAINT "doctor_schedule_windows_valid"
  CHECK ("weekday" BETWEEN 0 AND 6 AND "start_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "end_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "start_time" < "end_time");
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_slot_minutes_valid" CHECK ("slot_minutes" IS NULL OR "slot_minutes" BETWEEN 5 AND 240);
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_number_positive" CHECK ("token_number" > 0);

-- New permission `schedules.manage` (doctor availability): Super Admin and Manager.
INSERT INTO "permissions" ("id", "key", "group")
VALUES (gen_random_uuid(), 'schedules.manage', 'appointments')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" IN ('SUPER_ADMIN', 'MANAGER') AND p."key" = 'schedules.manage'
ON CONFLICT DO NOTHING;

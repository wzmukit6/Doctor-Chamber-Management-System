-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceItemType" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'INVESTIGATION', 'PROCEDURE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MOBILE_BANKING', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "FeeItemKind" AS ENUM ('INVESTIGATION', 'PROCEDURE', 'OTHER');

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "report_review_fee" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID,
    "appointment_id" UUID,
    "invoice_number" VARCHAR(20) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2),
    "discount_reason" VARCHAR(300),
    "total" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "due_amount" DECIMAL(12,2) NOT NULL,
    "notes" VARCHAR(500),
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" VARCHAR(300),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_by_name" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "type" "InvoiceItemType" NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee_item_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "receipt_number" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" VARCHAR(60),
    "reference" VARCHAR(100),
    "note" VARCHAR(300),
    "reason" VARCHAR(300),
    "received_by" UUID,
    "received_by_name" VARCHAR(150),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_sequences" (
    "chamber_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billing_sequences_pkey" PRIMARY KEY ("chamber_id","kind")
);

-- CreateTable
CREATE TABLE "fee_items" (
    "id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "kind" "FeeItemKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "investigation_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_chamber_id_issued_at_idx" ON "invoices"("chamber_id", "issued_at");

-- CreateIndex
CREATE INDEX "invoices_patient_id_issued_at_idx" ON "invoices"("patient_id", "issued_at");

-- CreateIndex
CREATE INDEX "invoices_doctor_id_issued_at_idx" ON "invoices"("doctor_id", "issued_at");

-- CreateIndex
CREATE INDEX "invoices_chamber_id_status_idx" ON "invoices"("chamber_id", "status");

-- CreateIndex
CREATE INDEX "invoices_appointment_id_idx" ON "invoices"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_chamber_id_invoice_number_key" ON "invoices"("chamber_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_chamber_id_received_at_idx" ON "payments"("chamber_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_chamber_id_receipt_number_key" ON "payments"("chamber_id", "receipt_number");

-- CreateIndex
CREATE INDEX "fee_items_chamber_id_idx" ON "fee_items"("chamber_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_investigation_id_fkey" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written rules (Phase 6) ─────────────

-- Totals are always internally consistent (spec §18: total, paid, due).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_valid" CHECK (
  "subtotal" >= 0 AND "discount_amount" >= 0 AND "discount_amount" <= "subtotal"
  AND "total" = "subtotal" - "discount_amount"
  AND "paid_amount" >= 0 AND "paid_amount" <= "total"
  AND "refunded_amount" >= 0
  AND "due_amount" = "total" - "paid_amount"
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_consistent" CHECK (
  ("status" = 'VOID' AND "voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "paid_amount" = 0)
  OR ("status" = 'PAID' AND "due_amount" = 0 AND "voided_at" IS NULL)
  OR ("status" = 'PARTIALLY_PAID' AND "paid_amount" > 0 AND "due_amount" > 0 AND "voided_at" IS NULL)
  OR ("status" = 'UNPAID' AND "paid_amount" = 0 AND "due_amount" > 0 AND "voided_at" IS NULL)
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_reason" CHECK ("discount_amount" = 0 OR "discount_reason" IS NOT NULL);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_version_positive" CHECK ("version" > 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amount_valid" CHECK (
  "quantity" > 0 AND "unit_price" >= 0 AND "amount" = "unit_price" * "quantity"
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_reason" CHECK ("kind" <> 'REFUND' OR "reason" IS NOT NULL);
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_amount_valid" CHECK ("amount" >= 0);

-- One active (non-void) bill per appointment.
CREATE UNIQUE INDEX "invoices_one_per_appointment" ON "invoices" ("appointment_id") WHERE "appointment_id" IS NOT NULL AND "status" <> 'VOID';
-- One fee per investigation per chamber; fee names unique per chamber.
CREATE UNIQUE INDEX "fee_items_chamber_investigation_unique" ON "fee_items" ("chamber_id", "investigation_id") WHERE "investigation_id" IS NOT NULL;
CREATE UNIQUE INDEX "fee_items_chamber_name_unique" ON "fee_items" ("chamber_id", lower("name"));
-- Open invoices (dues) are queried often.
CREATE INDEX "invoices_open_dues" ON "invoices" ("chamber_id", "issued_at") WHERE "status" IN ('UNPAID', 'PARTIALLY_PAID');

-- The payment ledger is append-only: corrections are refunds, never edits.
CREATE OR REPLACE FUNCTION payments_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payments are append-only; record a refund instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();

-- Bills are never deleted (void them); void bills never change again.
CREATE OR REPLACE FUNCTION invoices_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; void them instead';
  END IF;
  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'void invoices cannot be changed';
  END IF;
  IF NEW."invoice_number" <> OLD."invoice_number" OR NEW."patient_id" <> OLD."patient_id" OR NEW."chamber_id" <> OLD."chamber_id" THEN
    RAISE EXCEPTION 'invoice identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoices_protect BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_protect();

-- Items of a void bill are frozen.
CREATE OR REPLACE FUNCTION invoice_items_protect() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  SELECT "status"::text INTO st FROM "invoices" WHERE "id" = COALESCE(NEW."invoice_id", OLD."invoice_id");
  IF st = 'VOID' THEN
    RAISE EXCEPTION 'void invoices cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_items_protect BEFORE INSERT OR UPDATE OR DELETE ON "invoice_items"
  FOR EACH ROW EXECUTE FUNCTION invoice_items_protect();

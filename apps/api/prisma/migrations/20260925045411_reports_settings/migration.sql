-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "prescription_footer" VARCHAR(300),
ADD COLUMN     "signature_data_url" TEXT;

-- Signature images stay small (≈300 KB) and must be image data URLs.
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_signature_data_url_valid" CHECK (
  "signature_data_url" IS NULL OR (length("signature_data_url") <= 400000 AND "signature_data_url" ~ '^data:image/(png|jpeg|webp);base64,')
);

-- Reporting indexes (spec §19): finalized consultations and payments by chamber and time.
CREATE INDEX IF NOT EXISTS "consultations_chamber_finalized" ON "consultations" ("chamber_id", "finalized_at") WHERE "status" = 'FINALIZED';

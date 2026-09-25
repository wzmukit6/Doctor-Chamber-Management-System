-- Phase 8: performance hardening (spec §44). Measured on 100k patients / 120k
-- appointments / 110k consultations (see docs/PERFORMANCE.md).

-- Patient search ORs patient code, name, phone and email. Every branch needs a
-- trigram index or PostgreSQL falls back to a sequential scan (292 ms → 62 ms).
CREATE INDEX "patients_code_trgm" ON "patients" USING GIN (lower("patient_code") gin_trgm_ops) WHERE "deleted_at" IS NULL;
CREATE INDEX "patients_email_trgm" ON "patients" USING GIN ("email" gin_trgm_ops) WHERE "deleted_at" IS NULL;

-- JIT compilation costs ~400 ms per report query and never pays off for this
-- workload (short OLTP queries and small aggregates).
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
END $$;

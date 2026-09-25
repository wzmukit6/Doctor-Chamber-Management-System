-- Fix: the shared child-row trigger referenced NEW."type", which only exists on
-- consultation_notes. Split into a generic function and a notes-specific one.

CREATE OR REPLACE FUNCTION consultation_children_protect() RETURNS trigger AS $$
DECLARE
  cid uuid;
  st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cid := OLD."consultation_id";
  ELSE
    cid := NEW."consultation_id";
  END IF;
  IF cid IS NULL AND TG_OP = 'UPDATE' THEN
    cid := OLD."consultation_id";
  END IF;
  IF cid IS NOT NULL THEN
    SELECT "status"::text INTO st FROM "consultations" WHERE "id" = cid;
    IF st = 'FINALIZED' THEN
      RAISE EXCEPTION 'finalized consultations are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Notes: addenda may be appended to finalized consultations; nothing else changes.
CREATE OR REPLACE FUNCTION consultation_notes_protect() RETURNS trigger AS $$
DECLARE
  cid uuid;
  st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    cid := OLD."consultation_id";
  ELSE
    cid := NEW."consultation_id";
  END IF;
  SELECT "status"::text INTO st FROM "consultations" WHERE "id" = cid;
  IF st = 'FINALIZED' THEN
    IF TG_OP = 'INSERT' AND NEW."type" = 'ADDENDUM' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finalized consultations are immutable';
  END IF;
  -- Addenda are append-only at all times.
  IF TG_OP <> 'INSERT' AND OLD."type" = 'ADDENDUM' THEN
    RAISE EXCEPTION 'addenda are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consultation_notes_protect ON "consultation_notes";
CREATE TRIGGER consultation_notes_protect BEFORE INSERT OR UPDATE OR DELETE ON "consultation_notes"
  FOR EACH ROW EXECUTE FUNCTION consultation_notes_protect();

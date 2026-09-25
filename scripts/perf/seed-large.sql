-- Large synthetic dataset for performance testing (spec §44).
--
-- Run ONLY against a dedicated performance database (see scripts/perf/README.md),
-- as a superuser, e.g.:
--   psql "$PERF_DATABASE_URL" -v patients=100000 -v appointments=120000 -v days=400 -f scripts/perf/seed-large.sql
--
-- Triggers are disabled for the session (session_replication_role = replica) so the
-- bulk load can write finalized consultations directly; CHECK, UNIQUE and EXCLUDE
-- constraints still apply. Everything is flagged is_demo = true.
\set ON_ERROR_STOP on
\timing on
SET session_replication_role = replica;
SET synchronous_commit = off;

BEGIN;

CREATE TEMP TABLE ctx ON COMMIT DROP AS
SELECT c.id AS chamber_id, c.organization_id, d.id AS doctor_id, u.id AS user_id, u.full_name AS doctor_name
FROM chambers c
JOIN doctors d ON d.chamber_id = c.id
JOIN users u ON u.id = d.user_id
WHERE c.code = 'DHN'
ORDER BY d.created_at
LIMIT 1;

-- Patients -------------------------------------------------------------------
CREATE TEMP TABLE perf_patients ON COMMIT DROP AS
SELECT g AS n, gen_random_uuid() AS id FROM generate_series(1, :patients) g;
CREATE INDEX ON perf_patients (n);

INSERT INTO patients (id, organization_id, chamber_id, patient_code, full_name, gender, date_of_birth,
                      blood_group, phone, phone_search, address, is_demo, created_at, updated_at)
SELECT p.id, ctx.organization_id, ctx.chamber_id,
       'PF-' || lpad(p.n::text, 7, '0'),
       (ARRAY['Abdul','Rahima','Kamal','Nasrin','Rafiqul','Salma','Jamal','Fatema','Habib','Shirin','Mizanur','Taslima',
              'Anwar','Rokeya','Shafiq','Moushumi','Tariq','Nusrat','Belal','Sharmin','Imran','Farzana','Sohel','Laila',
              'Arif','Sabina','Mahbub','Parvin','Zahid','Ayesha','Rashed','Tania','Kawsar','Mitu','Hasan','Jannat',
              'Faruk','Sumaiya','Masud','Rupa'])[1 + p.n % 40]
       || ' ' ||
       (ARRAY['Karim','Begum','Hossain','Akter','Islam','Rahman','Uddin','Khatun','Ahmed','Sultana','Chowdhury','Miah',
              'Sarker','Das','Roy','Talukder','Bhuiyan','Mollah','Sheikh','Khan','Siddique','Haque','Alam','Kabir',
              'Mondal','Saha','Paul','Biswas','Majumder','Hasan'])[1 + (p.n / 40) % 30],
       (CASE WHEN p.n % 2 = 0 THEN 'MALE' ELSE 'FEMALE' END)::"Gender",
       date '1940-01-01' + (p.n::bigint * 7919 % 30000)::int,
       (ARRAY['A+','B+','O+','AB+','A-','B-','O-','AB-'])[1 + p.n % 8],
       '01' || (3 + p.n % 7)::text || lpad((p.n::bigint * 104729 % 100000000)::text, 8, '0'),
       '01' || (3 + p.n % 7)::text || lpad((p.n::bigint * 104729 % 100000000)::text, 8, '0'),
       'House ' || (p.n % 200) || ', Road ' || (p.n % 30) || ', Dhaka',
       true,
       now() - ((p.n % 700) || ' days')::interval,
       now()
FROM perf_patients p, ctx;

-- Appointments: one doctor, 3-minute slots from 08:00 chamber time, spread over :days days
CREATE TEMP TABLE perf_appts ON COMMIT DROP AS
SELECT g AS n,
       gen_random_uuid() AS id,
       pp.id AS patient_id,
       ((current_date - (g % :days)) + time '08:00' + ((g / :days) * 3 || ' minutes')::interval) AT TIME ZONE 'Asia/Dhaka' AS starts_at,
       CASE WHEN g % 20 = 0 THEN 'NO_SHOW' WHEN g % 33 = 0 THEN 'CANCELLED' ELSE 'COMPLETED' END AS status,
       CASE WHEN g % 3 = 0 THEN 'FOLLOW_UP' ELSE 'NEW' END AS visit_type
FROM generate_series(1, :appointments) g
JOIN perf_patients pp ON pp.n = 1 + (g::bigint * 7) % :patients;

INSERT INTO appointments (id, organization_id, chamber_id, patient_id, doctor_id, starts_at, ends_at, status, visit_type,
                          checked_in_at, started_at, completed_at, cancelled_at, cancelled_reason, is_demo, created_at, updated_at)
SELECT a.id, ctx.organization_id, ctx.chamber_id, a.patient_id, ctx.doctor_id, a.starts_at, a.starts_at + interval '3 minutes',
       a.status::"AppointmentStatus", a.visit_type::"VisitType",
       CASE WHEN a.status = 'COMPLETED' THEN a.starts_at - interval '20 minutes' END,
       CASE WHEN a.status = 'COMPLETED' THEN a.starts_at END,
       CASE WHEN a.status = 'COMPLETED' THEN a.starts_at + interval '3 minutes' END,
       CASE WHEN a.status = 'CANCELLED' THEN a.starts_at - interval '1 day' END,
       CASE WHEN a.status = 'CANCELLED' THEN 'Patient request' END,
       true, a.starts_at - interval '2 days', now()
FROM perf_appts a, ctx;

-- Finalized consultations with a primary diagnosis for completed visits
CREATE TEMP TABLE perf_diag ON COMMIT DROP AS
SELECT row_number() OVER (ORDER BY name) AS n, id, name, code FROM diagnoses WHERE chamber_id IS NULL AND is_active;

CREATE TEMP TABLE perf_consults ON COMMIT DROP AS
SELECT a.n, gen_random_uuid() AS id, a.id AS appointment_id, a.patient_id, a.starts_at
FROM perf_appts a WHERE a.status = 'COMPLETED';

INSERT INTO consultations (id, organization_id, chamber_id, patient_id, doctor_id, appointment_id, status, visit_number,
                           examination_notes, started_at, finalized_at, finalized_by, finalized_by_name, is_demo, created_at, updated_at)
SELECT c.id, ctx.organization_id, ctx.chamber_id, c.patient_id, ctx.doctor_id, c.appointment_id, 'FINALIZED', 1,
       'Synthetic performance record', c.starts_at, c.starts_at + interval '3 minutes', ctx.user_id, ctx.doctor_name,
       true, c.starts_at, now()
FROM perf_consults c, ctx;

INSERT INTO consultation_diagnoses (id, consultation_id, diagnosis_id, name, code, is_primary)
SELECT gen_random_uuid(), c.id, d.id, d.name, d.code, true
FROM perf_consults c
JOIN perf_diag d ON d.n = 1 + (c.n * 31) % (SELECT count(*) FROM perf_diag);

-- Paid bills with one payment each
INSERT INTO invoices (id, organization_id, chamber_id, patient_id, doctor_id, appointment_id, invoice_number, status,
                      subtotal, total, paid_amount, due_amount, issued_at, is_demo, created_at, updated_at)
SELECT gen_random_uuid(), ctx.organization_id, ctx.chamber_id, c.patient_id, ctx.doctor_id, c.appointment_id,
       'PF' || lpad(c.n::text, 8, '0'), 'PAID',
       500 + (c.n % 5) * 250, 500 + (c.n % 5) * 250, 500 + (c.n % 5) * 250, 0,
       c.starts_at + interval '4 minutes', true, c.starts_at, now()
FROM perf_consults c, ctx;

INSERT INTO payments (id, invoice_id, chamber_id, kind, receipt_number, amount, method, provider, received_by, received_by_name, received_at, is_demo)
SELECT gen_random_uuid(), i.id, i.chamber_id, 'PAYMENT', 'PR' || substr(i.invoice_number, 3), i.total,
       (ARRAY['CASH','CASH','MOBILE_BANKING','CARD'])[1 + (hashtext(i.invoice_number) & 3)]::"PaymentMethod",
       CASE WHEN (hashtext(i.invoice_number) & 3) = 2 THEN 'bKash' END,
       ctx.user_id, ctx.doctor_name, i.issued_at, true
FROM invoices i, ctx WHERE i.invoice_number LIKE 'PF%';

COMMIT;

SET session_replication_role = origin;
ANALYZE;

SELECT (SELECT count(*) FROM patients) AS patients,
       (SELECT count(*) FROM appointments) AS appointments,
       (SELECT count(*) FROM consultations) AS consultations,
       (SELECT count(*) FROM invoices) AS invoices,
       (SELECT count(*) FROM payments) AS payments;

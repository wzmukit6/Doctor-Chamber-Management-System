import { Prisma, PrismaClient } from '@prisma/client';
import { PERMISSIONS, type LocalizedText, type Permission, type ReportColumnDto, type ReportKey, type ReportResultDto } from '@chamber/shared';

/** Scope and period a report runs in (resolved and authorized by ReportsService). */
export interface ReportContext {
  chamberId: string | null; // null = all chambers (platform administrators)
  doctorId: string | null; // forced for doctors ("personal" reports), optional filter otherwise
  from: string;
  to: string;
  start: Date;
  end: Date;
  tz: string;
  today: string;
}

type Row = Record<string, string | number | null>;
export interface ReportOutput {
  rows: Row[];
  summary?: ReportResultDto['summary'];
}

export interface ReportDefinition {
  key: ReportKey;
  group: ReportResultDto['group'];
  permission: Permission;
  /** Additional permissions (e.g. listing patients also needs patients.view). */
  also?: Permission[];
  title: LocalizedText;
  description: LocalizedText;
  columns: ReportColumnDto[];
  chart?: ReportResultDto['chart'];
  ignoresRange?: boolean;
  /** Filters by doctor (so doctors get their own data). */
  doctorScoped: boolean;
  run(db: PrismaClient, ctx: ReportContext): Promise<ReportOutput>;
}

export const ROW_LIMIT = 5000;
const L = (en: string, bn: string): LocalizedText => ({ en, bn });
const col = (key: string, en: string, bn: string, type: ReportColumnDto['type'] = 'number', options?: ReportColumnDto['options']): ReportColumnDto => ({ key, label: L(en, bn), type, ...(options ? { options } : {}) });

const DATE = col('date', 'Date', 'তারিখ', 'date');
const DOCTOR = col('doctor', 'Doctor', 'ডাক্তার', 'text');
const PATIENT = col('patient', 'Patient', 'রোগী', 'text');
const CODE = col('patient_code', 'Patient ID', 'রোগীর আইডি', 'text');

const GENDER = { MALE: L('Male', 'পুরুষ'), FEMALE: L('Female', 'মহিলা'), OTHER: L('Other', 'অন্যান্য'), UNDISCLOSED: L('Undisclosed', 'বলতে অনিচ্ছুক') };
const APPT_STATUS = {
  BOOKED: L('Booked', 'বুক করা'),
  CONFIRMED: L('Confirmed', 'নিশ্চিত'),
  CHECKED_IN: L('Checked in', 'চেক-ইন'),
  WAITING: L('Waiting', 'অপেক্ষমাণ'),
  IN_CONSULTATION: L('In consultation', 'পরামর্শে'),
  COMPLETED: L('Completed', 'সম্পন্ন'),
  CANCELLED: L('Cancelled', 'বাতিল'),
  NO_SHOW: L('No-show', 'অনুপস্থিত'),
};
const VISIT = { NEW: L('New', 'নতুন'), FOLLOW_UP: L('Follow-up', 'ফলো-আপ'), REPORT_REVIEW: L('Report review', 'রিপোর্ট দেখা') };
const METHOD = { CASH: L('Cash', 'নগদ'), CARD: L('Card', 'কার্ড'), MOBILE_BANKING: L('Mobile banking', 'মোবাইল ব্যাংকিং'), BANK_TRANSFER: L('Bank transfer', 'ব্যাংক ট্রান্সফার'), OTHER: L('Other', 'অন্যান্য') };
const RX_STATUS = { FINALIZED: L('Finalized', 'চূড়ান্ত'), REVISED: L('Revised', 'সংশোধিত') };
const FU_STATUS = { returned: L('Returned', 'ফিরেছেন'), overdue: L('Overdue', 'মেয়াদোত্তীর্ণ'), upcoming: L('Upcoming', 'আসন্ন') };
const INV_STATUS = { UNPAID: L('Unpaid', 'অপরিশোধিত'), PARTIALLY_PAID: L('Partly paid', 'আংশিক') };

// ───────────── SQL helpers ─────────────

const inChamber = (ctx: ReportContext, alias: string) => (ctx.chamberId ? Prisma.sql`AND ${Prisma.raw(alias)}.chamber_id = ${ctx.chamberId}::uuid` : Prisma.empty);
const byDoctor = (ctx: ReportContext, alias: string) => (ctx.doctorId ? Prisma.sql`AND ${Prisma.raw(alias)}.doctor_id = ${ctx.doctorId}::uuid` : Prisma.empty);
const day = (ctx: ReportContext, column: string) => Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE ${ctx.tz})::date`;
const days = (ctx: ReportContext) => Prisma.sql`SELECT d::date AS day FROM generate_series(${ctx.from}::date, ${ctx.to}::date, interval '1 day') d`;
const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const money2 = (v: unknown) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);

// ───────────── Definitions ─────────────

export const REPORTS: ReportDefinition[] = [
  // ── Operational (reports.view) ──
  {
    key: 'appointments-daily',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    title: L('Appointments by day', 'দিনভিত্তিক অ্যাপয়েন্টমেন্ট'),
    description: L('Booked, completed, cancelled and missed appointments per day.', 'প্রতিদিনের বুক, সম্পন্ন, বাতিল ও অনুপস্থিত অ্যাপয়েন্টমেন্ট।'),
    columns: [
      DATE,
      col('total', 'Appointments', 'অ্যাপয়েন্টমেন্ট'),
      col('completed', 'Completed', 'সম্পন্ন'),
      col('cancelled', 'Cancelled', 'বাতিল'),
      col('no_show', 'No-shows', 'অনুপস্থিত'),
      col('walk_ins', 'Walk-ins', 'ওয়াক-ইন'),
      col('completion_rate', 'Completion rate', 'সম্পন্নের হার', 'percent'),
    ],
    chart: { type: 'column', x: 'date', series: [{ key: 'total', label: L('Appointments', 'অ্যাপয়েন্টমেন্ট') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        WITH days AS (${days(ctx)}),
        a AS (SELECT ${day(ctx, 'a.starts_at')} AS day, a.status, a.is_walk_in FROM appointments a
              WHERE a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} ${inChamber(ctx, 'a')} ${byDoctor(ctx, 'a')})
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date, count(a.day)::int AS total,
          count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
          count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
          count(*) FILTER (WHERE a.status = 'NO_SHOW')::int AS no_show,
          count(*) FILTER (WHERE a.is_walk_in)::int AS walk_ins
        FROM days LEFT JOIN a ON a.day = days.day GROUP BY days.day ORDER BY days.day`;
      for (const r of rows) r.completion_rate = pct(Number(r.completed), Number(r.total) - Number(r.cancelled));
      const total = sum(rows, 'total');
      return {
        rows,
        summary: [
          { label: L('Appointments', 'অ্যাপয়েন্টমেন্ট'), value: total, type: 'number' },
          { label: L('Completed', 'সম্পন্ন'), value: sum(rows, 'completed'), type: 'number' },
          { label: L('Cancelled', 'বাতিল'), value: sum(rows, 'cancelled'), type: 'number' },
          { label: L('No-show rate', 'অনুপস্থিতির হার'), value: pct(sum(rows, 'no_show'), total - sum(rows, 'cancelled')), type: 'percent' },
        ],
      };
    },
  },
  {
    key: 'no-show-rate',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    title: L('No-show rate by doctor', 'ডাক্তারভিত্তিক অনুপস্থিতির হার'),
    description: L('Past appointments that were missed, per doctor.', 'প্রত্যেক ডাক্তারের অতীত অ্যাপয়েন্টমেন্টে অনুপস্থিতি।'),
    columns: [DOCTOR, col('appointments', 'Appointments', 'অ্যাপয়েন্টমেন্ট'), col('no_shows', 'No-shows', 'অনুপস্থিত'), col('cancelled', 'Cancelled', 'বাতিল'), col('no_show_rate', 'No-show rate', 'অনুপস্থিতির হার', 'percent')],
    chart: { type: 'hbar', x: 'doctor', series: [{ key: 'no_show_rate', label: L('No-show rate', 'অনুপস্থিতির হার') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT u.full_name AS doctor, count(*)::int AS appointments,
          count(*) FILTER (WHERE a.status = 'NO_SHOW')::int AS no_shows,
          count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled
        FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
        WHERE a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} AND a.starts_at < now() ${inChamber(ctx, 'a')} ${byDoctor(ctx, 'a')}
        GROUP BY u.full_name ORDER BY u.full_name`;
      for (const r of rows) r.no_show_rate = pct(Number(r.no_shows), Number(r.appointments) - Number(r.cancelled));
      const total = sum(rows, 'appointments') - sum(rows, 'cancelled');
      return { rows, summary: [{ label: L('Overall no-show rate', 'মোট অনুপস্থিতির হার'), value: pct(sum(rows, 'no_shows'), total), type: 'percent' }] };
    },
  },
  {
    key: 'patient-registrations',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    title: L('Patient registrations', 'রোগী নিবন্ধন'),
    description: L('New patients registered per day.', 'প্রতিদিন নিবন্ধিত নতুন রোগী।'),
    columns: [DATE, col('registered', 'New patients', 'নতুন রোগী'), col('male', 'Male', 'পুরুষ'), col('female', 'Female', 'মহিলা'), col('other', 'Other / undisclosed', 'অন্যান্য')],
    chart: { type: 'column', x: 'date', series: [{ key: 'registered', label: L('New patients', 'নতুন রোগী') }] },
    doctorScoped: false,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        WITH days AS (${days(ctx)}),
        p AS (SELECT ${day(ctx, 'p.created_at')} AS day, p.gender FROM patients p
              WHERE p.deleted_at IS NULL AND p.created_at >= ${ctx.start} AND p.created_at < ${ctx.end} ${inChamber(ctx, 'p')})
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date, count(p.day)::int AS registered,
          count(*) FILTER (WHERE p.gender = 'MALE')::int AS male,
          count(*) FILTER (WHERE p.gender = 'FEMALE')::int AS female,
          count(*) FILTER (WHERE p.gender IN ('OTHER', 'UNDISCLOSED'))::int AS other
        FROM days LEFT JOIN p ON p.day = days.day GROUP BY days.day ORDER BY days.day`;
      return { rows, summary: [{ label: L('New patients', 'নতুন রোগী'), value: sum(rows, 'registered'), type: 'number' }] };
    },
  },
  {
    key: 'queue-stats',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    title: L('Queue & waiting time', 'কিউ ও অপেক্ষার সময়'),
    description: L('Check-ins, patients seen, waiting and consultation times per day.', 'প্রতিদিনের চেক-ইন, দেখা রোগী, অপেক্ষা ও পরামর্শের সময়।'),
    columns: [
      DATE,
      col('checked_in', 'Checked in', 'চেক-ইন'),
      col('seen', 'Seen by doctor', 'ডাক্তার দেখেছেন'),
      col('avg_wait', 'Avg wait', 'গড় অপেক্ষা', 'minutes'),
      col('max_wait', 'Longest wait', 'সর্বোচ্চ অপেক্ষা', 'minutes'),
      col('avg_consult', 'Avg consultation', 'গড় পরামর্শ', 'minutes'),
    ],
    chart: { type: 'line', x: 'date', series: [{ key: 'avg_wait', label: L('Average wait (min)', 'গড় অপেক্ষা (মিনিট)') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        WITH days AS (${days(ctx)}),
        a AS (SELECT ${day(ctx, 'a.starts_at')} AS day, a.checked_in_at, a.started_at,
                extract(epoch FROM a.started_at - coalesce(a.queued_at, a.checked_in_at)) / 60 AS wait,
                extract(epoch FROM a.completed_at - a.started_at) / 60 AS consult
              FROM appointments a
              WHERE a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} AND a.checked_in_at IS NOT NULL ${inChamber(ctx, 'a')} ${byDoctor(ctx, 'a')})
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date, count(a.checked_in_at)::int AS checked_in, count(a.started_at)::int AS seen,
          round(avg(a.wait) FILTER (WHERE a.wait >= 0)::numeric, 1)::float8 AS avg_wait,
          round(max(a.wait) FILTER (WHERE a.wait >= 0)::numeric, 1)::float8 AS max_wait,
          round(avg(a.consult) FILTER (WHERE a.consult >= 0 AND a.consult < 720)::numeric, 1)::float8 AS avg_consult
        FROM days LEFT JOIN a ON a.day = days.day GROUP BY days.day ORDER BY days.day`;
      const withWait = rows.filter((r) => r.avg_wait !== null);
      const avgWait = withWait.length ? withWait.reduce((s, r) => s + Number(r.avg_wait) * Number(r.seen), 0) / Math.max(1, sum(withWait, 'seen')) : null;
      return {
        rows,
        summary: [
          { label: L('Patients seen', 'দেখা রোগী'), value: sum(rows, 'seen'), type: 'number' },
          { label: L('Average wait', 'গড় অপেক্ষা'), value: round1(avgWait), type: 'minutes' },
        ],
      };
    },
  },
  {
    key: 'patient-list',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    also: [PERMISSIONS.PATIENTS_VIEW],
    title: L('Patient list', 'রোগীর তালিকা'),
    description: L('Patients registered in the period (demographics only).', 'এই সময়ে নিবন্ধিত রোগী (শুধু সাধারণ তথ্য)।'),
    columns: [CODE, col('name', 'Name', 'নাম', 'text'), col('gender', 'Gender', 'লিঙ্গ', 'text', GENDER), col('age', 'Age', 'বয়স'), col('phone', 'Phone', 'ফোন', 'text'), col('registered', 'Registered', 'নিবন্ধন', 'date')],
    doctorScoped: false,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT p.patient_code, p.full_name AS name, p.gender::text AS gender,
          CASE WHEN p.date_of_birth IS NULL THEN NULL ELSE date_part('year', age(${ctx.today}::date, p.date_of_birth))::int END AS age,
          p.phone, to_char(${day(ctx, 'p.created_at')}, 'YYYY-MM-DD') AS registered
        FROM patients p WHERE p.deleted_at IS NULL AND p.created_at >= ${ctx.start} AND p.created_at < ${ctx.end} ${inChamber(ctx, 'p')}
        ORDER BY p.created_at LIMIT ${ROW_LIMIT + 1}`;
      return { rows, summary: [{ label: L('Patients', 'রোগী'), value: Math.min(rows.length, ROW_LIMIT), type: 'number' }] };
    },
  },
  {
    key: 'appointment-list',
    group: 'operational',
    permission: PERMISSIONS.REPORTS_VIEW,
    title: L('Appointment list', 'অ্যাপয়েন্টমেন্টের তালিকা'),
    description: L('Every appointment in the period with its status.', 'এই সময়ের সব অ্যাপয়েন্টমেন্ট ও অবস্থা।'),
    columns: [
      col('starts_at', 'Date & time', 'তারিখ ও সময়', 'datetime'),
      col('token', 'Token', 'টোকেন', 'text'),
      CODE,
      PATIENT,
      DOCTOR,
      col('visit_type', 'Visit', 'ভিজিট', 'text', VISIT),
      col('status', 'Status', 'অবস্থা', 'text', APPT_STATUS),
    ],
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT a.starts_at::text AS starts_at, t.label AS token, p.patient_code, p.full_name AS patient, u.full_name AS doctor, a.visit_type::text AS visit_type, a.status::text AS status
        FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
        LEFT JOIN queue_tokens t ON t.appointment_id = a.id
        WHERE a.starts_at >= ${ctx.start} AND a.starts_at < ${ctx.end} ${inChamber(ctx, 'a')} ${byDoctor(ctx, 'a')}
        ORDER BY a.starts_at LIMIT ${ROW_LIMIT + 1}`;
      for (const r of rows) r.starts_at = r.starts_at ? new Date(String(r.starts_at)).toISOString() : null;
      return { rows, summary: [{ label: L('Appointments', 'অ্যাপয়েন্টমেন্ট'), value: Math.min(rows.length, ROW_LIMIT), type: 'number' }] };
    },
  },

  // ── Clinical (reports.clinical) ──
  {
    key: 'patients-seen',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Patients seen — new vs returning', 'দেখা রোগী — নতুন বনাম পুরনো'),
    description: L('Finalized consultations per day, split into first and repeat visits.', 'প্রতিদিনের চূড়ান্ত পরামর্শ — প্রথম ও পুনরায় ভিজিট।'),
    columns: [DATE, col('patients', 'Patients', 'রোগী'), col('new', 'New', 'নতুন'), col('returning', 'Returning', 'পুরনো')],
    chart: { type: 'stacked', x: 'date', series: [{ key: 'new', label: L('New', 'নতুন') }, { key: 'returning', label: L('Returning', 'পুরনো') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        WITH days AS (${days(ctx)}),
        c AS (SELECT ${day(ctx, 'c.finalized_at')} AS day, c.patient_id, c.visit_number FROM consultations c
              WHERE c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end} ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')})
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date, count(DISTINCT c.patient_id)::int AS patients,
          count(*) FILTER (WHERE c.visit_number = 1)::int AS new, count(*) FILTER (WHERE c.visit_number > 1)::int AS returning
        FROM days LEFT JOIN c ON c.day = days.day GROUP BY days.day ORDER BY days.day`;
      const n = sum(rows, 'new');
      const r = sum(rows, 'returning');
      return {
        rows,
        summary: [
          { label: L('Visits', 'ভিজিট'), value: n + r, type: 'number' },
          { label: L('New patients', 'নতুন রোগী'), value: n, type: 'number' },
          { label: L('Returning share', 'পুরনো রোগীর অংশ'), value: pct(r, n + r), type: 'percent' },
        ],
      };
    },
  },
  {
    key: 'consultations-daily',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Consultations by day', 'দিনভিত্তিক পরামর্শ'),
    description: L('Finalized consultations and their average duration.', 'চূড়ান্ত পরামর্শ ও গড় সময়।'),
    columns: [DATE, col('consultations', 'Consultations', 'পরামর্শ'), col('avg_duration', 'Avg duration', 'গড় সময়', 'minutes'), col('with_follow_up', 'With follow-up', 'ফলো-আপ সহ')],
    chart: { type: 'column', x: 'date', series: [{ key: 'consultations', label: L('Consultations', 'পরামর্শ') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        WITH days AS (${days(ctx)}),
        c AS (SELECT ${day(ctx, 'c.finalized_at')} AS day, extract(epoch FROM c.finalized_at - c.started_at) / 60 AS mins, c.follow_up_date FROM consultations c
              WHERE c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end} ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')})
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date, count(c.day)::int AS consultations,
          round(avg(c.mins) FILTER (WHERE c.mins >= 0 AND c.mins < 720)::numeric, 1)::float8 AS avg_duration,
          count(c.follow_up_date)::int AS with_follow_up
        FROM days LEFT JOIN c ON c.day = days.day GROUP BY days.day ORDER BY days.day`;
      return { rows, summary: [{ label: L('Consultations', 'পরামর্শ'), value: sum(rows, 'consultations'), type: 'number' }] };
    },
  },
  {
    key: 'diagnosis-stats',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Top diagnoses', 'শীর্ষ রোগনির্ণয়'),
    description: L('Most frequent diagnoses in finalized consultations.', 'চূড়ান্ত পরামর্শে সবচেয়ে বেশি রোগনির্ণয়।'),
    columns: [col('diagnosis', 'Diagnosis', 'রোগনির্ণয়', 'text'), col('code', 'ICD-10', 'আইসিডি-১০', 'text'), col('count', 'Times diagnosed', 'বার'), col('patients', 'Patients', 'রোগী'), col('share', 'Share of visits', 'ভিজিটের অংশ', 'percent')],
    chart: { type: 'hbar', x: 'diagnosis', series: [{ key: 'count', label: L('Times diagnosed', 'বার') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const [rows, totals] = await Promise.all([
        db.$queryRaw<Row[]>`
          SELECT min(cd.name) AS diagnosis, upper(cd.code) AS code, count(*)::int AS count, count(DISTINCT c.patient_id)::int AS patients
          FROM consultation_diagnoses cd JOIN consultations c ON c.id = cd.consultation_id
          WHERE c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end} ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')}
          GROUP BY lower(cd.name), upper(cd.code) ORDER BY count(*) DESC, min(cd.name) LIMIT 100`,
        db.$queryRaw<{ visits: number }[]>`
          SELECT count(*)::int AS visits FROM consultations c
          WHERE c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end} ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')}`,
      ]);
      const visits = totals[0]?.visits ?? 0;
      for (const r of rows) r.share = pct(Number(r.count), visits);
      return {
        rows,
        summary: [
          { label: L('Consultations', 'পরামর্শ'), value: visits, type: 'number' },
          { label: L('Distinct diagnoses', 'ভিন্ন রোগনির্ণয়'), value: rows.length, type: 'number' },
        ],
      };
    },
  },
  {
    key: 'prescription-stats',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Prescription statistics', 'প্রেসক্রিপশন পরিসংখ্যান'),
    description: L('Prescriptions issued, revisions and the most prescribed medicines.', 'ইস্যু করা প্রেসক্রিপশন, সংশোধন ও সর্বাধিক দেওয়া ওষুধ।'),
    columns: [col('medicine', 'Medicine', 'ওষুধ', 'text'), col('strength', 'Strength', 'শক্তি', 'text'), col('times', 'Times prescribed', 'বার'), col('patients', 'Patients', 'রোগী')],
    chart: { type: 'hbar', x: 'medicine', series: [{ key: 'times', label: L('Times prescribed', 'বার') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const [rows, stats, revisions] = await Promise.all([
        db.$queryRaw<Row[]>`
          SELECT min(i.name) AS medicine, min(i.strength) AS strength, count(*)::int AS times, count(DISTINCT p.patient_id)::int AS patients
          FROM prescription_items i JOIN prescription_versions v ON v.id = i.version_id AND v.status = 'FINALIZED'
          JOIN prescriptions p ON p.id = v.prescription_id
          WHERE p.issued_at >= ${ctx.start} AND p.issued_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'p')}
          GROUP BY lower(i.name), lower(coalesce(i.strength, '')) ORDER BY count(*) DESC, min(i.name) LIMIT 100`,
        db.$queryRaw<{ issued: number; items: number; empty: number }[]>`
          SELECT count(*)::int AS issued, coalesce(sum(n), 0)::int AS items, count(*) FILTER (WHERE n = 0)::int AS empty FROM (
            SELECT p.id, (SELECT count(*) FROM prescription_items i JOIN prescription_versions v ON v.id = i.version_id WHERE v.prescription_id = p.id AND v.status = 'FINALIZED') AS n
            FROM prescriptions p WHERE p.status IN ('FINALIZED', 'REVISED') AND p.issued_at >= ${ctx.start} AND p.issued_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'p')}) x`,
        db.$queryRaw<{ revisions: number }[]>`
          SELECT count(*)::int AS revisions FROM prescription_versions v JOIN prescriptions p ON p.id = v.prescription_id
          WHERE v.version_number > 1 AND v.status IN ('FINALIZED', 'SUPERSEDED') AND v.finalized_at >= ${ctx.start} AND v.finalized_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'p')}`,
      ]);
      const s = stats[0] ?? { issued: 0, items: 0, empty: 0 };
      return {
        rows,
        summary: [
          { label: L('Prescriptions issued', 'ইস্যু করা প্রেসক্রিপশন'), value: s.issued, type: 'number' },
          { label: L('Revisions', 'সংশোধন'), value: revisions[0]?.revisions ?? 0, type: 'number' },
          { label: L('Medicines per prescription', 'প্রতি প্রেসক্রিপশনে ওষুধ'), value: s.issued ? round1(s.items / s.issued) : null, type: 'number' },
          { label: L('Without medicines', 'ওষুধ ছাড়া'), value: s.empty, type: 'number' },
        ],
      };
    },
  },
  {
    key: 'follow-up-stats',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Follow-ups', 'ফলো-আপ'),
    description: L('Follow-ups due in the period and whether the patient came back.', 'এই সময়ে নির্ধারিত ফলো-আপ ও রোগী ফিরেছেন কিনা।'),
    columns: [col('follow_up_date', 'Follow-up date', 'ফলো-আপের তারিখ', 'date'), CODE, PATIENT, DOCTOR, col('status', 'Status', 'অবস্থা', 'text', FU_STATUS)],
    doctorScoped: true,
    async run(db, ctx) {
      // "Returned": the patient had a later visit (consultation started) from 3 days before the follow-up date onwards.
      const rows = await db.$queryRaw<Row[]>`
        SELECT to_char(c.follow_up_date, 'YYYY-MM-DD') AS follow_up_date, p.patient_code, p.full_name AS patient, u.full_name AS doctor,
          CASE WHEN EXISTS (SELECT 1 FROM consultations c2 WHERE c2.patient_id = c.patient_id AND c2.status <> 'CANCELLED'
                            AND c2.started_at > c.started_at AND ${day(ctx, 'c2.started_at')} >= c.follow_up_date - 3) THEN 'returned'
               WHEN c.follow_up_date < ${ctx.today}::date THEN 'overdue' ELSE 'upcoming' END AS status
        FROM consultations c JOIN patients p ON p.id = c.patient_id JOIN doctors d ON d.id = c.doctor_id JOIN users u ON u.id = d.user_id
        WHERE c.status = 'FINALIZED' AND c.follow_up_date >= ${ctx.from}::date AND c.follow_up_date <= ${ctx.to}::date ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')}
        ORDER BY c.follow_up_date, p.full_name LIMIT ${ROW_LIMIT + 1}`;
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      return {
        rows,
        summary: [
          { label: L('Scheduled', 'নির্ধারিত'), value: rows.length, type: 'number' },
          { label: L('Returned', 'ফিরেছেন'), value: count('returned'), type: 'number' },
          { label: L('Overdue', 'মেয়াদোত্তীর্ণ'), value: count('overdue'), type: 'number' },
          { label: L('Return rate', 'ফেরার হার'), value: pct(count('returned'), count('returned') + count('overdue')), type: 'percent' },
        ],
      };
    },
  },
  {
    key: 'doctor-activity',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    title: L('Doctor activity', 'ডাক্তারের কার্যক্রম'),
    description: L('Consultations, patients, prescriptions and revisions per doctor.', 'প্রত্যেক ডাক্তারের পরামর্শ, রোগী, প্রেসক্রিপশন ও সংশোধন।'),
    columns: [
      DOCTOR,
      col('consultations', 'Consultations', 'পরামর্শ'),
      col('patients', 'Patients', 'রোগী'),
      col('new_patients', 'New patients', 'নতুন রোগী'),
      col('prescriptions', 'Prescriptions', 'প্রেসক্রিপশন'),
      col('revisions', 'Revisions', 'সংশোধন'),
      col('avg_duration', 'Avg consultation', 'গড় পরামর্শ', 'minutes'),
      col('follow_ups', 'Follow-ups set', 'ফলো-আপ'),
    ],
    chart: { type: 'hbar', x: 'doctor', series: [{ key: 'consultations', label: L('Consultations', 'পরামর্শ') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT u.full_name AS doctor,
          count(c.id)::int AS consultations, count(DISTINCT c.patient_id)::int AS patients,
          count(c.id) FILTER (WHERE c.visit_number = 1)::int AS new_patients,
          (SELECT count(*) FROM prescriptions p WHERE p.doctor_id = d.id AND p.issued_at >= ${ctx.start} AND p.issued_at < ${ctx.end})::int AS prescriptions,
          (SELECT count(*) FROM prescription_versions v JOIN prescriptions p ON p.id = v.prescription_id
            WHERE p.doctor_id = d.id AND v.version_number > 1 AND v.status IN ('FINALIZED', 'SUPERSEDED') AND v.finalized_at >= ${ctx.start} AND v.finalized_at < ${ctx.end})::int AS revisions,
          round(avg(extract(epoch FROM c.finalized_at - c.started_at) / 60) FILTER (WHERE c.finalized_at - c.started_at < interval '12 hours')::numeric, 1)::float8 AS avg_duration,
          count(c.follow_up_date)::int AS follow_ups
        FROM doctors d JOIN users u ON u.id = d.user_id
        LEFT JOIN consultations c ON c.doctor_id = d.id AND c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end}
        WHERE true ${inChamber(ctx, 'd')} ${ctx.doctorId ? Prisma.sql`AND d.id = ${ctx.doctorId}::uuid` : Prisma.empty}
        GROUP BY d.id, u.full_name ORDER BY count(c.id) DESC, u.full_name`;
      return { rows: rows.filter((r) => Number(r.consultations) > 0 || Number(r.prescriptions) > 0 || ctx.doctorId), summary: [{ label: L('Consultations', 'পরামর্শ'), value: sum(rows, 'consultations'), type: 'number' }] };
    },
  },
  {
    key: 'consultation-list',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    also: [PERMISSIONS.CONSULTATIONS_VIEW],
    title: L('Consultation register', 'পরামর্শের রেজিস্টার'),
    description: L('Finalized consultations with primary diagnosis and follow-up.', 'প্রধান রোগনির্ণয় ও ফলো-আপসহ চূড়ান্ত পরামর্শ।'),
    columns: [col('finalized_at', 'Date & time', 'তারিখ ও সময়', 'datetime'), CODE, PATIENT, DOCTOR, col('visit', 'Visit #', 'ভিজিট #'), col('diagnosis', 'Primary diagnosis', 'প্রধান রোগনির্ণয়', 'text'), col('investigations', 'Investigations', 'পরীক্ষা'), col('follow_up', 'Follow-up', 'ফলো-আপ', 'date')],
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT c.finalized_at::text AS finalized_at, p.patient_code, p.full_name AS patient, u.full_name AS doctor, c.visit_number AS visit,
          (SELECT cd.name FROM consultation_diagnoses cd WHERE cd.consultation_id = c.id ORDER BY cd.is_primary DESC, cd.sort_order LIMIT 1) AS diagnosis,
          (SELECT count(*) FROM consultation_investigations ci WHERE ci.consultation_id = c.id)::int AS investigations,
          to_char(c.follow_up_date, 'YYYY-MM-DD') AS follow_up
        FROM consultations c JOIN patients p ON p.id = c.patient_id JOIN doctors d ON d.id = c.doctor_id JOIN users u ON u.id = d.user_id
        WHERE c.status = 'FINALIZED' AND c.finalized_at >= ${ctx.start} AND c.finalized_at < ${ctx.end} ${inChamber(ctx, 'c')} ${byDoctor(ctx, 'c')}
        ORDER BY c.finalized_at LIMIT ${ROW_LIMIT + 1}`;
      for (const r of rows) r.finalized_at = r.finalized_at ? new Date(String(r.finalized_at)).toISOString() : null;
      return { rows, summary: [{ label: L('Consultations', 'পরামর্শ'), value: Math.min(rows.length, ROW_LIMIT), type: 'number' }] };
    },
  },
  {
    key: 'prescription-history',
    group: 'clinical',
    permission: PERMISSIONS.REPORTS_CLINICAL,
    also: [PERMISSIONS.PRESCRIPTIONS_VIEW],
    title: L('Prescription history', 'প্রেসক্রিপশনের ইতিহাস'),
    description: L('Issued prescriptions with their current medicines.', 'ইস্যু করা প্রেসক্রিপশন ও বর্তমান ওষুধ।'),
    columns: [col('issued_at', 'Issued', 'ইস্যু', 'datetime'), col('rx_number', 'Rx number', 'Rx নম্বর', 'text'), col('version', 'Version', 'সংস্করণ'), CODE, PATIENT, DOCTOR, col('medicines', 'Medicines', 'ওষুধ', 'text'), col('status', 'Status', 'অবস্থা', 'text', RX_STATUS)],
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT p.issued_at::text AS issued_at, p.rx_number, p.current_version AS version, pa.patient_code, pa.full_name AS patient, u.full_name AS doctor,
          (SELECT string_agg(concat_ws(' ', i.name, i.strength, i.frequency), '; ' ORDER BY i.sort_order) FROM prescription_items i
            JOIN prescription_versions v ON v.id = i.version_id WHERE v.prescription_id = p.id AND v.status = 'FINALIZED') AS medicines,
          p.status::text AS status
        FROM prescriptions p JOIN patients pa ON pa.id = p.patient_id JOIN doctors d ON d.id = p.doctor_id JOIN users u ON u.id = d.user_id
        WHERE p.status IN ('FINALIZED', 'REVISED') AND p.issued_at >= ${ctx.start} AND p.issued_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'p')}
        ORDER BY p.issued_at LIMIT ${ROW_LIMIT + 1}`;
      for (const r of rows) r.issued_at = r.issued_at ? new Date(String(r.issued_at)).toISOString() : null;
      return { rows, summary: [{ label: L('Prescriptions', 'প্রেসক্রিপশন'), value: Math.min(rows.length, ROW_LIMIT), type: 'number' }] };
    },
  },

  // ── Financial (reports.financial) ──
  {
    key: 'revenue-daily',
    group: 'financial',
    permission: PERMISSIONS.REPORTS_FINANCIAL,
    title: L('Daily revenue', 'দৈনিক আয়'),
    description: L('Billed, discounts, collected and refunded per day.', 'প্রতিদিনের বিল, ছাড়, আদায় ও ফেরত।'),
    columns: [DATE, col('bills', 'Bills', 'বিল'), col('billed', 'Billed', 'বিল (টাকা)', 'money'), col('discounts', 'Discounts', 'ছাড়', 'money'), col('collected', 'Collected (net)', 'আদায় (নিট)', 'money'), col('refunds', 'Refunds', 'ফেরত', 'money')],
    chart: { type: 'line', x: 'date', series: [{ key: 'collected', label: L('Collected', 'আদায়') }] },
    doctorScoped: true,
    run: (db, ctx) => revenue(db, ctx, 'day'),
  },
  {
    key: 'revenue-monthly',
    group: 'financial',
    permission: PERMISSIONS.REPORTS_FINANCIAL,
    title: L('Monthly revenue', 'মাসিক আয়'),
    description: L('Revenue grouped by calendar month.', 'মাসভিত্তিক আয়।'),
    columns: [col('date', 'Month', 'মাস', 'text'), col('bills', 'Bills', 'বিল'), col('billed', 'Billed', 'বিল (টাকা)', 'money'), col('discounts', 'Discounts', 'ছাড়', 'money'), col('collected', 'Collected (net)', 'আদায় (নিট)', 'money'), col('refunds', 'Refunds', 'ফেরত', 'money')],
    chart: { type: 'column', x: 'date', series: [{ key: 'collected', label: L('Collected', 'আদায়') }] },
    doctorScoped: true,
    run: (db, ctx) => revenue(db, ctx, 'month'),
  },
  {
    key: 'revenue-by-doctor',
    group: 'financial',
    permission: PERMISSIONS.REPORTS_FINANCIAL,
    title: L('Revenue by doctor', 'ডাক্তারভিত্তিক আয়'),
    description: L('Bills issued in the period per doctor, with what is still due.', 'এই সময়ে প্রত্যেক ডাক্তারের বিল ও বকেয়া।'),
    columns: [DOCTOR, col('bills', 'Bills', 'বিল'), col('billed', 'Billed', 'বিল (টাকা)', 'money'), col('discounts', 'Discounts', 'ছাড়', 'money'), col('paid', 'Paid', 'পরিশোধিত', 'money'), col('due', 'Due', 'বকেয়া', 'money')],
    chart: { type: 'hbar', x: 'doctor', series: [{ key: 'billed', label: L('Billed', 'বিল') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT coalesce(u.full_name, '—') AS doctor, count(*)::int AS bills, sum(i.total)::float8 AS billed, sum(i.discount_amount)::float8 AS discounts,
          sum(i.paid_amount)::float8 AS paid, sum(i.due_amount)::float8 AS due
        FROM invoices i LEFT JOIN doctors d ON d.id = i.doctor_id LEFT JOIN users u ON u.id = d.user_id
        WHERE i.status <> 'VOID' AND i.issued_at >= ${ctx.start} AND i.issued_at < ${ctx.end} ${inChamber(ctx, 'i')} ${byDoctor(ctx, 'i')}
        GROUP BY u.full_name ORDER BY sum(i.total) DESC`;
      return {
        rows,
        summary: [
          { label: L('Billed', 'বিল'), value: money2(sum(rows, 'billed')), type: 'money' },
          { label: L('Due', 'বকেয়া'), value: money2(sum(rows, 'due')), type: 'money' },
        ],
      };
    },
  },
  {
    key: 'payment-methods',
    group: 'financial',
    permission: PERMISSIONS.REPORTS_FINANCIAL,
    title: L('Payment methods', 'পেমেন্ট পদ্ধতি'),
    description: L('Money received by payment method (net of refunds).', 'পেমেন্ট পদ্ধতি অনুযায়ী আদায় (ফেরত বাদে)।'),
    columns: [col('method', 'Method', 'পদ্ধতি', 'text', METHOD), col('payments', 'Payments', 'পেমেন্ট'), col('amount', 'Amount (net)', 'টাকা (নিট)', 'money'), col('share', 'Share', 'অংশ', 'percent')],
    chart: { type: 'hbar', x: 'method', series: [{ key: 'amount', label: L('Amount', 'টাকা') }] },
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT p.method::text AS method, count(*) FILTER (WHERE p.kind = 'PAYMENT')::int AS payments,
          sum(CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END)::float8 AS amount
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.received_at >= ${ctx.start} AND p.received_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'i')}
        GROUP BY p.method ORDER BY 3 DESC`;
      const total = sum(rows, 'amount');
      for (const r of rows) r.share = pct(Number(r.amount), total);
      return { rows, summary: [{ label: L('Collected (net)', 'আদায় (নিট)'), value: money2(total), type: 'money' }] };
    },
  },
  {
    key: 'outstanding-dues',
    group: 'financial',
    permission: PERMISSIONS.REPORTS_FINANCIAL,
    title: L('Outstanding dues', 'বকেয়া'),
    description: L('All open bills right now, oldest first.', 'এই মুহূর্তের সব খোলা বিল, পুরনোটা আগে।'),
    columns: [
      col('issued', 'Issued', 'ইস্যু', 'date'),
      col('invoice_number', 'Bill no.', 'বিল নং', 'text'),
      CODE,
      PATIENT,
      col('phone', 'Phone', 'ফোন', 'text'),
      DOCTOR,
      col('total', 'Total', 'মোট', 'money'),
      col('paid', 'Paid', 'পরিশোধিত', 'money'),
      col('due', 'Due', 'বকেয়া', 'money'),
      col('age_days', 'Days open', 'দিন', 'number'),
      col('status', 'Status', 'অবস্থা', 'text', INV_STATUS),
    ],
    ignoresRange: true,
    doctorScoped: true,
    async run(db, ctx) {
      const rows = await db.$queryRaw<Row[]>`
        SELECT to_char(${day(ctx, 'i.issued_at')}, 'YYYY-MM-DD') AS issued, i.invoice_number, p.patient_code, p.full_name AS patient, p.phone, u.full_name AS doctor,
          i.total::float8 AS total, i.paid_amount::float8 AS paid, i.due_amount::float8 AS due,
          (${ctx.today}::date - ${day(ctx, 'i.issued_at')})::int AS age_days, i.status::text AS status
        FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN doctors d ON d.id = i.doctor_id LEFT JOIN users u ON u.id = d.user_id
        WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID') ${inChamber(ctx, 'i')} ${byDoctor(ctx, 'i')}
        ORDER BY i.issued_at LIMIT ${ROW_LIMIT + 1}`;
      return {
        rows,
        summary: [
          { label: L('Open bills', 'খোলা বিল'), value: Math.min(rows.length, ROW_LIMIT), type: 'number' },
          { label: L('Total due', 'মোট বকেয়া'), value: money2(sum(rows, 'due')), type: 'money' },
          { label: L('Over 30 days', '৩০ দিনের বেশি'), value: money2(sum(rows.filter((r) => Number(r.age_days) > 30), 'due')), type: 'money' },
        ],
      };
    },
  },
];

async function revenue(db: PrismaClient, ctx: ReportContext, unit: 'day' | 'month'): Promise<ReportOutput> {
  const bucket = (c: string) => (unit === 'day' ? day(ctx, c) : Prisma.sql`date_trunc('month', ${day(ctx, c)})::date`);
  const series =
    unit === 'day'
      ? days(ctx)
      : Prisma.sql`SELECT d::date AS day FROM generate_series(date_trunc('month', ${ctx.from}::date), ${ctx.to}::date, interval '1 month') d`;
  const fmt = unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const rows = await db.$queryRaw<Row[]>`
    WITH days AS (${series}),
    inv AS (SELECT ${bucket('i.issued_at')} AS day, count(*) AS bills, sum(i.total) AS billed, sum(i.discount_amount) AS discounts FROM invoices i
            WHERE i.status <> 'VOID' AND i.issued_at >= ${ctx.start} AND i.issued_at < ${ctx.end} ${inChamber(ctx, 'i')} ${byDoctor(ctx, 'i')} GROUP BY 1),
    pay AS (SELECT ${bucket('p.received_at')} AS day,
              sum(CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END) AS collected,
              sum(CASE WHEN p.kind = 'REFUND' THEN p.amount ELSE 0 END) AS refunds
            FROM payments p JOIN invoices i ON i.id = p.invoice_id
            WHERE p.received_at >= ${ctx.start} AND p.received_at < ${ctx.end} ${inChamber(ctx, 'p')} ${byDoctor(ctx, 'i')} GROUP BY 1)
    SELECT to_char(days.day, ${fmt}) AS date, coalesce(inv.bills, 0)::int AS bills, coalesce(inv.billed, 0)::float8 AS billed,
      coalesce(inv.discounts, 0)::float8 AS discounts, coalesce(pay.collected, 0)::float8 AS collected, coalesce(pay.refunds, 0)::float8 AS refunds
    FROM days LEFT JOIN inv ON inv.day = days.day LEFT JOIN pay ON pay.day = days.day ORDER BY days.day`;
  return {
    rows,
    summary: [
      { label: L('Billed', 'বিল'), value: money2(sum(rows, 'billed')), type: 'money' },
      { label: L('Collected (net)', 'আদায় (নিট)'), value: money2(sum(rows, 'collected')), type: 'money' },
      { label: L('Discounts', 'ছাড়'), value: money2(sum(rows, 'discounts')), type: 'money' },
      { label: L('Refunds', 'ফেরত'), value: money2(sum(rows, 'refunds')), type: 'money' },
    ],
  };
}

export const REPORTS_BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

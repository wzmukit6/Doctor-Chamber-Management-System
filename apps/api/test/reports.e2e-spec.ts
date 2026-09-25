import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { addDays, REPORT_KEYS, zonedDate } from '@chamber/shared';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

const TZ = 'Asia/Dhaka';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Phase 7 — reports, exports, analytics and administration settings (spec §19, §33, §34, §59). */
describe('Reports & administration (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let superAdmin: Session;
  let manager: Session;
  let doctor: Session;
  let assistant: Session;
  let doctorB: Session;
  const today = zonedDate(new Date(), TZ);
  const range = `from=${addDays(today, -30)}&to=${addDays(today, 1)}`;

  beforeAll(async () => {
    app = await createTestApp();
    [superAdmin, manager, doctor, assistant, doctorB] = await Promise.all([
      login(app, DEMO_USERS.superAdmin),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.doctorB),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('reports', () => {
    it('manager runs every report in their chamber', async () => {
      const catalog = (await manager.get('/api/reports')).body.data;
      expect(catalog.map((r: { key: string }) => r.key).sort()).toEqual([...REPORT_KEYS].sort());
      for (const key of REPORT_KEYS) {
        const res = await manager.get(`/api/reports/${key}?${range}`);
        expect({ key, status: res.status }).toEqual({ key, status: 200 });
        expect(res.body.data.params).toMatchObject({ scope: 'chamber', chamberName: 'Demo Chamber — Dhanmondi' });
        expect(res.body.data.columns.length).toBeGreaterThan(0);
      }
    });

    it('produces correct numbers from the demo data', async () => {
      const appts = (await manager.get(`/api/reports/appointments-daily?${range}`)).body.data;
      expect(appts.rows).toHaveLength(32); // one row per day, zero-filled
      const todayRow = appts.rows.find((r: { date: string }) => r.date === today);
      expect(todayRow.total).toBeGreaterThan(0);
      const dues = (await manager.get(`/api/reports/outstanding-dues?${range}`)).body.data;
      expect(dues.ignoresRange).toBe(true);
      const dbDue = await prisma.invoice.aggregate({ _sum: { dueAmount: true }, where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, chamber: { name: 'Demo Chamber — Dhanmondi' } } });
      expect(dues.summary.find((s: { label: { en: string } }) => s.label.en === 'Total due').value).toBeCloseTo(Number(dbDue._sum.dueAmount ?? 0), 2);
      const dx = (await manager.get(`/api/reports/diagnosis-stats?${range}`)).body.data;
      expect(dx.rows.length).toBeGreaterThan(0);
      expect(dx.chart).toMatchObject({ type: 'hbar', x: 'diagnosis' });
    });

    it('doctors get personal reports; no financial reports', async () => {
      const catalog = (await doctor.get('/api/reports')).body.data;
      expect(catalog.every((r: { group: string }) => r.group !== 'financial')).toBe(true);
      expect(catalog.find((r: { key: string }) => r.key === 'doctor-activity').personal).toBe(true);
      const act = (await doctor.get(`/api/reports/doctor-activity?${range}`)).body.data;
      expect(act.params.scope).toBe('doctor');
      expect(act.rows.map((r: { doctor: string }) => r.doctor)).toEqual(['Dr. Demo Rahman']);
      // A doctor cannot widen the scope to a colleague.
      const other = await prisma.doctor.findFirst({ where: { user: { email: { not: DEMO_USERS.doctor } }, chamber: { name: 'Demo Chamber — Dhanmondi' } } });
      if (other) expect((await doctor.get(`/api/reports/doctor-activity?${range}&doctorId=${other.id}`)).body.data.rows.map((r: { doctor: string }) => r.doctor)).toEqual(['Dr. Demo Rahman']);
      expect((await doctor.get(`/api/reports/revenue-daily?${range}`)).status).toBe(403);
    });

    it('assistants get operational reports only and cannot export', async () => {
      const keys = (await assistant.get('/api/reports')).body.data.map((r: { key: string }) => r.key);
      expect(keys).toEqual(expect.arrayContaining(['appointments-daily', 'patient-registrations', 'queue-stats']));
      expect(keys).not.toContain('diagnosis-stats');
      expect(keys).not.toContain('revenue-daily');
      expect((await assistant.get(`/api/reports/diagnosis-stats?${range}`)).status).toBe(403);
      expect((await assistant.get(`/api/reports/appointments-daily/export?${range}&format=csv`)).status).toBe(403);
    });

    it('tenant isolation: another chamber sees only its own data; super admin sees the platform', async () => {
      const a = (await manager.get(`/api/reports/patient-list?${range}`)).body.data.rows.map((r: { patient_code: string }) => r.patient_code);
      const b = (await doctorB.get(`/api/reports/patient-registrations?${range}`)).body.data;
      expect(b.params.chamberName).toBe('Demo Chamber — Uttara');
      expect(a.every((c: string) => c.startsWith('DHN-'))).toBe(true);
      const platform = (await superAdmin.get(`/api/reports/patient-registrations?${range}`)).body.data;
      expect(platform.params).toMatchObject({ scope: 'platform', chamberName: null });
      const total = (r: { rows: { registered: number }[] }) => r.rows.reduce((s, x) => s + x.registered, 0);
      const mine = (await manager.get(`/api/reports/patient-registrations?${range}`)).body.data;
      expect(total(platform)).toBeGreaterThanOrEqual(total(mine) + total(b));
    });

    it('validates the period and unknown reports', async () => {
      expect((await manager.get(`/api/reports/appointments-daily?from=${today}&to=${addDays(today, -1)}`)).status).toBe(422);
      expect((await manager.get(`/api/reports/appointments-daily?from=2024-01-01&to=${today}`)).status).toBe(422);
      expect((await manager.get(`/api/reports/nope?${range}`)).status).toBe(404);
    });

    it('exports CSV (with BOM) and Excel; exports are audited', async () => {
      const csv = await manager.agent.get(`/api/reports/revenue-daily/export?${range}&format=csv`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('revenue-daily_');
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text.split('\r\n')[0]).toContain('Collected (net)');
      const bn = await manager.agent.get(`/api/reports/payment-methods/export?${range}&format=csv&lang=bn`);
      expect(bn.text).toContain('পদ্ধতি');

      const xlsx = await manager.agent
        .get(`/api/reports/diagnosis-stats/export?${range}&format=xlsx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(xlsx.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.body as never);
      expect(wb.worksheets[0]!.getCell('A1').value).toBe('Top diagnoses');
      const audit = await manager.get('/api/audit-logs?action=report.exported');
      expect(audit.body.data.map((a: { resourceId: string }) => a.resourceId)).toEqual(expect.arrayContaining(['revenue-daily', 'diagnosis-stats', 'payment-methods']));
    });

    it('dashboard analytics follow the same permissions', async () => {
      const m = (await manager.get('/api/reports/dashboard?days=14')).body.data;
      expect(m.appointmentsPerDay).toHaveLength(14);
      expect(m.revenuePerDay).toHaveLength(14);
      expect(m.patientsPerDay).toHaveLength(14); // managers hold reports.clinical (aggregates only)
      expect(m.doctorWorkload).not.toBeNull();
      const d = (await doctor.get('/api/reports/dashboard?days=14')).body.data;
      expect(d.scope).toBe('doctor');
      expect(d.revenuePerDay).toBeNull();
      expect(d.patientsPerDay).toHaveLength(14);
      expect(d.topDiagnoses.length).toBeGreaterThan(0);
      expect(d.doctorWorkload).toBeNull();
      const a = (await assistant.get('/api/reports/dashboard?days=7')).body.data;
      expect(a.topDiagnoses).toBeNull();
      expect(a.revenuePerDay).toBeNull();
    });
  });

  describe('settings', () => {
    it('chamber profile: managers set logo and opening hours; used on prints', async () => {
      const cur = (await manager.get('/api/settings/chamber-profile')).body.data;
      const bad = await manager.put('/api/settings/chamber-profile', { ...cur, logoDataUrl: 'data:text/html;base64,PGgxPg==' });
      expect(bad.status).toBe(422);
      const hours = [{ weekday: 6, open: '17:00', close: '21:00' }, { weekday: 5, closed: true }];
      expect((await manager.put('/api/settings/chamber-profile', { ...cur, openingHours: [{ weekday: 1, open: '21:00', close: '17:00' }] })).status).toBe(422);
      const ok = await manager.put('/api/settings/chamber-profile', { ...cur, logoDataUrl: PNG, tagline: 'Family medicine', openingHours: hours });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ tagline: 'Family medicine', logoDataUrl: PNG });
      expect((await assistant.put('/api/settings/chamber-profile', { ...ok.body.data })).status).toBe(403);
      expect((await assistant.get('/api/settings/chamber-profile')).body.data.logoDataUrl).toBe(PNG);
      const rx = await prisma.prescription.findFirst({ where: { status: { in: ['FINALIZED', 'REVISED'] }, chamber: { name: 'Demo Chamber — Dhanmondi' } } });
      const print = await assistant.get(`/api/prescriptions/${rx!.id}/print`);
      expect(print.body.data.chamber).toMatchObject({ logoDataUrl: PNG, tagline: 'Family medicine' });
      const audit = await manager.get('/api/audit-logs?action=settings.chamber_profile_updated');
      expect(JSON.stringify(audit.body.data[0].newValue)).not.toContain('base64');
    });

    it('doctor profile: own signature and footer; not another doctor', async () => {
      const me = (await doctor.get('/api/auth/me')).body.data;
      const p = (await doctor.get(`/api/doctors/${me.doctorId}/profile`)).body.data;
      expect(p.canEdit).toBe(true);
      const upd = await doctor.put(`/api/doctors/${me.doctorId}/profile`, { ...p, signatureDataUrl: PNG, prescriptionFooter: 'Call 01700-000000 in an emergency', version: p.version });
      expect(upd.status).toBe(200);
      expect(upd.body.data).toMatchObject({ signatureDataUrl: PNG, prescriptionFooter: 'Call 01700-000000 in an emergency' });
      const email = uniqueEmail('rep.doctor');
      await manager.post('/api/users', { fullName: 'Dr. Colleague', email, password: STRONG_PASSWORD, role: 'DOCTOR' });
      const colleague = await prisma.doctor.findFirstOrThrow({ where: { user: { email } } });
      const cp = (await doctor.get(`/api/doctors/${colleague.id}/profile`)).body.data;
      expect(cp.canEdit).toBe(false);
      expect((await doctor.put(`/api/doctors/${colleague.id}/profile`, { ...cp, bio: 'hijack', version: cp.version })).status).toBe(403);
      expect((await manager.put(`/api/doctors/${colleague.id}/profile`, { ...cp, specialty: 'Paediatrics', version: cp.version })).status).toBe(200);
      expect((await doctorB.get(`/api/doctors/${me.doctorId}/profile`)).status).toBe(404);
      const rx = await prisma.prescription.findFirst({ where: { doctorId: me.doctorId, status: { in: ['FINALIZED', 'REVISED'] } } });
      const print = (await doctor.get(`/api/prescriptions/${rx!.id}/print`)).body.data;
      expect(print.doctor).toMatchObject({ signatureDataUrl: PNG, prescriptionFooter: 'Call 01700-000000 in an emergency' });
    });

    it('security policy: super admin only; applied to passwords and lockout', async () => {
      expect((await manager.get('/api/settings/security')).status).toBe(403);
      const cur = (await superAdmin.get('/api/settings/security')).body.data;
      expect(cur).toMatchObject({ passwordMinLength: 10, loginMaxFailedAttempts: 5 });
      const upd = await superAdmin.put('/api/settings/security', { ...cur, passwordMinLength: 16, passwordRequireSymbol: true, loginMaxFailedAttempts: 3 });
      expect(upd.status).toBe(200);
      const policy = await request(app.getHttpServer()).get('/api/auth/password-policy');
      expect(policy.body.data).toMatchObject({ passwordMinLength: 16, passwordRequireSymbol: true });
      const weak = await manager.post('/api/users', { fullName: 'Policy Test', email: uniqueEmail('policy'), password: STRONG_PASSWORD, role: 'ASSISTANT' });
      expect(weak.status).toBe(422);
      expect(weak.body.error.details.map((d: { message: string }) => d.message)).toEqual(expect.arrayContaining(['validation.password.min_length', 'validation.password.symbol']));
      expect((await manager.post('/api/users', { fullName: 'Policy Test', email: uniqueEmail('policy'), password: 'Str0ng!Passw0rd-XY', role: 'ASSISTANT' })).status).toBe(201);

      // Lockout after the configured number of failures.
      const email = uniqueEmail('lock');
      await manager.post('/api/users', { fullName: 'Lock Test', email, password: 'Str0ng!Passw0rd-XY', role: 'ASSISTANT' });
      const anon = request(app.getHttpServer());
      for (let i = 0; i < 3; i++) await anon.post('/api/auth/login').send({ email, password: 'wrong-password' });
      const locked = await anon.post('/api/auth/login').send({ email, password: 'Str0ng!Passw0rd-XY' });
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

      const restored = await superAdmin.put('/api/settings/security', { ...upd.body.data, passwordMinLength: 10, passwordRequireSymbol: false, loginMaxFailedAttempts: 5 });
      expect(restored.status).toBe(200);
      expect((await superAdmin.get('/api/audit-logs?action=settings.security_updated')).body.data.length).toBeGreaterThanOrEqual(2);
    });
  });
});

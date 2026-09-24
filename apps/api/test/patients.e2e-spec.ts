import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session } from './helpers';

/** Phase 2 — patient management (spec §5, §6, §32) against the real API. */
describe('Patients (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let assistant: Session;
  let doctor: Session;
  let manager: Session;
  let doctorB: Session;
  let superAdmin: Session;
  let uniq = 0;
  const phone = () => `0181${String(Date.now()).slice(-5)}${String(++uniq).padStart(2, '0')}`;

  beforeAll(async () => {
    app = await createTestApp();
    [assistant, doctor, manager, doctorB, superAdmin] = await Promise.all([
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctorB),
      login(app, DEMO_USERS.superAdmin),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const register = (s: Session, body: Record<string, unknown>) =>
    s.post('/api/patients', { gender: 'MALE', ageYears: 40, ...body });

  describe('registration', () => {
    it('assistant registers a patient with a sequential chamber code', async () => {
      const a = await register(assistant, { fullName: 'Test Patient One', phone: phone() });
      const b = await register(assistant, { fullName: 'Test Patient Two', phone: phone() });
      expect(a.status).toBe(201);
      expect(a.body.data.patientCode).toMatch(/^DHN-\d{5}$/);
      const n = (code: string) => Number(code.split('-')[1]);
      expect(n(b.body.data.patientCode)).toBe(n(a.body.data.patientCode) + 1);
      expect(a.body.data.age).toBe(40);
      expect(a.body.data.dobEstimated).toBe(true);
      // Assistant cannot see medical information.
      expect(a.body.data.medical).toBeNull();
    });

    it('issues unique codes under concurrent registrations', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => register(assistant, { fullName: `Concurrent ${i}`, phone: phone() })),
      );
      const codes = results.map((r) => r.body.data.patientCode);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('validates required fields, dates and phone numbers', async () => {
      const res = await assistant.post('/api/patients', { fullName: '', phone: '12', dateOfBirth: '2999-01-01' });
      expect(res.status).toBe(422);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['fullName', 'gender', 'phone', 'dateOfBirth']));
    });

    it('requires a date of birth or an age', async () => {
      const res = await assistant.post('/api/patients', { fullName: 'No Age', gender: 'FEMALE' });
      expect(res.status).toBe(422);
      expect(res.body.error.details[0].message).toBe('validation.dob_or_age');
    });

    it('assistant cannot capture medical information; doctor can', async () => {
      const denied = await register(assistant, { fullName: 'Medical Attempt', phone: phone(), allergies: [{ allergen: 'Latex' }] });
      expect(denied.status).toBe(403);
      const ok = await register(doctor, {
        fullName: 'Doctor Registered',
        phone: phone(),
        allergies: [{ allergen: 'Latex', severity: 'SEVERE' }],
        medicalHistory: { existingConditions: 'Asthma' },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.medical.allergies[0].allergen).toBe('Latex');
      expect(ok.body.data.medical.history.existingConditions).toBe('Asthma');
    });
  });

  describe('duplicate detection', () => {
    it('blocks likely duplicates unless confirmed, and allows shared family phones', async () => {
      const p = phone();
      const first = await register(assistant, { fullName: 'Duplicate Candidate', phone: p, dateOfBirth: '1980-05-05' });
      expect(first.status).toBe(201);

      const dup = await register(assistant, { fullName: 'Duplicate Candidat', phone: p, dateOfBirth: '1980-05-05' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(dup.body.error.data.candidates[0].id).toBe(first.body.data.id);

      // A different family member sharing the phone is only a warning, not a block.
      const sibling = await register(assistant, { fullName: 'Different Person', phone: p, dateOfBirth: '2010-01-01' });
      expect(sibling.status).toBe(201);

      const check = await assistant.post('/api/patients/duplicates', { phone: p });
      expect(check.body.data.length).toBe(2);

      const confirmed = await register(assistant, { fullName: 'Duplicate Candidat', phone: p, dateOfBirth: '1980-05-05', allowDuplicate: true });
      expect(confirmed.status).toBe(201);
    });
  });

  describe('search', () => {
    it('finds by partial name, fuzzy name, code, phone in any format and date of birth', async () => {
      const q = async (term: string) => (await doctor.get(`/api/patients?q=${encodeURIComponent(term)}&pageSize=50`)).body.data.map((p: { fullName: string }) => p.fullName);
      expect(await q('karim')).toContain('Abdul Karim');
      expect(await q('Abdul Karm')).toContain('Abdul Karim'); // typo tolerant
      expect(await q('DHN-00001')).toEqual(expect.arrayContaining(['Abdul Karim']));
      expect((await q('DHN-00001'))[0]).toBe('Abdul Karim');
      expect(await q('01700000100')).toContain('Abdul Karim');
      expect(await q('+8801700000100')).toContain('Abdul Karim');
      expect(await q('0000100')).toContain('Abdul Karim');
      expect(await q('12/04/1968')).toContain('Abdul Karim');
      expect(await q('zzzz-no-match')).toEqual([]);
    });

    it('treats LIKE wildcards in input literally', async () => {
      const res = await doctor.get('/api/patients?q=%25%25%25');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('quick search returns top matches for the command palette', async () => {
      const res = await assistant.get('/api/patients/search?q=salma&limit=5');
      expect(res.status).toBe(200);
      expect(res.body.data[0].fullName).toBe('Salma Begum');
    });

    it('lists with pagination, filters and sorting', async () => {
      const res = await doctor.get('/api/patients?gender=FEMALE&sort=fullName&order=asc&pageSize=3');
      expect(res.status).toBe(200);
      expect(res.body.meta.pageSize).toBe(3);
      expect(res.body.data.every((p: { gender: string }) => p.gender === 'FEMALE')).toBe(true);
      const names = res.body.data.map((p: { fullName: string }) => p.fullName.toLowerCase());
      expect([...names].sort()).toEqual(names);
    });
  });

  describe('tenant isolation', () => {
    it('chamber B cannot find or open chamber A patients', async () => {
      const karim = (await doctor.get('/api/patients/search?q=Abdul%20Karim')).body.data[0];
      expect((await doctorB.get(`/api/patients/${karim.id}`)).status).toBe(404);
      expect((await doctorB.get(`/api/patients/${karim.id}/timeline`)).status).toBe(404);
      expect((await doctorB.patch(`/api/patients/${karim.id}`, { fullName: 'X', gender: 'MALE', ageYears: 1, version: 1 })).status).toBe(404);
      const search = await doctorB.get('/api/patients?q=karim');
      expect(search.body.data.map((p: { fullName: string }) => p.fullName)).not.toContain('Abdul Karim');
    });

    it('new registrations land in the actor’s chamber regardless of input', async () => {
      const res = await doctorB.post('/api/patients', { fullName: 'Uttara Kid', gender: 'FEMALE', ageYears: 5, chamberId: 'ignored' });
      expect(res.status).toBe(201);
      expect(res.body.data.patientCode).toMatch(/^UTR-/);
      expect((await doctor.get(`/api/patients/${res.body.data.id}`)).status).toBe(404);
    });

    it('super admin without a chamber cannot register patients', async () => {
      const res = await register(superAdmin, { fullName: 'Nowhere' });
      expect(res.status).toBe(403);
    });
  });

  describe('profile updates', () => {
    let patientId: string;
    let version: number;

    beforeAll(async () => {
      const res = await register(assistant, { fullName: 'Update Target', phone: phone(), dateOfBirth: '1991-01-01' });
      patientId = res.body.data.id;
      version = res.body.data.version;
    });

    it('assistant updates demographics with optimistic locking', async () => {
      const ok = await assistant.patch(`/api/patients/${patientId}`, {
        fullName: 'Update Target',
        gender: 'MALE',
        dateOfBirth: '1991-01-01',
        phone: '01799999998',
        emergencyContacts: [{ name: 'Brother', relation: 'Brother', phone: '01799999997' }],
        version,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data.emergencyContacts).toHaveLength(1);
      const stale = await assistant.patch(`/api/patients/${patientId}`, { fullName: 'Stale', gender: 'MALE', dateOfBirth: '1991-01-01', version });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');
    });

    it('medical history and allergies need medical permissions', async () => {
      expect((await assistant.put(`/api/patients/${patientId}/medical-history`, { existingConditions: 'X', version: 0 })).status).toBe(403);
      expect((await assistant.post(`/api/patients/${patientId}/allergies`, { allergen: 'Dust' })).status).toBe(403);
      // Managers have update_medical? No — neither view nor update by default.
      expect((await manager.put(`/api/patients/${patientId}/medical-history`, { existingConditions: 'X', version: 0 })).status).toBe(403);

      const created = await doctor.put(`/api/patients/${patientId}/medical-history`, { existingConditions: 'Migraine', version: 0 });
      expect(created.status).toBe(200);
      expect(created.body.data.medical.history.version).toBe(1);
      const stale = await doctor.put(`/api/patients/${patientId}/medical-history`, { existingConditions: 'Other', version: 0 });
      expect(stale.status).toBe(409);

      const allergy = await doctor.post(`/api/patients/${patientId}/allergies`, { allergen: 'Aspirin', severity: 'SEVERE' });
      expect(allergy.status).toBe(201);
      const dupAllergy = await doctor.post(`/api/patients/${patientId}/allergies`, { allergen: 'aspirin' });
      expect(dupAllergy.status).toBe(409);
      const allergyId = allergy.body.data.medical.allergies[0].id;
      const removed = await doctor.del(`/api/patients/${patientId}/allergies/${allergyId}`, { reason: 'Entered in error' });
      expect(removed.status).toBe(200);
      expect(removed.body.data.medical.allergies).toHaveLength(0);
    });

    it('medical values in audit logs are redacted for viewers without medical access', async () => {
      const managerLogs = await manager.get(`/api/audit-logs?resourceId=${patientId}&pageSize=50`);
      const medical = managerLogs.body.data.filter((r: { action: string }) => r.action === 'patient.medical_history_updated');
      expect(medical.length).toBeGreaterThan(0);
      expect(medical[0].newValue).toEqual({ redacted: true });
    });

    it('timeline shows registration and record changes, filterable, without medical details for assistants', async () => {
      const all = await doctor.get(`/api/patients/${patientId}/timeline`);
      expect(all.status).toBe(200);
      const keys = all.body.data.events.map((e: { titleKey: string }) => e.titleKey);
      expect(keys).toEqual(expect.arrayContaining(['timeline.registered', 'timeline.patient_updated', 'timeline.medical_history_updated', 'timeline.allergy_added']));
      expect(keys[keys.length - 1]).toBe('timeline.registered'); // newest first, registration last

      const onlyReg = await doctor.get(`/api/patients/${patientId}/timeline?types=registration`);
      expect(onlyReg.body.data.events).toHaveLength(1);

      const asAssistant = await assistant.get(`/api/patients/${patientId}/timeline`);
      const allergyEvent = asAssistant.body.data.events.find((e: { titleKey: string }) => e.titleKey === 'timeline.allergy_added');
      expect(allergyEvent.details).toEqual({});
      const asDoctor = all.body.data.events.find((e: { titleKey: string }) => e.titleKey === 'timeline.allergy_added');
      expect(asDoctor.details.allergen).toBe('Aspirin');
    });

    it('views are access-logged and appear in recent patients', async () => {
      await doctor.get(`/api/patients/${patientId}`);
      const recent = await doctor.get('/api/patients/recent');
      expect(recent.body.data[0].id).toBe(patientId);
      const views = await prisma.auditLog.count({ where: { action: 'patient.viewed', resourceId: patientId } });
      expect(views).toBeGreaterThan(0);
    });

    it('only roles with patients.delete can archive, with a reason; archived patients disappear', async () => {
      expect((await doctor.del(`/api/patients/${patientId}`, { reason: 'x' })).status).toBe(403);
      expect((await manager.del(`/api/patients/${patientId}`, {})).status).toBe(422);
      expect((await manager.del(`/api/patients/${patientId}`, { reason: 'Registered twice' })).status).toBe(200);
      expect((await doctor.get(`/api/patients/${patientId}`)).status).toBe(404);
      const row = await prisma.patient.findUnique({ where: { id: patientId } });
      expect(row?.deletedAt).not.toBeNull(); // soft delete: the record still exists
    });
  });
});

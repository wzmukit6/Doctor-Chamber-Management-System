import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, zonedDate } from '@chamber/shared';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

const TZ = 'Asia/Dhaka';

/** Phase 4 — clinical workflow (spec §9, §15–§17, §45, §50). */
describe('Consultations & clinical catalogue (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let assistant: Session;
  let doctorA: Session;
  let manager: Session;
  let doctorB: Session; // other chamber
  let doctor2: Session; // second doctor in chamber A
  let superAdmin: Session;
  let doctor2Id: string;
  let vitals: Record<string, string>;
  let n = 0;

  const today = () => zonedDate(new Date(), TZ);
  const newPatient = async () => {
    const res = await assistant.post('/api/patients', { fullName: `Clinical Patient ${Date.now()} ${++n}`, gender: 'MALE', ageYears: 40 + (n % 30) });
    return res.body.data.id as string;
  };
  /** A doctor sees one patient at a time: close out doctor2's open drafts first. */
  const closeOpenDrafts = async () => {
    const open = await doctor2.get(`/api/consultations?doctorId=${doctor2Id}&status=DRAFT&pageSize=100`);
    for (const c of open.body.data) {
      const full = await doctor2.get(`/api/consultations/${c.id}`);
      await doctor2.post(`/api/consultations/${c.id}/cancel`, { reason: 'test cleanup', version: full.body.data.version });
    }
    const queue = await doctor2.get(`/api/queue?doctorId=${doctor2Id}`);
    for (const e of queue.body.data.entries.filter((x: { status: string }) => x.status === 'WAITING' || x.status === 'IN_CONSULTATION')) {
      await assistant.post(`/api/appointments/${e.id}/actions/cancel`, { reason: 'test cleanup' });
    }
  };
  /** Walk-in for doctor2 → start from the queue → returns the consultation id. */
  const startVisit = async (doctorSession = doctor2, doctorId = () => doctor2Id) => {
    await closeOpenDrafts();
    const patientId = await newPatient();
    const appt = await assistant.post('/api/appointments', { patientId, doctorId: doctorId(), date: today(), time: '00:00', checkInNow: true });
    expect(appt.status).toBe(201);
    const started = await doctorSession.post(`/api/appointments/${appt.body.data.id}/actions/start`, {});
    expect(started.status).toBe(200);
    expect(started.body.data.consultationId).toBeTruthy();
    return { consultationId: started.body.data.consultationId as string, appointmentId: appt.body.data.id as string, patientId };
  };
  const draft = (version: number, extra: Record<string, unknown> = {}) => ({
    complaints: [{ text: 'Fever', duration: '3 days' }],
    presentIllness: 'High grade fever with chills',
    vitals: [
      { definitionId: vitals.bp, value: '130/85' },
      { definitionId: vitals.temperature, value: '101.4' },
    ],
    diagnoses: [{ name: 'Viral infection, unspecified', code: 'B34.9', isPrimary: true }],
    investigations: [{ name: 'Complete blood count' }],
    clinicalNotes: 'Private: consider dengue if persists',
    followUpDate: addDays(today(), 7),
    version,
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp();
    [assistant, doctorA, manager, doctorB, superAdmin] = await Promise.all([
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctorB),
      login(app, DEMO_USERS.superAdmin),
    ]);
    const email = uniqueEmail('clinic.doctor');
    await manager.post('/api/users', { fullName: 'Dr. Clinical Test', email, password: STRONG_PASSWORD, role: 'DOCTOR' });
    await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    doctor2 = await login(app, email, STRONG_PASSWORD);
    doctor2Id = (await doctor2.get('/api/auth/me')).body.data.doctorId;
    const defs = (await doctor2.get('/api/vital-definitions')).body.data as { id: string; key: string }[];
    vitals = Object.fromEntries(defs.map((d) => [d.key, d.id]));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('catalogue', () => {
    it('searches diagnoses by name, typo, code and keyword', async () => {
      const q = async (term: string) => (await doctor2.get(`/api/diagnoses?q=${encodeURIComponent(term)}`)).body.data.map((d: { name: string }) => d.name);
      expect((await q('I10'))[0]).toBe('Essential (primary) hypertension');
      expect(await q('hypertnsion')).toContain('Essential (primary) hypertension');
      expect(await q('htn')).toContain('Essential (primary) hypertension');
      expect(await q('diabet')).toContain('Type 2 diabetes mellitus');
      const inv = await doctor2.get('/api/investigations?q=cbc');
      expect(inv.body.data[0].name).toBe('Complete blood count');
    });

    it('chambers add their own entries; global master data is super-admin only; no duplicates', async () => {
      const name = `Chamber-specific test ${Date.now()}`;
      const created = await manager.post('/api/investigations', { name, category: 'Local' });
      expect(created.status).toBe(201);
      expect(created.body.data.isGlobal).toBe(false);
      expect((await manager.post('/api/investigations', { name })).status).toBe(409);
      expect((await manager.post('/api/investigations', { name: 'Global attempt', global: true })).status).toBe(403);
      expect((await assistant.post('/api/investigations', { name: 'Assistant attempt' })).status).toBe(403);
      const cbc = (await manager.get('/api/investigations?q=Complete blood count')).body.data[0];
      expect((await manager.patch(`/api/investigations/${cbc.id}`, { name: 'CBC renamed' })).status).toBe(403);
      // Chamber B does not see chamber A's entry.
      const other = await doctorB.get(`/api/investigations?q=${encodeURIComponent(name)}`);
      expect(other.body.data.map((i: { name: string }) => i.name)).not.toContain(name);
      const deactivated = await manager.post(`/api/investigations/${created.body.data.id}/status`, { isActive: false });
      expect(deactivated.body.data.isActive).toBe(false);
      const globalOk = await superAdmin.post('/api/diagnoses', { name: `Global dx ${Date.now()}`, code: `Z${Date.now() % 1000}.9`, global: true });
      expect(globalOk.status).toBe(201);
      expect(globalOk.body.data.isGlobal).toBe(true);
    });

    it('lists configurable vital definitions', async () => {
      expect(Object.keys(vitals)).toEqual(expect.arrayContaining(['bp', 'pulse', 'temperature', 'weight', 'height', 'spo2', 'respiratory_rate']));
    });
  });

  describe('consultation workflow', () => {
    it('start from the queue creates a draft linked to the appointment; autosave with locking', async () => {
      const { consultationId } = await startVisit();
      const c = await doctor2.get(`/api/consultations/${consultationId}`);
      expect(c.status).toBe(200);
      expect(c.body.data.status).toBe('DRAFT');
      expect(c.body.data.visitNumber).toBe(1);
      expect(c.body.data.canEdit).toBe(true);
      expect(c.body.data.context).toBeDefined();

      const saved = await doctor2.put(`/api/consultations/${consultationId}`, draft(c.body.data.version));
      expect(saved.status).toBe(200);
      expect(saved.body.data.vitals.find((v: { key: string }) => v.key === 'bp').value).toBe('130/85');
      expect(saved.body.data.diagnoses[0].isPrimary).toBe(true);
      const stale = await doctor2.put(`/api/consultations/${consultationId}`, draft(c.body.data.version));
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_VERSION');
    });

    it('validates vitals against their definitions and rejects two primary diagnoses', async () => {
      const { consultationId } = await startVisit();
      const v = (await doctor2.get(`/api/consultations/${consultationId}`)).body.data.version;
      const badVitals = await doctor2.put(`/api/consultations/${consultationId}`, draft(v, { vitals: [{ definitionId: vitals.bp, value: '80/120' }, { definitionId: vitals.spo2, value: '140' }] }));
      expect(badVitals.status).toBe(422);
      expect(badVitals.body.error.details.map((d: { message: string }) => d.message)).toEqual(expect.arrayContaining(['validation.blood_pressure', 'validation.out_of_range']));
      const twoPrimary = await doctor2.put(
        `/api/consultations/${consultationId}`,
        draft(v, { diagnoses: [{ name: 'A', isPrimary: true }, { name: 'B', isPrimary: true }] }),
      );
      expect(twoPrimary.status).toBe(422);
    });

    it('finalize requires completeness, completes the appointment and locks the record', async () => {
      const { consultationId, appointmentId } = await startVisit();
      let v = (await doctor2.get(`/api/consultations/${consultationId}`)).body.data.version;
      const empty = await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: v });
      expect(empty.status).toBe(422);
      expect(empty.body.error.code).toBe('CONSULTATION_INCOMPLETE');

      const noPrimary = await doctor2.put(`/api/consultations/${consultationId}`, draft(v, { diagnoses: [{ name: 'Dx without primary', isPrimary: false }] }));
      v = noPrimary.body.data.version;
      expect((await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: v })).status).toBe(422);

      v = (await doctor2.put(`/api/consultations/${consultationId}`, draft(v))).body.data.version;
      const fin = await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: v });
      expect(fin.status).toBe(200);
      expect(fin.body.data.status).toBe('FINALIZED');
      expect(fin.body.data.canEdit).toBe(false);
      const appt = await assistant.get(`/api/appointments/${appointmentId}`);
      expect(appt.body.data.status).toBe('COMPLETED');

      const edit = await doctor2.put(`/api/consultations/${consultationId}`, draft(fin.body.data.version));
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('CONSULTATION_FINALIZED');

      // The database itself refuses changes to finalized clinical content.
      await expect(prisma.$executeRawUnsafe(`UPDATE consultations SET examination_notes = 'tampered' WHERE id = '${consultationId}'`)).rejects.toThrow(/immutable/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM consultation_diagnoses WHERE consultation_id = '${consultationId}'`)).rejects.toThrow(/immutable/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM consultations WHERE id = '${consultationId}'`)).rejects.toThrow(/cannot be deleted/);

      const add = await doctor2.post(`/api/consultations/${consultationId}/addenda`, { text: 'CBC report reviewed: normal.' });
      expect(add.status).toBe(201);
      expect(add.body.data.addenda).toHaveLength(1);
      await expect(prisma.$executeRawUnsafe(`UPDATE consultation_notes SET text = 'x' WHERE consultation_id = '${consultationId}'`)).rejects.toThrow(/immutable/);
      const audit = await prisma.auditLog.findMany({ where: { resourceType: 'consultation', resourceId: consultationId } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['consultation.started', 'consultation.finalized', 'consultation.addendum_added']));
    });

    it('cancelling a draft returns the patient to the queue and allows a fresh start', async () => {
      const { consultationId, appointmentId } = await startVisit();
      const v = (await doctor2.get(`/api/consultations/${consultationId}`)).body.data.version;
      expect((await doctor2.post(`/api/consultations/${consultationId}/cancel`, { version: v })).status).toBe(422);
      const cancelled = await doctor2.post(`/api/consultations/${consultationId}/cancel`, { reason: 'Wrong patient opened', version: v });
      expect(cancelled.body.data.status).toBe('CANCELLED');
      expect((await assistant.get(`/api/appointments/${appointmentId}`)).body.data.status).toBe('WAITING');
      const again = await doctor2.post(`/api/appointments/${appointmentId}/actions/start`, {});
      expect(again.body.data.consultationId).not.toBe(consultationId);
    });

    it('starting from the patient profile resumes an existing draft or links today’s appointment', async () => {
      await closeOpenDrafts();
      const patientId = await newPatient();
      const direct = await doctor2.post('/api/consultations', { patientId });
      expect(direct.status).toBe(201);
      expect(direct.body.data.appointmentId).toBeNull();
      const resumed = await doctor2.post('/api/consultations', { patientId });
      expect(resumed.body.data.id).toBe(direct.body.data.id);

      await closeOpenDrafts();
      const p2 = await newPatient();
      const appt = await assistant.post('/api/appointments', { patientId: p2, doctorId: doctor2Id, date: today(), time: '00:00', checkInNow: true });
      const linked = await doctor2.post('/api/consultations', { patientId: p2 });
      expect(linked.body.data.appointmentId).toBe(appt.body.data.id);
      expect((await assistant.get(`/api/appointments/${appt.body.data.id}`)).body.data.status).toBe('IN_CONSULTATION');
    });

    it('assistant vitals recorded before the visit are adopted by the consultation', async () => {
      await closeOpenDrafts();
      const patientId = await newPatient();
      const appt = await assistant.post('/api/appointments', { patientId, doctorId: doctor2Id, date: today(), time: '00:00', checkInNow: true });
      const rec = await assistant.put(`/api/appointments/${appt.body.data.id}/vitals`, {
        vitals: [
          { definitionId: vitals.weight, value: '72.35' },
          { definitionId: vitals.pulse, value: '76' },
        ],
      });
      expect(rec.status).toBe(200);
      expect(rec.body.data.find((v: { key: string }) => v.key === 'weight').value).toBe('72.4');
      expect((await manager.put(`/api/appointments/${appt.body.data.id}/vitals`, { vitals: [{ definitionId: vitals.pulse, value: '70' }] })).status).toBe(403);
      const started = await doctor2.post(`/api/appointments/${appt.body.data.id}/actions/start`, {});
      const c = await doctor2.get(`/api/consultations/${started.body.data.consultationId}`);
      const weight = c.body.data.vitals.find((v: { key: string }) => v.key === 'weight');
      expect(weight.value).toBe('72.4');
      expect(weight.recordedByName).toContain('Assistant');
    });
  });

  describe('authorization', () => {
    it('only the consultation doctor edits; assistants cannot view; managers cannot read private notes', async () => {
      const { consultationId } = await startVisit();
      const c = await doctor2.get(`/api/consultations/${consultationId}`);
      await doctor2.put(`/api/consultations/${consultationId}`, draft(c.body.data.version));

      const byOther = await doctorA.put(`/api/consultations/${consultationId}`, draft(c.body.data.version + 1));
      expect(byOther.status).toBe(403);
      expect(byOther.body.error.code).toBe('NOT_CONSULTATION_DOCTOR');
      expect((await doctorA.post(`/api/consultations/${consultationId}/finalize`, { version: c.body.data.version + 1 })).status).toBe(403);

      expect((await assistant.get(`/api/consultations/${consultationId}`)).status).toBe(403);
      expect((await assistant.put(`/api/consultations/${consultationId}`, draft(1))).status).toBe(403);
      expect((await assistant.post('/api/consultations', { patientId: await newPatient() })).status).toBe(403);

      const asManager = await manager.get(`/api/consultations/${consultationId}`);
      expect(asManager.status).toBe(200);
      expect(asManager.body.data.clinicalNotes).toBeNull();
      expect(asManager.body.data.clinicalNotesHidden).toBe(true);
      expect(asManager.body.data.context.medicalHidden).toBe(true);
      const asDoctorA = await doctorA.get(`/api/consultations/${consultationId}`);
      expect(asDoctorA.body.data.clinicalNotes).toContain('Private');

      expect((await doctorB.get(`/api/consultations/${consultationId}`)).status).toBe(404);
    });

    it('timeline shows consultation details only to viewers with medical access', async () => {
      const { consultationId, patientId } = await startVisit();
      const v = (await doctor2.get(`/api/consultations/${consultationId}`)).body.data.version;
      const saved = await doctor2.put(`/api/consultations/${consultationId}`, draft(v));
      await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: saved.body.data.version });

      const asDoctor = await doctorA.get(`/api/patients/${patientId}/timeline?types=diagnosis,investigation,follow_up`);
      const dx = asDoctor.body.data.events.find((e: { type: string }) => e.type === 'diagnosis');
      expect(dx.details.diagnoses).toContain('B34.9');
      const asAssistant = await assistant.get(`/api/patients/${patientId}/timeline?types=diagnosis,follow_up`);
      expect(asAssistant.body.data.events.find((e: { type: string }) => e.type === 'diagnosis').details).toEqual({});
      expect(asAssistant.body.data.events.find((e: { type: string }) => e.type === 'follow_up').details.date).toBe(addDays(today(), 7));
    });

    it('lists consultations, follow-ups due and frequently used items', async () => {
      const list = await doctor2.get(`/api/consultations?doctorId=${doctor2Id}&status=FINALIZED`);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      expect(list.body.data[0].primaryDiagnosis).toBeTruthy();
      const fu = await doctor2.get(`/api/consultations/follow-ups?from=${today()}&to=${addDays(today(), 14)}&doctorId=${doctor2Id}`);
      expect(fu.body.data.length).toBeGreaterThan(0);
      const freq = await doctor2.get('/api/complaints/frequent');
      expect(freq.status).toBe(200);
    });
  });
});

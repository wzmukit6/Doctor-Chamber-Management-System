import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { addDays, zonedDate } from '@chamber/shared';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

const TZ = 'Asia/Dhaka';

/** Phase 5 — medicines, prescriptions, versioning, templates, printing and verification (spec §9–§15, §39). */
describe('Prescriptions (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let assistant: Session;
  let doctorA: Session; // demo doctor, chamber A
  let manager: Session;
  let doctorB: Session; // other chamber
  let superAdmin: Session;
  let doctor2: Session; // second doctor in chamber A
  let doctor2Id: string;
  let n = 0;

  const today = () => zonedDate(new Date(), TZ);
  const med = async (s: Session, q: string) => (await s.get(`/api/medicines?q=${encodeURIComponent(q)}`)).body.data as { id: string; genericName: string; strength: string; form: string; brandName: string | null }[];

  const closeOpenDrafts = async () => {
    const open = await doctor2.get(`/api/consultations?doctorId=${doctor2Id}&status=DRAFT&pageSize=100`);
    for (const c of open.body.data) {
      const full = await doctor2.get(`/api/consultations/${c.id}`);
      await doctor2.post(`/api/consultations/${c.id}/cancel`, { reason: 'test cleanup', version: full.body.data.version });
    }
  };
  const startVisit = async () => {
    await closeOpenDrafts();
    const patient = await assistant.post('/api/patients', { fullName: `Rx Patient ${Date.now()} ${++n}`, gender: 'FEMALE', ageYears: 30 + n });
    const patientId = patient.body.data.id as string;
    const appt = await assistant.post('/api/appointments', { patientId, doctorId: doctor2Id, date: today(), time: '00:00', checkInNow: true });
    expect(appt.status).toBe(201);
    const started = await doctor2.post(`/api/appointments/${appt.body.data.id}/actions/start`, {});
    expect(started.status).toBe(200);
    return { consultationId: started.body.data.consultationId as string, patientId };
  };
  const consultationBody = (version: number, prescription?: object) => ({
    complaints: [{ text: 'Fever', duration: '2 days' }],
    diagnoses: [{ name: 'Viral infection, unspecified', code: 'B34.9', isPrimary: true }],
    followUpDate: addDays(today(), 5),
    ...(prescription ? { prescription } : {}),
    version,
  });
  /** Writes a prescription into a new visit and finalizes it; returns the prescription. */
  const issuedPrescription = async (items?: object[]) => {
    const { consultationId, patientId } = await startVisit();
    const para = (await med(doctor2, 'Paracetamol 500'))[0]!;
    const c = await doctor2.get(`/api/consultations/${consultationId}`);
    const saved = await doctor2.put(
      `/api/consultations/${consultationId}`,
      consultationBody(c.body.data.version, {
        items: items ?? [
          { medicineId: para.id, name: para.genericName, genericName: para.genericName, strength: para.strength, form: 'TABLET', frequency: '1+1+1', durationValue: 5, durationUnit: 'DAYS', quantity: 15, mealInstruction: 'AFTER_MEAL' },
          { name: 'Cetirizine', genericName: 'Cetirizine', strength: '10 mg', form: 'TABLET', frequency: '0+0+1', durationValue: 5, durationUnit: 'DAYS', quantity: 5 },
        ],
        advice: 'Plenty of fluids',
      }),
    );
    expect(saved.status).toBe(200);
    const done = await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: saved.body.data.version });
    expect(done.status).toBe(200);
    const rx = await doctor2.get(`/api/prescriptions/${done.body.data.prescription.id}`);
    return { rx: rx.body.data, consultationId, patientId };
  };

  beforeAll(async () => {
    app = await createTestApp();
    [assistant, doctorA, manager, doctorB, superAdmin] = await Promise.all([
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctorB),
      login(app, DEMO_USERS.superAdmin),
    ]);
    const email = uniqueEmail('rx.doctor');
    await manager.post('/api/users', { fullName: 'Dr. Rx Test', email, password: STRONG_PASSWORD, role: 'DOCTOR' });
    await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    doctor2 = await login(app, email, STRONG_PASSWORD);
    doctor2Id = (await doctor2.get('/api/auth/me')).body.data.doctorId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('medicine database', () => {
    it('searches generics with typos, keywords and strength', async () => {
      expect((await med(doctor2, 'paracetmol')).map((m) => m.genericName)).toContain('Paracetamol');
      expect((await med(doctor2, 'omeprazole'))[0]!.genericName).toBe('Omeprazole');
      expect((await med(doctor2, 'acidity')).length).toBeGreaterThan(0);
      const syrups = (await doctor2.get('/api/medicines?q=paracetamol&form=SUSPENSION')).body.data;
      expect(syrups.every((m: { form: string }) => m.form === 'SUSPENSION')).toBe(true);
    });

    it('chamber medicines with brand names; global master is protected; no duplicates', async () => {
      const brand = `Testbrand ${Date.now()}`;
      const created = await doctorA.post('/api/medicines', { genericName: 'Paracetamol', brandName: brand, manufacturer: 'Demo Pharma', form: 'TABLET', strength: '500 mg' });
      expect(created.status).toBe(201);
      expect(created.body.data.isGlobal).toBe(false);
      expect(created.body.data.route).toBeNull();
      expect((await doctorA.post('/api/medicines', { genericName: 'Paracetamol', brandName: brand, form: 'TABLET', strength: '500 mg' })).status).toBe(409);
      expect((await med(doctor2, brand))[0]!.brandName).toBe(brand);
      // Other chambers never see it.
      expect((await med(doctorB, brand)).map((m) => m.brandName)).not.toContain(brand);
      expect((await doctorB.get(`/api/medicines/${created.body.data.id}`)).status).toBe(404);
      // Assistants read but never write the medicine database.
      expect((await assistant.get('/api/medicines?q=para')).status).toBe(200);
      expect((await assistant.post('/api/medicines', { genericName: 'X', form: 'TABLET' })).status).toBe(403);
      // Global entries: only medicines.manage_global.
      const globalPara = (await med(manager, 'Paracetamol 500')).find((m) => m.brandName === null)!;
      expect((await manager.patch(`/api/medicines/${globalPara.id}`, { genericName: 'Changed', form: 'TABLET' })).status).toBe(403);
      expect((await manager.post('/api/medicines', { genericName: 'Global try', form: 'TABLET', global: true })).status).toBe(403);
      const g = await superAdmin.post('/api/medicines', { genericName: `Global generic ${Date.now()}`, form: 'CAPSULE', strength: '10 mg', global: true });
      expect(g.status).toBe(201);
      expect(g.body.data.isGlobal).toBe(true);
      // Deactivation needs medicines.delete (manager yes, doctor no).
      expect((await doctorA.post(`/api/medicines/${created.body.data.id}/status`, { isActive: false })).status).toBe(403);
      const off = await manager.post(`/api/medicines/${created.body.data.id}/status`, { isActive: false });
      expect(off.body.data.isActive).toBe(false);
      expect((await med(doctor2, brand)).map((m) => m.brandName)).not.toContain(brand);
    });

    it('doctor favourites feed the builder suggestions', async () => {
      const omep = (await med(doctor2, 'omeprazole'))[0]!;
      const fav = await doctor2.put(`/api/medicines/${omep.id}/favorite`);
      expect(fav.status).toBe(200);
      expect(fav.body.data.isFavorite).toBe(true);
      const s = await doctor2.get('/api/medicines/suggestions');
      expect(s.body.data.favorites.map((m: { id: string }) => m.id)).toContain(omep.id);
      expect((await doctor2.get('/api/medicines?scope=favorites')).body.data.map((m: { id: string }) => m.id)).toEqual([omep.id]);
      // Favourites are personal.
      expect((await doctorA.get('/api/medicines/suggestions')).body.data.favorites.map((m: { id: string }) => m.id)).not.toContain(omep.id);
      expect((await assistant.put(`/api/medicines/${omep.id}/favorite`)).status).toBe(403);
      await doctor2.del(`/api/medicines/${omep.id}/favorite`);
      expect((await doctor2.get('/api/medicines/suggestions')).body.data.favorites).toHaveLength(0);
    });
  });

  describe('prescription with the consultation', () => {
    it('draft is saved with the consultation, validated for duplicates and hidden from assistants', async () => {
      const { consultationId } = await startVisit();
      const c = await doctor2.get(`/api/consultations/${consultationId}`);
      expect(c.body.data.prescription).toBeNull();
      const item = { name: 'Paracetamol', genericName: 'Paracetamol', strength: '500 mg', form: 'TABLET', frequency: '1+1+1', durationValue: 3, durationUnit: 'DAYS' };
      const dup = await doctor2.put(`/api/consultations/${consultationId}`, consultationBody(c.body.data.version, { items: [item, { ...item }] }));
      expect(dup.status).toBe(422);
      expect(dup.body.error.details[0]).toMatchObject({ path: 'prescription.items.1.name', message: 'validation.duplicate_medicine' });

      const saved = await doctor2.put(`/api/consultations/${consultationId}`, consultationBody(c.body.data.version, { items: [item], advice: 'Rest' }));
      expect(saved.status).toBe(200);
      expect(saved.body.data.prescription).toMatchObject({ status: 'DRAFT', rxNumber: null, versionNumber: 1, advice: 'Rest' });
      expect(saved.body.data.prescription.items[0]).toMatchObject({ name: 'Paracetamol', frequency: '1+1+1' });
      const rxId = saved.body.data.prescription.id;

      // Saving without `prescription` leaves it unchanged.
      const again = await doctor2.put(`/api/consultations/${consultationId}`, consultationBody(saved.body.data.version));
      expect(again.body.data.prescription.items).toHaveLength(1);

      // Drafts are not visible to the front desk; revision endpoints refuse version-1 drafts.
      expect((await assistant.get(`/api/prescriptions/${rxId}`)).status).toBe(404);
      expect((await assistant.get(`/api/prescriptions?patientId=${c.body.data.patient.id}`)).body.data).toHaveLength(0);
      expect((await doctor2.put(`/api/prescriptions/${rxId}/draft`, { items: [], version: 1 })).status).toBe(409);
      expect((await doctor2.get(`/api/prescriptions/${rxId}/print`)).status).toBe(200); // draft preview for the prescriber
      expect((await assistant.get(`/api/prescriptions/${rxId}/print`)).status).toBe(404);
    });

    it('finalizing the consultation issues the prescription: Rx number, token, hash, audit', async () => {
      const { rx } = await issuedPrescription();
      expect(rx.status).toBe('FINALIZED');
      expect(rx.rxNumber).toMatch(/^RX-\d{6}$/);
      expect(rx.currentVersion).toBe(1);
      expect(rx.versions).toHaveLength(1);
      expect(rx.versions[0]).toMatchObject({ status: 'FINALIZED', versionNumber: 1, advice: 'Plenty of fluids' });
      expect(rx.versions[0].verificationToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(rx.versions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rx.canRevise).toBe(true);
      const audit = await manager.get(`/api/audit-logs?action=prescription.finalized&resourceId=${rx.id}`);
      expect(audit.body.data).toHaveLength(1);
      expect(audit.body.data[0].newValue.rxNumber).toBe(rx.rxNumber);

      // Finalized prescriptions cannot be edited directly.
      const direct = await doctor2.put(`/api/prescriptions/${rx.id}/draft`, { items: [], version: rx.version });
      expect(direct.status).toBe(409);
      expect(direct.body.error.code).toBe('PRESCRIPTION_ALREADY_FINALIZED');
    });

    it('a visit without medicines still gets a prescription with the default advice', async () => {
      const settings = await manager.get('/api/settings/prescriptions');
      await manager.put('/api/settings/prescriptions', { ...settings.body.data, defaultAdvice: 'Drink plenty of water.', version: settings.body.data.version });
      const { consultationId } = await startVisit();
      const c = await doctor2.get(`/api/consultations/${consultationId}`);
      const saved = await doctor2.put(`/api/consultations/${consultationId}`, consultationBody(c.body.data.version));
      const done = await doctor2.post(`/api/consultations/${consultationId}/finalize`, { version: saved.body.data.version });
      expect(done.status).toBe(200);
      expect(done.body.data.prescription).toMatchObject({ status: 'FINALIZED', items: [], advice: 'Drink plenty of water.' });
    });

    it('cancelling the consultation cancels the unissued prescription', async () => {
      const { consultationId } = await startVisit();
      const c = await doctor2.get(`/api/consultations/${consultationId}`);
      const saved = await doctor2.put(`/api/consultations/${consultationId}`, consultationBody(c.body.data.version, { items: [{ name: 'Omeprazole', strength: '20 mg' }] }));
      const rxId = saved.body.data.prescription.id;
      await doctor2.post(`/api/consultations/${consultationId}/cancel`, { reason: 'Patient left', version: saved.body.data.version });
      const rx = await prisma.prescription.findUniqueOrThrow({ where: { id: rxId }, include: { versions: true } });
      expect(rx.status).toBe('CANCELLED');
      expect(rx.versions[0]!.status).toBe('DISCARDED');
      expect((await doctor2.get(`/api/prescriptions?patientId=${rx.patientId}`)).body.data).toHaveLength(0);
    });
  });

  describe('versioning & immutability', () => {
    it('the database rejects changes to finalized versions, their items and deletions', async () => {
      const { rx } = await issuedPrescription();
      const v1 = rx.versions[0];
      await expect(prisma.prescriptionVersion.update({ where: { id: v1.id }, data: { advice: 'tampered' } })).rejects.toThrow(/immutable/);
      await expect(prisma.prescriptionItem.updateMany({ where: { versionId: v1.id }, data: { dose: '10 tab' } })).rejects.toThrow(/immutable/);
      await expect(prisma.prescriptionItem.create({ data: { versionId: v1.id, name: 'Injected' } })).rejects.toThrow(/immutable/);
      await expect(prisma.prescriptionItem.deleteMany({ where: { versionId: v1.id } })).rejects.toThrow(/immutable/);
      await expect(prisma.prescriptionVersion.delete({ where: { id: v1.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.prescription.delete({ where: { id: rx.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.prescription.update({ where: { id: rx.id }, data: { rxNumber: 'RX-999999' } })).rejects.toThrow(/immutable/);
      await expect(prisma.prescription.update({ where: { id: rx.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/transition/);
    });

    it('revision workflow: reason required, owner only, supersedes previous version, audited', async () => {
      const { rx } = await issuedPrescription();
      // Only the prescribing doctor may revise; assistants never.
      expect((await doctorA.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'x', version: rx.version })).body.error.code).toBe('NOT_PRESCRIPTION_DOCTOR');
      expect((await assistant.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'x', version: rx.version })).status).toBe(403);
      expect((await doctor2.post(`/api/prescriptions/${rx.id}/revisions`, { reason: ' ', version: rx.version })).status).toBe(422);

      const started = await doctor2.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'Dose adjustment after lab report', version: rx.version });
      expect(started.status).toBe(201);
      expect(started.body.data.hasDraftRevision).toBe(true);
      const draft = started.body.data.versions[0];
      expect(draft).toMatchObject({ versionNumber: 2, status: 'DRAFT', revisionReason: 'Dose adjustment after lab report' });
      expect(draft.items).toHaveLength(2); // copied from version 1
      expect((await doctor2.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'again', version: started.body.data.version })).body.error.code).toBe('REVISION_IN_PROGRESS');
      // Assistants still see only the issued version.
      expect((await assistant.get(`/api/prescriptions/${rx.id}`)).body.data.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([1]);

      const items = draft.items.map((i: Record<string, unknown>) => ({ ...i, id: undefined }));
      items[0].frequency = '1+0+1';
      items[0].quantity = 10;
      const saved = await doctor2.put(`/api/prescriptions/${rx.id}/draft`, { items: items.slice(0, 1), advice: 'Revised advice', version: started.body.data.version });
      expect(saved.status).toBe(200);
      expect((await doctor2.put(`/api/prescriptions/${rx.id}/draft`, { items, version: started.body.data.version })).status).toBe(409); // stale
      expect((await doctorA.post(`/api/prescriptions/${rx.id}/finalize`, { version: saved.body.data.version })).status).toBe(403);

      const fin = await doctor2.post(`/api/prescriptions/${rx.id}/finalize`, { version: saved.body.data.version });
      expect(fin.status).toBe(200);
      expect(fin.body.data).toMatchObject({ status: 'REVISED', currentVersion: 2, hasDraftRevision: false, rxNumber: rx.rxNumber });
      const [v2, v1] = fin.body.data.versions;
      expect(v2).toMatchObject({ versionNumber: 2, status: 'FINALIZED', advice: 'Revised advice' });
      expect(v2.items).toHaveLength(1);
      expect(v1).toMatchObject({ versionNumber: 1, status: 'SUPERSEDED' });
      expect(v1.supersededAt).toBeTruthy();
      expect(v1.items).toHaveLength(2); // the original is preserved unchanged

      const audit = await manager.get(`/api/audit-logs?action=prescription.revised&resourceId=${rx.id}`);
      expect(audit.body.data[0].reason).toBe('Dose adjustment after lab report');
      expect(audit.body.data[0].oldValue.versionNumber).toBe(1);

      // A further revision can be discarded; the issued version stays current.
      const r3 = await doctor2.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'Mistake', version: fin.body.data.version });
      const discarded = await doctor2.post(`/api/prescriptions/${rx.id}/discard`, { version: r3.body.data.version });
      expect(discarded.status).toBe(200);
      expect(discarded.body.data).toMatchObject({ status: 'REVISED', currentVersion: 2, hasDraftRevision: false });
      expect(discarded.body.data.versions.find((v: { versionNumber: number }) => v.versionNumber === 3).status).toBe('DISCARDED');
    });
  });

  describe('printing & verification', () => {
    it('assistants print issued prescriptions; printing is audited', async () => {
      const { rx } = await issuedPrescription();
      const data = await assistant.get(`/api/prescriptions/${rx.id}/print`);
      expect(data.status).toBe(200);
      expect(data.body.data).toMatchObject({ rxNumber: rx.rxNumber, latestVersionNumber: 1 });
      expect(data.body.data.version.items).toHaveLength(2);
      expect(data.body.data.visit.diagnoses[0].name).toBe('Viral infection, unspecified');
      expect(data.body.data.doctor.fullName).toBe('Dr. Rx Test');
      expect(data.body.data.settings.pageFormat).toBe('A4');
      const log = await assistant.post(`/api/prescriptions/${rx.id}/print-log`, { versionNumber: 1 });
      expect(log.status).toBe(200);
      const audit = await manager.get(`/api/audit-logs?action=prescription.printed&resourceId=${rx.id}`);
      expect(audit.body.data[0].newValue).toMatchObject({ rxNumber: rx.rxNumber, versionNumber: 1 });
    });

    it('public QR verification exposes no patient data and reports superseded versions', async () => {
      const { rx } = await issuedPrescription();
      const token1 = rx.versions[0].verificationToken;
      const anon = request(app.getHttpServer());
      const ok = await anon.get(`/api/public/prescriptions/verify/${token1}`);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ valid: true, status: 'VALID', rxNumber: rx.rxNumber, versionNumber: 1, doctor: { fullName: 'Dr. Rx Test' } });
      const text = JSON.stringify(ok.body.data);
      expect(text).not.toContain(rx.patient.fullName);
      expect(text).not.toContain(rx.patient.patientCode);
      expect(text).not.toContain('Paracetamol');
      expect((await anon.get('/api/public/prescriptions/verify/not-a-real-token')).status).toBe(404);

      const r = await doctor2.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'Update', version: rx.version });
      const fin = await doctor2.post(`/api/prescriptions/${rx.id}/finalize`, { version: r.body.data.version });
      const old = await anon.get(`/api/public/prescriptions/verify/${token1}`);
      expect(old.body.data).toMatchObject({ valid: false, status: 'SUPERSEDED', latestVersionNumber: 2 });
      const token2 = fin.body.data.versions[0].verificationToken;
      expect((await anon.get(`/api/public/prescriptions/verify/${token2}`)).body.data).toMatchObject({ valid: true, versionNumber: 2 });
    });
  });

  describe('lists, copy previous, timeline and tenant isolation', () => {
    it('lists, searches and copies the previous prescription', async () => {
      const { rx, patientId, consultationId } = await issuedPrescription();
      const list = await assistant.get(`/api/prescriptions?q=${rx.rxNumber}`);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(rx.id);
      expect(list.body.data[0]).toMatchObject({ itemCount: 2, primaryDiagnosis: 'Viral infection, unspecified' });
      const latest = await doctor2.get(`/api/prescriptions/latest?patientId=${patientId}`);
      expect(latest.body.data).toMatchObject({ rxNumber: rx.rxNumber, versionNumber: 1 });
      expect(latest.body.data.items).toHaveLength(2);
      const excluded = await doctor2.get(`/api/prescriptions/latest?patientId=${patientId}&excludeConsultationId=${consultationId}`);
      expect(excluded.body.data).toBeNull();
    });

    it('timeline shows issued prescriptions; details redacted for non-medical roles', async () => {
      const { rx, patientId } = await issuedPrescription();
      const doc = await doctor2.get(`/api/patients/${patientId}/timeline?types=prescription`);
      const ev = doc.body.data.events.find((e: { type: string }) => e.type === 'prescription');
      expect(ev.details).toMatchObject({ rxNumber: rx.rxNumber, prescriptionId: rx.id });
      expect(ev.details.medicines).toContain('Paracetamol');
      const asst = await assistant.get(`/api/patients/${patientId}/timeline?types=prescription`);
      const redacted = asst.body.data.events.find((e: { type: string }) => e.type === 'prescription');
      expect(redacted.details).toEqual({ rxNumber: rx.rxNumber, versionNumber: 1, prescriptionId: rx.id });
    });

    it('other chambers can never see or act on the prescription', async () => {
      const { rx } = await issuedPrescription();
      expect((await doctorB.get(`/api/prescriptions/${rx.id}`)).status).toBe(404);
      expect((await doctorB.get(`/api/prescriptions/${rx.id}/print`)).status).toBe(404);
      expect((await doctorB.post(`/api/prescriptions/${rx.id}/revisions`, { reason: 'x', version: rx.version })).status).toBe(404);
      expect((await doctorB.get(`/api/prescriptions?q=${rx.rxNumber}`)).body.data.map((p: { id: string }) => p.id)).not.toContain(rx.id);
    });
  });

  describe('templates', () => {
    const tpl = (name: string, extra: object = {}) => ({
      name,
      diagnoses: [{ name: 'Acute upper respiratory infection', code: 'J06.9', isPrimary: true }],
      investigations: [{ name: 'Complete blood count' }],
      items: [{ name: 'Paracetamol', genericName: 'Paracetamol', strength: '500 mg', form: 'TABLET', frequency: '1+1+1', durationValue: 3, durationUnit: 'DAYS' }],
      advice: 'Warm fluids',
      followUpInstructions: 'Return if not better in 3 days',
      ...extra,
    });

    it('personal templates are private; shared templates are chamber-wide', async () => {
      const personal = await doctor2.post('/api/prescription-templates', tpl(`URTI ${Date.now()}`));
      expect(personal.status).toBe(201);
      expect(personal.body.data).toMatchObject({ shared: false, isOwn: true, canEdit: true });
      expect(personal.body.data.items[0].frequency).toBe('1+1+1');
      expect((await doctor2.post('/api/prescription-templates', tpl(personal.body.data.name))).status).toBe(409);
      expect((await doctorA.get('/api/prescription-templates')).body.data.map((t: { id: string }) => t.id)).not.toContain(personal.body.data.id);
      expect((await doctorA.get(`/api/prescription-templates/${personal.body.data.id}`)).status).toBe(404);

      const shared = await manager.post('/api/prescription-templates', tpl(`Gastritis ${Date.now()}`));
      expect(shared.body.data.shared).toBe(true); // managers create chamber-wide templates
      const seen = (await doctorA.get('/api/prescription-templates')).body.data.find((t: { id: string }) => t.id === shared.body.data.id);
      expect(seen).toMatchObject({ shared: true, canEdit: true });
      expect((await doctorB.get('/api/prescription-templates')).body.data.map((t: { id: string }) => t.id)).not.toContain(shared.body.data.id);
      // Assistants can read templates but not manage them.
      expect((await assistant.post('/api/prescription-templates', tpl('Nope'))).status).toBe(403);
      expect((await doctor2.post('/api/prescription-templates', { name: 'Empty' })).status).toBe(422);

      const upd = await doctor2.patch(`/api/prescription-templates/${personal.body.data.id}`, { ...tpl(personal.body.data.name, { advice: 'Updated' }), version: personal.body.data.version });
      expect(upd.body.data).toMatchObject({ advice: 'Updated', version: 2 });
      expect((await doctor2.patch(`/api/prescription-templates/${personal.body.data.id}`, { ...tpl('x'), version: 1 })).status).toBe(409);
      expect((await doctor2.del(`/api/prescription-templates/${personal.body.data.id}`)).status).toBe(200);
      expect((await doctor2.get(`/api/prescription-templates/${personal.body.data.id}`)).status).toBe(404);
    });
  });

  describe('prescription settings', () => {
    it('managers configure; everyone who prints can read; assistants cannot change', async () => {
      const s = await assistant.get('/api/settings/prescriptions');
      expect(s.status).toBe(200);
      expect(s.body.data).toMatchObject({ pageFormat: 'A4', showQr: true });
      expect((await assistant.put('/api/settings/prescriptions', { ...s.body.data, showQr: false })).status).toBe(403);
      const cur = await manager.get('/api/settings/prescriptions');
      const upd = await manager.put('/api/settings/prescriptions', { ...cur.body.data, medicineNameFormat: 'GENERIC_BRAND', footerText: 'Bring this prescription on your next visit.' });
      expect(upd.status).toBe(200);
      expect(upd.body.data.medicineNameFormat).toBe('GENERIC_BRAND');
      expect((await manager.put('/api/settings/prescriptions', { ...cur.body.data })).status).toBe(409); // stale version
    });
  });
});

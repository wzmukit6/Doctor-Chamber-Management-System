import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, weekdayOf, zonedDate } from '@chamber/shared';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

const TZ = 'Asia/Dhaka';

/** Phase 3 — appointments & queue (spec §7, §8, §46, §48). */
describe('Appointments & queue (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let assistant: Session;
  let doctorA: Session;
  let manager: Session;
  let doctorB: Session; // other chamber
  let testDoctor: Session; // second doctor in chamber A, clean queue
  let doctorAId: string;
  let testDoctorId: string;
  let n = 0;

  const today = () => zonedDate(new Date(), TZ);
  /** Next date (≥ 2 days ahead) falling on the given weekday. */
  const nextWeekday = (weekday: number) => {
    let d = addDays(today(), 2);
    while (weekdayOf(d) !== weekday) d = addDays(d, 1);
    return d;
  };
  const newPatient = async () => {
    const res = await assistant.post('/api/patients', { fullName: `Appt Patient ${Date.now()} ${++n}`, gender: 'FEMALE', ageYears: 30 + n });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const book = (s: Session, body: Record<string, unknown>) => s.post('/api/appointments', body);
  const act = (s: Session, id: string, action: string, body: Record<string, unknown> = {}) => s.post(`/api/appointments/${id}/actions/${action}`, body);
  const walkIn = async (doctorId: string) => {
    const res = await book(assistant, { patientId: await newPatient(), doctorId, date: today(), time: '00:00', checkInNow: true });
    expect(res.status).toBe(201);
    return res.body.data;
  };

  beforeAll(async () => {
    app = await createTestApp();
    [assistant, doctorA, manager, doctorB] = await Promise.all([
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctorB),
    ]);
    doctorAId = (await doctorA.get('/api/auth/me')).body.data.doctorId;
    const email = uniqueEmail('queue.doctor');
    const created = await manager.post('/api/users', { fullName: 'Dr. Queue Test', email, password: STRONG_PASSWORD, role: 'DOCTOR' });
    expect(created.status).toBe(201);
    await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    testDoctor = await login(app, email, STRONG_PASSWORD);
    testDoctorId = (await testDoctor.get('/api/auth/me')).body.data.doctorId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('doctors & schedules', () => {
    it('lists chamber doctors with schedules; only managers edit availability', async () => {
      const res = await assistant.get('/api/doctors');
      expect(res.status).toBe(200);
      const drA = res.body.data.find((d: { id: string }) => d.id === doctorAId);
      expect(drA.schedule.length).toBeGreaterThan(0);
      expect(res.body.data.map((d: { fullName: string }) => d.fullName)).not.toContain('Dr. Demo Karim');

      const body = { windows: [{ weekday: 1, startTime: '10:00', endTime: '12:00' }], slotMinutes: 20 };
      expect((await assistant.put(`/api/doctors/${testDoctorId}/schedule`, body)).status).toBe(403);
      expect((await doctorA.put(`/api/doctors/${testDoctorId}/schedule`, body)).status).toBe(403);
      const overlap = await manager.put(`/api/doctors/${testDoctorId}/schedule`, {
        windows: [
          { weekday: 1, startTime: '10:00', endTime: '12:00' },
          { weekday: 1, startTime: '11:00', endTime: '13:00' },
        ],
      });
      expect(overlap.status).toBe(422);
      const ok = await manager.put(`/api/doctors/${testDoctorId}/schedule`, body);
      expect(ok.status).toBe(200);
      expect(ok.body.data.slotMinutes).toBe(20);
      // Reset to "no schedule" (unrestricted) for the rest of the suite.
      await manager.put(`/api/doctors/${testDoctorId}/schedule`, { windows: [] });
      expect((await doctorB.get(`/api/doctors/${doctorAId}`)).status).toBe(404);
    });

    it('returns availability slots and marks booked ones', async () => {
      const date = nextWeekday(0); // Sunday: doctor A works 09:00–13:00 and 16:00–22:00
      const before = await assistant.get(`/api/appointments/availability?doctorId=${doctorAId}&date=${date}`);
      expect(before.status).toBe(200);
      expect(before.body.data.slotMinutes).toBe(15);
      const slot = before.body.data.slots.find((s: { time: string }) => s.time === '09:30');
      expect(slot.available).toBe(true);
      await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '09:30' });
      const after = await assistant.get(`/api/appointments/availability?doctorId=${doctorAId}&date=${date}`);
      expect(after.body.data.slots.find((s: { time: string }) => s.time === '09:30').available).toBe(false);
    });
  });

  describe('booking rules', () => {
    it('books in chamber-local time and stores UTC', async () => {
      const date = nextWeekday(1);
      const res = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '10:00', reason: 'Check-up' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('BOOKED');
      expect(res.body.data.startsAt).toBe(`${date}T04:00:00.000Z`); // 10:00 Asia/Dhaka = 04:00 UTC
      expect(res.body.data.durationMinutes).toBe(15);
    });

    it('prevents double booking of the doctor unless explicitly overbooked', async () => {
      const date = nextWeekday(2);
      const first = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '10:15' });
      expect(first.status).toBe(201);
      const clash = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '10:20', durationMinutes: 10 });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('APPOINTMENT_CONFLICT');
      expect(clash.body.error.data.issues).toContain('doctor_busy');
      expect(clash.body.error.data.overridable).toBe(true);
      const over = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '10:20', durationMinutes: 10, allowOverbook: true });
      expect(over.status).toBe(201);
    });

    it('never double books a patient, even with overbook', async () => {
      const date = nextWeekday(3);
      const patientId = await newPatient();
      expect((await book(assistant, { patientId, doctorId: doctorAId, date, time: '11:00' })).status).toBe(201);
      const again = await book(assistant, { patientId, doctorId: testDoctorId, date, time: '11:05', allowOverbook: true });
      expect(again.status).toBe(409);
      expect(again.body.error.data.issues).toEqual(['patient_busy']);
      expect(again.body.error.data.overridable).toBe(false);
    });

    it('the database blocks concurrent double bookings', async () => {
      const date = nextWeekday(4);
      const [p1, p2, p3] = [await newPatient(), await newPatient(), await newPatient()];
      const results = await Promise.all(
        [p1, p2, p3].map((patientId) => book(assistant, { patientId, doctorId: doctorAId, date, time: '12:00' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    });

    it('flags bookings outside the schedule (Friday off) until confirmed', async () => {
      const friday = nextWeekday(5);
      const res = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date: friday, time: '10:00' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OUTSIDE_SCHEDULE');
      const confirmed = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date: friday, time: '10:00', allowOverbook: true });
      expect(confirmed.status).toBe(201);
    });

    it('rejects the past, other chambers and missing permissions', async () => {
      const past = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date: addDays(today(), -2), time: '10:00' });
      expect(past.status).toBe(422);
      const karim = (await doctorA.get('/api/patients/search?q=Abdul%20Karim')).body.data[0];
      const doctorBId = (await doctorB.get('/api/auth/me')).body.data.doctorId;
      expect((await book(assistant, { patientId: karim.id, doctorId: doctorBId, date: nextWeekday(1), time: '15:00' })).status).toBe(404);
      expect((await book(doctorB, { patientId: karim.id, doctorId: doctorBId, date: nextWeekday(1), time: '15:00' })).status).toBe(404);
    });
  });

  describe('rescheduling & cancellation', () => {
    it('reschedules with conflict checks and history; cancel needs a reason', async () => {
      const date = nextWeekday(1);
      const res = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '11:30' });
      const id = res.body.data.id;
      const moved = await assistant.post(`/api/appointments/${id}/reschedule`, { date, time: '11:45', version: res.body.data.version, reason: 'Patient request' });
      expect(moved.status).toBe(200);
      expect(moved.body.data.startsAt).toBe(`${date}T05:45:00.000Z`);
      const stale = await assistant.post(`/api/appointments/${id}/reschedule`, { date, time: '12:15', version: res.body.data.version });
      expect(stale.status).toBe(409);

      expect((await act(assistant, id, 'cancel')).status).toBe(422);
      const cancelled = await act(assistant, id, 'cancel', { reason: 'Patient travelling' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');
      // Terminal: cannot be rescheduled or confirmed any more; the slot is free again.
      expect((await assistant.post(`/api/appointments/${id}/reschedule`, { date, time: '12:30', version: cancelled.body.data.version })).status).toBe(409);
      const invalid = await act(assistant, id, 'confirm');
      expect(invalid.status).toBe(409);
      expect(invalid.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date, time: '11:45' })).status).toBe(201);

      const detail = await assistant.get(`/api/appointments/${id}`);
      expect(detail.body.data.history.map((h: { action: string }) => h.action)).toEqual(['CREATED', 'RESCHEDULED', 'STATUS_CHANGED']);
    });

    it('cannot check in on another day or mark no-show before the start', async () => {
      const res = await book(assistant, { patientId: await newPatient(), doctorId: doctorAId, date: nextWeekday(2), time: '09:00' });
      const checkIn = await act(assistant, res.body.data.id, 'check-in');
      expect(checkIn.status).toBe(409);
      expect((await act(assistant, res.body.data.id, 'no-show')).status).toBe(409);
    });
  });

  describe('queue', () => {
    it('walk-ins are checked in with sequential tokens and queued automatically', async () => {
      const a = await walkIn(testDoctorId);
      const b = await walkIn(testDoctorId);
      expect(a.status).toBe('WAITING');
      expect(a.token.number).toBeGreaterThan(0);
      expect(b.token.number).toBe(a.token.number + 1);

      const queue = await assistant.get(`/api/queue?doctorId=${testDoctorId}`);
      expect(queue.status).toBe(200);
      const ids = queue.body.data.entries.map((e: { id: string }) => e.id);
      expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
      expect(queue.body.data.summary.waiting).toBeGreaterThanOrEqual(2);
    });

    it('issues unique tokens under concurrent check-ins', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, async () => book(assistant, { patientId: await newPatient(), doctorId: testDoctorId, date: today(), time: '00:00', checkInNow: true })),
      );
      const tokens = results.map((r) => r.body.data.token.number);
      expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('call next skips held patients; start/complete follow the state machine', async () => {
      // Drain anything waiting for the test doctor first.
      const initial = await testDoctor.get(`/api/queue?doctorId=${testDoctorId}`);
      for (const e of initial.body.data.entries.filter((x: { status: string }) => x.status === 'WAITING')) {
        await act(assistant, e.id, 'cancel', { reason: 'test reset' });
      }
      const first = await walkIn(testDoctorId);
      const second = await walkIn(testDoctorId);
      const held = await assistant.post(`/api/queue/${first.id}/hold`);
      expect(held.body.data.token.onHold).toBe(true);

      const called = await testDoctor.post('/api/queue/call-next', { doctorId: testDoctorId });
      expect(called.status).toBe(200);
      expect(called.body.data.id).toBe(second.id);
      expect(called.body.data.token.callCount).toBe(1);

      const started = await act(testDoctor, second.id, 'start');
      expect(started.body.data.status).toBe('IN_CONSULTATION');
      // Front desk cannot pull a patient out of the doctor's room via "send to queue".
      expect((await act(assistant, second.id, 'send-to-queue')).status).toBe(409);
      expect((await act(doctorA, second.id, 'return-to-queue')).status).toBe(403);
      // One patient at a time per doctor.
      await assistant.post(`/api/queue/${first.id}/resume`);
      const busy = await act(testDoctor, first.id, 'start');
      expect(busy.status).toBe(409);

      const completed = await act(testDoctor, second.id, 'complete');
      expect(completed.body.data.status).toBe('COMPLETED');
      expect(completed.body.data.completedAt).not.toBeNull();

      const nextCall = await testDoctor.post('/api/queue/call-next', { doctorId: testDoctorId });
      expect(nextCall.body.data.id).toBe(first.id);
      await act(testDoctor, first.id, 'start');
      await act(testDoctor, first.id, 'complete');
      const empty = await testDoctor.post('/api/queue/call-next', { doctorId: testDoctorId });
      expect(empty.status).toBe(200);
      expect(empty.body.data).toBeNull();
    });

    it("a doctor cannot run another doctor's consultation or queue; assistants cannot start consultations", async () => {
      const entry = await walkIn(testDoctorId);
      const other = await act(doctorA, entry.id, 'start');
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('NOT_APPOINTMENT_DOCTOR');
      expect((await act(assistant, entry.id, 'start')).status).toBe(403);
      expect((await doctorA.post('/api/queue/call-next', { doctorId: testDoctorId })).status).toBe(403);
      expect((await doctorB.get(`/api/appointments/${entry.id}`)).status).toBe(404);
      expect((await act(doctorB, entry.id, 'cancel', { reason: 'x' })).status).toBe(404);
    });

    it('token numbering follows chamber settings (prefix, chamber-wide scope)', async () => {
      const current = (await manager.get('/api/settings/appointments')).body.data;
      expect((await assistant.put('/api/settings/appointments', { ...current })).status).toBe(403);
      const updated = await manager.put('/api/settings/appointments', { ...current, tokenPrefix: 'A', tokenScope: 'CHAMBER', autoQueueOnCheckIn: false });
      expect(updated.status).toBe(200);
      const entry = await walkIn(testDoctorId);
      expect(entry.token.label).toMatch(/^A\d+$/);
      expect(entry.status).toBe('CHECKED_IN'); // not auto-queued any more
      expect((await act(assistant, entry.id, 'send-to-queue')).body.data.status).toBe('WAITING');
      await manager.put('/api/settings/appointments', { ...current, version: updated.body.data.version });
    });
  });

  describe('audit & timeline', () => {
    it('status changes are audited and appear on the patient timeline', async () => {
      const entry = await walkIn(testDoctorId);
      const logs = await prisma.auditLog.findMany({ where: { resourceType: 'appointment', resourceId: entry.id } });
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['appointment.created', 'appointment.check_in']));
      const timeline = await doctorA.get(`/api/patients/${entry.patient.id}/timeline?types=appointment`);
      expect(timeline.body.data.events[0].titleKey).toBe('timeline.appointment_waiting');
    });
  });
});

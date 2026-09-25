import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { zonedDate } from '@chamber/shared';
import { DEMO_USERS } from '../prisma/seed-lib';
import { createTestApp, login, Session, STRONG_PASSWORD, uniqueEmail } from './helpers';

const TZ = 'Asia/Dhaka';

/** Phase 6 — billing & payments (spec §18, §49 "Billing", §50 "Billing: ✓ ✓ View Limited"). */
describe('Billing (integration)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let assistant: Session;
  let manager: Session;
  let doctorA: Session;
  let managerB: Session;
  let billDoctor: Session;
  let doctorId: string;
  let n = 0;

  const today = () => zonedDate(new Date(), TZ);
  const visit = async (visitType = 'NEW') => {
    const patient = await assistant.post('/api/patients', { fullName: `Billing Patient ${Date.now()} ${++n}`, gender: 'MALE', ageYears: 45, phone: `0171${String(Date.now()).slice(-7)}` });
    const appt = await assistant.post('/api/appointments', { patientId: patient.body.data.id, doctorId, date: today(), time: '00:00', checkInNow: true, visitType });
    expect(appt.status).toBe(201);
    return { patientId: patient.body.data.id as string, appointmentId: appt.body.data.id as string };
  };
  const consult = { type: 'CONSULTATION', description: 'Consultation fee', unitPrice: 800 };

  beforeAll(async () => {
    app = await createTestApp();
    [assistant, manager, doctorA, managerB] = await Promise.all([
      login(app, DEMO_USERS.assistant),
      login(app, DEMO_USERS.manager),
      login(app, DEMO_USERS.doctor),
      login(app, DEMO_USERS.managerB),
    ]);
    const email = uniqueEmail('bill.doctor');
    await manager.post('/api/users', { fullName: 'Dr. Billing Test', email, password: STRONG_PASSWORD, role: 'DOCTOR' });
    await prisma.user.update({ where: { email }, data: { mustChangePassword: false } });
    billDoctor = await login(app, email, STRONG_PASSWORD);
    doctorId = (await billDoctor.get('/api/auth/me')).body.data.doctorId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('fees', () => {
    it('managers set doctor fees (audited); others cannot', async () => {
      const d = (await manager.get(`/api/doctors/${doctorId}`)).body.data;
      expect((await assistant.put(`/api/doctors/${doctorId}/fees`, { consultationFee: 1, version: d.version })).status).toBe(403);
      expect((await billDoctor.put(`/api/doctors/${doctorId}/fees`, { consultationFee: 1, version: d.version })).status).toBe(403);
      const res = await manager.put(`/api/doctors/${doctorId}/fees`, { consultationFee: 800, followUpFee: 500, reportReviewFee: 300, version: d.version });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ consultationFee: 800, followUpFee: 500, reportReviewFee: 300 });
      expect((await manager.put(`/api/doctors/${doctorId}/fees`, { consultationFee: 900, version: d.version })).status).toBe(409);
      const audit = await manager.get(`/api/audit-logs?action=doctor.fees_updated&resourceId=${doctorId}`);
      expect(audit.body.data[0].newValue.consultationFee).toBe(800);
    });

    it('fee schedule: managers manage, everyone reads, no duplicates', async () => {
      const name = `Nebulization ${Date.now()}`;
      const created = await manager.post('/api/fee-items', { kind: 'PROCEDURE', name, amount: 300 });
      expect(created.status).toBe(201);
      expect((await manager.post('/api/fee-items', { kind: 'PROCEDURE', name, amount: 350 })).status).toBe(409);
      expect((await assistant.post('/api/fee-items', { kind: 'OTHER', name: 'x', amount: 1 })).status).toBe(403);
      expect((await assistant.get('/api/fee-items')).body.data.map((f: { name: string }) => f.name)).toContain(name);
      expect((await managerB.get('/api/fee-items')).body.data.map((f: { name: string }) => f.name)).not.toContain(name);
      const off = await manager.post(`/api/fee-items/${created.body.data.id}/status`, { isActive: false });
      expect(off.body.data.isActive).toBe(false);
    });
  });

  describe('invoices & payments', () => {
    it('suggests the fee for the visit type and investigation extras', async () => {
      const { appointmentId } = await visit('FOLLOW_UP');
      const s = await assistant.get(`/api/invoices/suggest?appointmentId=${appointmentId}`);
      expect(s.status).toBe(200);
      expect(s.body.data.items).toEqual([expect.objectContaining({ type: 'FOLLOW_UP', unitPrice: 500 })]);
      expect(s.body.data.existingInvoiceId).toBeNull();
    });

    it('assistant bills a visit with a part payment; one bill per visit; receipts are numbered', async () => {
      const { patientId, appointmentId } = await visit();
      const res = await assistant.post('/api/invoices', {
        patientId,
        appointmentId,
        items: [consult, { type: 'INVESTIGATION', description: 'Complete blood count', unitPrice: 400 }],
        payment: { amount: 300, method: 'CASH' },
      });
      expect(res.status).toBe(201);
      const inv = res.body.data;
      expect(inv).toMatchObject({ status: 'PARTIALLY_PAID', subtotal: 1200, total: 1200, paid: 300, due: 900, doctor: { id: doctorId } });
      expect(inv.invoiceNumber).toMatch(/^INV-\d{6}$/);
      expect(inv.payments[0]).toMatchObject({ kind: 'PAYMENT', amount: 300, method: 'CASH', receivedByName: expect.stringContaining('Assistant') });
      expect(inv.payments[0].receiptNumber).toMatch(/^RCPT-\d{6}$/);
      const dup = await assistant.post('/api/invoices', { patientId, appointmentId, items: [consult] });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('INVOICE_EXISTS');
      expect(dup.body.error.data.invoiceId).toBe(inv.id);

      // Overpayment is refused; paying the rest settles the bill.
      const over = await assistant.post(`/api/invoices/${inv.id}/payments`, { amount: 901, method: 'CASH', version: inv.version });
      expect(over.body.error.code).toBe('OVERPAYMENT');
      const rest = await assistant.post(`/api/invoices/${inv.id}/payments`, { amount: 900, method: 'MOBILE_BANKING', provider: 'bKash', reference: 'TRX123', version: inv.version });
      expect(rest.status).toBe(201);
      expect(rest.body.data).toMatchObject({ status: 'PAID', paid: 1200, due: 0 });
      expect(rest.body.data.payments).toHaveLength(2);

      // The appointment and queue show the bill.
      const q = await assistant.get(`/api/queue?doctorId=${doctorId}`);
      const entry = q.body.data.entries.find((e: { id: string }) => e.id === appointmentId);
      expect(entry.billing).toMatchObject({ invoiceId: inv.id, status: 'PAID', due: 0 });
    });

    it('assistants cannot discount, edit, refund or void; doctors only view', async () => {
      const { patientId, appointmentId } = await visit();
      expect((await assistant.post('/api/invoices', { patientId, appointmentId, items: [consult], discountAmount: 100, discountReason: 'Friend' })).status).toBe(403);
      const inv = (await assistant.post('/api/invoices', { patientId, appointmentId, items: [consult] })).body.data;
      expect((await assistant.patch(`/api/invoices/${inv.id}`, { items: [consult], reason: 'x', version: inv.version })).status).toBe(403);
      expect((await assistant.post(`/api/invoices/${inv.id}/refunds`, { amount: 1, method: 'CASH', reason: 'x', version: inv.version })).status).toBe(403);
      expect((await assistant.post(`/api/invoices/${inv.id}/void`, { reason: 'x', version: inv.version })).status).toBe(403);
      expect((await doctorA.get(`/api/invoices/${inv.id}`)).status).toBe(200);
      expect((await doctorA.post('/api/invoices', { patientId, items: [consult] })).status).toBe(403);
      expect((await doctorA.post(`/api/invoices/${inv.id}/payments`, { amount: 1, method: 'CASH', version: inv.version })).status).toBe(403);
    });

    it('manager edits with a reason (never below what was paid), refunds and voids', async () => {
      const { patientId, appointmentId } = await visit();
      let inv = (await assistant.post('/api/invoices', { patientId, appointmentId, items: [consult], payment: { amount: 800, method: 'CASH' } })).body.data;
      // Discount after full payment would drop the total below the paid amount.
      const below = await manager.patch(`/api/invoices/${inv.id}`, { items: [consult], discountAmount: 200, discountReason: 'Senior citizen', reason: 'Discount approved', version: inv.version });
      expect(below.body.error.code).toBe('TOTAL_BELOW_PAID');
      expect((await manager.patch(`/api/invoices/${inv.id}`, { items: [consult], reason: '', version: inv.version })).status).toBe(422);

      const upd = await manager.patch(`/api/invoices/${inv.id}`, {
        items: [consult, { type: 'PROCEDURE', description: 'Nebulization', unitPrice: 300, quantity: 2 }],
        discountAmount: 100,
        discountPercent: null,
        discountReason: 'Senior citizen',
        reason: 'Added nebulization',
        version: inv.version,
      });
      expect(upd.status).toBe(200);
      inv = upd.body.data;
      expect(inv).toMatchObject({ subtotal: 1400, discountAmount: 100, total: 1300, paid: 800, due: 500, status: 'PARTIALLY_PAID' });
      expect((await manager.patch(`/api/invoices/${inv.id}`, { items: [consult], reason: 'stale', version: inv.version - 1 })).status).toBe(409);
      const audit = await manager.get(`/api/audit-logs?action=invoice.updated&resourceId=${inv.id}`);
      expect(audit.body.data[0]).toMatchObject({ reason: 'Added nebulization' });
      expect(audit.body.data[0].oldValue.total).toBe(800);

      // Refunds: never more than was paid; reason required; separate ledger entry.
      expect((await manager.post(`/api/invoices/${inv.id}/refunds`, { amount: 900, method: 'CASH', reason: 'x', version: inv.version })).body.error.code).toBe('REFUND_EXCEEDS_PAID');
      expect((await manager.post(`/api/invoices/${inv.id}/refunds`, { amount: 100, method: 'CASH', version: inv.version })).status).toBe(422);
      const ref = await manager.post(`/api/invoices/${inv.id}/refunds`, { amount: 800, method: 'CASH', reason: 'Visit cancelled', version: inv.version });
      expect(ref.status).toBe(201);
      inv = ref.body.data;
      expect(inv).toMatchObject({ paid: 0, refunded: 800, due: 1300, status: 'UNPAID' });
      expect(inv.payments.map((p: { kind: string }) => p.kind)).toEqual(['PAYMENT', 'REFUND']);
      expect(inv.payments[1].receiptNumber).toMatch(/^RF-\d{6}$/);

      // Void; void bills are frozen; the visit can be billed again.
      const voided = await manager.post(`/api/invoices/${inv.id}/void`, { reason: 'Billed in error', version: inv.version });
      expect(voided.body.data).toMatchObject({ status: 'VOID', voidReason: 'Billed in error', due: 0 });
      expect((await assistant.post(`/api/invoices/${inv.id}/payments`, { amount: 1, method: 'CASH', version: voided.body.data.version })).body.error.code).toBe('INVOICE_VOID');
      expect((await assistant.post('/api/invoices', { patientId, appointmentId, items: [consult] })).status).toBe(201);
    });

    it('cannot void a bill that still holds money', async () => {
      const { patientId } = await visit();
      const inv = (await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 100, method: 'CASH' } })).body.data;
      expect((await manager.post(`/api/invoices/${inv.id}/void`, { reason: 'x', version: inv.version })).body.error.code).toBe('INVOICE_HAS_PAYMENTS');
    });

    it('rejects card numbers and disabled payment methods', async () => {
      const { patientId } = await visit();
      const card = await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 100, method: 'CARD', reference: '4111 1111 1111 1111' } });
      expect(card.status).toBe(422);
      expect(card.body.error.details[0]).toMatchObject({ path: 'payment.reference', message: 'validation.no_card_number' });
      const s = (await manager.get('/api/settings/billing')).body.data;
      await manager.put('/api/settings/billing', { ...s, enabledMethods: ['CASH'] });
      const disabled = await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 100, method: 'CARD' } });
      expect(disabled.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
      const cur = (await manager.get('/api/settings/billing')).body.data;
      await manager.put('/api/settings/billing', { ...cur, enabledMethods: s.enabledMethods });
      expect((await assistant.put('/api/settings/billing', { ...cur, enabledMethods: ['CASH'] })).status).toBe(403);
    });

    it('the database enforces the ledger and totals', async () => {
      const { patientId } = await visit();
      const inv = (await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 800, method: 'CASH' } })).body.data;
      const pid = inv.payments[0].id;
      await expect(prisma.payment.update({ where: { id: pid }, data: { amount: 1 } })).rejects.toThrow(/append-only/);
      await expect(prisma.payment.delete({ where: { id: pid } })).rejects.toThrow(/append-only/);
      await expect(prisma.invoice.delete({ where: { id: inv.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.invoice.update({ where: { id: inv.id }, data: { total: 5 } })).rejects.toThrow(/invoices_amounts_valid/);
      await expect(prisma.invoice.update({ where: { id: inv.id }, data: { status: 'UNPAID' } })).rejects.toThrow(/invoices_status_consistent/);
    });
  });

  describe('lists, summary, isolation, timeline', () => {
    it('searches, filters open bills and summarises collections and dues', async () => {
      const { patientId } = await visit();
      const inv = (await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 200, method: 'MOBILE_BANKING', provider: 'Nagad' } })).body.data;
      const found = await assistant.get(`/api/invoices?q=${inv.invoiceNumber}`);
      expect(found.body.data.map((i: { id: string }) => i.id)).toEqual([inv.id]);
      const open = await assistant.get(`/api/invoices?status=OPEN&patientId=${patientId}`);
      expect(open.body.data).toHaveLength(1);
      const s = await manager.get(`/api/invoices/summary?from=${today()}&to=${today()}&doctorId=${doctorId}`);
      expect(s.status).toBe(200);
      expect(s.body.data.collected).toBeGreaterThanOrEqual(200);
      expect(s.body.data.byMethod.map((m: { method: string }) => m.method)).toContain('MOBILE_BANKING');
      expect(s.body.data.outstanding).toBeGreaterThanOrEqual(600);
      expect(s.body.data.byDoctor[0]).toMatchObject({ doctorId, doctorName: 'Dr. Billing Test' });
    });

    it('other chambers never see a bill; timeline shows payments', async () => {
      const { patientId } = await visit();
      const inv = (await assistant.post('/api/invoices', { patientId, items: [consult], payment: { amount: 800, method: 'CASH' } })).body.data;
      expect((await managerB.get(`/api/invoices/${inv.id}`)).status).toBe(404);
      expect((await managerB.post(`/api/invoices/${inv.id}/void`, { reason: 'x', version: inv.version })).status).toBe(404);
      expect((await managerB.get(`/api/invoices?q=${inv.invoiceNumber}`)).body.data).toHaveLength(0);
      const tl = await assistant.get(`/api/patients/${patientId}/timeline?types=payment`);
      expect(tl.body.data.events[0]).toMatchObject({ type: 'payment', details: { amount: '800.00', method: 'CASH', invoiceNumber: inv.invoiceNumber } });
      const print = await assistant.get(`/api/invoices/${inv.id}/print`);
      expect(print.body.data).toMatchObject({ invoice: { id: inv.id }, settings: { currencySymbol: '৳' } });
      expect((await assistant.post(`/api/invoices/${inv.id}/print-log`)).status).toBe(200);
    });
  });
});

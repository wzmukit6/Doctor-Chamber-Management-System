import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BillingSummaryDto,
  BillingSummaryQuery,
  computeInvoiceTotals,
  CreateInvoiceInput,
  ERROR_CODES,
  InvoiceDto,
  InvoiceItemInput,
  InvoiceListQuery,
  InvoicePrintDto,
  InvoiceSuggestionDto,
  InvoiceSummaryDto,
  invoiceStatusFor,
  PaymentInput,
  PERMISSIONS,
  RecordPaymentInput,
  RefundInput,
  toCents,
  UpdateInvoiceInput,
  zonedDayRange,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { BillingSettingsService } from '../settings/billing-settings.service';
import { AppError } from '../../common/errors/app-error';
import { Actor } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageMeta } from '../../common/utils/pagination';
import { dec, invoiceInclude, InvoiceRow, invoiceSummaryInclude, money, toInvoiceDto, toInvoiceSummary } from './billing.mapper';

type Tx = Prisma.TransactionClient;
const STATUSES = new Set(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID']);

/**
 * Billing (spec §18): one bill per visit with consultation, investigation and
 * other charges, discount, total, paid and due. Payments and refunds are an
 * append-only ledger with receipt numbers; bills are voided, never deleted.
 * All amounts are calculated in integer paisa/cents.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly settings: BillingSettingsService,
  ) {}

  private async chamber(actor: Actor) {
    if (!actor.chamberId) throw AppError.forbidden('Billing is managed inside a chamber. Sign in with a chamber membership.');
    return this.prisma.chamber.findUniqueOrThrow({ where: { id: actor.chamberId }, select: { id: true, organizationId: true, timezone: true } });
  }

  // ─────────────────────────── Queries ───────────────────────────

  async list(actor: Actor, q: InvoiceListQuery): Promise<PageResult<InvoiceSummaryDto>> {
    const scope = this.authz.chamberScope(actor);
    const tz = actor.chamberId ? (await this.prisma.chamber.findUnique({ where: { id: actor.chamberId }, select: { timezone: true } }))?.timezone : undefined;
    const statuses = (q.status ?? '')
      .split(',')
      .flatMap((s) => (s === 'OPEN' ? ['UNPAID', 'PARTIALLY_PAID'] : [s]))
      .filter((s) => STATUSES.has(s)) as InvoiceRow['status'][];
    const term = q.q?.trim();
    const where: Prisma.InvoiceWhereInput = {
      ...scope,
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      ...(q.appointmentId ? { appointmentId: q.appointmentId } : {}),
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(term
        ? {
            OR: [
              { invoiceNumber: { contains: term, mode: 'insensitive' } },
              { patient: { fullName: { contains: term, mode: 'insensitive' } } },
              { patient: { patientCode: { contains: term, mode: 'insensitive' } } },
              { patient: { phone: { contains: term.replace(/[\s-]/g, '') } } },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? {
            issuedAt: {
              ...(q.from ? { gte: zonedDayRange(q.from, tz ?? 'Asia/Dhaka').start } : {}),
              ...(q.to ? { lt: zonedDayRange(q.to, tz ?? 'Asia/Dhaka').end } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where, include: invoiceSummaryInclude, orderBy: { issuedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return new PageResult(rows.map(toInvoiceSummary), pageMeta(q, total));
  }

  async get(actor: Actor, id: string): Promise<InvoiceDto> {
    return toInvoiceDto(await this.load(actor, id));
  }

  /** Pre-filled bill for a visit: the doctor's fee for the visit type plus fees of ordered investigations as optional extras. */
  async suggest(actor: Actor, input: { appointmentId?: string; patientId?: string }): Promise<InvoiceSuggestionDto> {
    const chamber = await this.chamber(actor);
    if (input.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: { id: input.appointmentId, chamberId: chamber.id },
        include: {
          patient: { select: { id: true, patientCode: true, fullName: true } },
          doctor: { include: { user: { select: { fullName: true } } } },
          consultation: { select: { investigations: { select: { investigationId: true, name: true } } } },
          invoices: { where: { status: { not: 'VOID' } }, select: { id: true } },
        },
      });
      if (!appt) throw AppError.notFound('Appointment');
      const d = appt.doctor;
      const fee =
        appt.visitType === 'FOLLOW_UP'
          ? { type: 'FOLLOW_UP', description: `Follow-up consultation — ${d.user.fullName}`, amount: d.followUpFee ?? d.consultationFee }
          : appt.visitType === 'REPORT_REVIEW'
            ? { type: 'CONSULTATION', description: `Report review — ${d.user.fullName}`, amount: d.reportReviewFee ?? d.followUpFee ?? d.consultationFee }
            : { type: 'CONSULTATION', description: `Consultation fee — ${d.user.fullName}`, amount: d.consultationFee };
      const ordered = appt.consultation?.investigations ?? [];
      const fees = ordered.length
        ? await this.prisma.feeItem.findMany({
            where: {
              chamberId: chamber.id,
              isActive: true,
              OR: [{ investigationId: { in: ordered.map((i) => i.investigationId).filter((x): x is string => !!x) } }, { name: { in: ordered.map((i) => i.name), mode: 'insensitive' } }],
            },
          })
        : [];
      return {
        patient: appt.patient,
        doctor: { id: d.id, fullName: d.user.fullName },
        appointmentId: appt.id,
        visitType: appt.visitType,
        existingInvoiceId: appt.invoices[0]?.id ?? null,
        items: [{ type: fee.type, description: fee.description, quantity: 1, unitPrice: money(fee.amount), feeItemId: null }],
        suggestedExtras: fees.map((f) => ({ type: 'INVESTIGATION', description: f.name, quantity: 1, unitPrice: money(f.amount), feeItemId: f.id })),
      };
    }
    if (!input.patientId) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'appointmentId or patientId is required', 422);
    const patient = await this.prisma.patient.findFirst({ where: { id: input.patientId, chamberId: chamber.id, deletedAt: null }, select: { id: true, patientCode: true, fullName: true } });
    if (!patient) throw AppError.notFound('Patient');
    return { patient, doctor: null, appointmentId: null, visitType: null, existingInvoiceId: null, items: [], suggestedExtras: [] };
  }

  // ─────────────────────────── Commands ───────────────────────────

  async create(actor: Actor, input: CreateInvoiceInput): Promise<InvoiceDto> {
    this.authz.assertPermission(actor, PERMISSIONS.BILLING_CREATE);
    // Assistants bill standard fees; discounts need `billing.update` (spec §50 "Billing: Assistant limited").
    if (input.discountAmount > 0 && !actor.permissions.has(PERMISSIONS.BILLING_UPDATE)) throw AppError.forbidden('Only a manager can give a discount');
    const chamber = await this.chamber(actor);
    const patient = await this.prisma.patient.findFirst({ where: { id: input.patientId, chamberId: chamber.id, deletedAt: null }, select: { id: true, isDemo: true } });
    if (!patient) throw AppError.notFound('Patient');
    let doctorId = input.doctorId ?? null;
    if (input.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: { id: input.appointmentId, chamberId: chamber.id },
        select: { patientId: true, doctorId: true, invoices: { where: { status: { not: 'VOID' } }, select: { id: true } } },
      });
      if (!appt || appt.patientId !== patient.id) throw AppError.notFound('Appointment');
      if (appt.invoices[0]) throw new AppError(ERROR_CODES.INVOICE_EXISTS, 'This visit already has a bill', HttpStatus.CONFLICT, undefined, { invoiceId: appt.invoices[0].id });
      doctorId = doctorId ?? appt.doctorId;
    }
    if (doctorId && !(await this.prisma.doctor.findFirst({ where: { id: doctorId, chamberId: chamber.id }, select: { id: true } }))) throw AppError.notFound('Doctor');
    const totals = this.totals(input.items, input.discountAmount);
    if (input.payment) {
      await this.assertMethod(chamber.id, input.payment.method);
      if (toCents(input.payment.amount) > totals.total) throw this.overpayment(totals.total);
    }

    const id = await this.prisma
      .$transaction(async (tx) => {
        const invoiceNumber = await this.nextNumber(tx, chamber.id, 'INVOICE', 'INV');
        const status = invoiceStatusFor(totals.total / 100, 0);
        const inv = await tx.invoice.create({
          data: {
            organizationId: chamber.organizationId,
            chamberId: chamber.id,
            patientId: patient.id,
            doctorId,
            appointmentId: input.appointmentId ?? null,
            invoiceNumber,
            status,
            subtotal: dec(totals.subtotal),
            discountAmount: dec(totals.discount),
            discountPercent: input.discountAmount > 0 ? (input.discountPercent ?? null) : null,
            discountReason: input.discountAmount > 0 ? input.discountReason : null,
            total: dec(totals.total),
            dueAmount: dec(totals.total),
            notes: input.notes,
            isDemo: patient.isDemo,
            createdById: actor.userId,
            createdByName: actor.fullName,
            items: { create: this.itemRows(input.items) },
          },
        });
        await this.audit.record(
          actor,
          {
            action: 'invoice.created',
            resourceType: 'invoice',
            resourceId: inv.id,
            newValue: { invoiceNumber, patientId: patient.id, items: this.itemSummary(input.items), discount: totals.discount / 100, total: totals.total / 100 },
          },
          tx,
        );
        if (input.payment) await this.applyPayment(tx, actor, { id: inv.id, chamberId: chamber.id, version: inv.version, isDemo: patient.isDemo }, input.payment);
        return inv.id;
      })
      .catch(InvoicesService.uniqueGuard);
    return this.get(actor, id);
  }

  /** Changing an issued bill needs `billing.update` and a reason; it can never drop below what was already paid. */
  async update(actor: Actor, id: string, input: UpdateInvoiceInput): Promise<InvoiceDto> {
    this.authz.assertPermission(actor, PERMISSIONS.BILLING_UPDATE);
    const inv = await this.loadOpen(actor, id, input.version);
    const totals = this.totals(input.items, input.discountAmount);
    const paid = toCents(money(inv.paidAmount));
    if (totals.total < paid) {
      throw new AppError(ERROR_CODES.TOTAL_BELOW_PAID, `The new total is less than the ${(paid / 100).toFixed(2)} already paid. Refund first.`, HttpStatus.CONFLICT);
    }
    await this.prisma.$transaction(async (tx) => {
      const status = invoiceStatusFor(totals.total / 100, paid / 100);
      const res = await tx.invoice.updateMany({
        where: { id, version: input.version, status: { not: 'VOID' } },
        data: {
          status,
          subtotal: dec(totals.subtotal),
          discountAmount: dec(totals.discount),
          discountPercent: input.discountAmount > 0 ? (input.discountPercent ?? null) : null,
          discountReason: input.discountAmount > 0 ? input.discountReason : null,
          total: dec(totals.total),
          dueAmount: dec(totals.total - paid),
          notes: input.notes,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceItem.createMany({ data: this.itemRows(input.items).map((r) => ({ ...r, invoiceId: id })) });
      await this.audit.record(
        actor,
        {
          action: 'invoice.updated',
          resourceType: 'invoice',
          resourceId: id,
          reason: input.reason,
          oldValue: {
            items: inv.items.map((i) => ({ type: i.type, description: i.description, quantity: i.quantity, unitPrice: money(i.unitPrice) })),
            discount: money(inv.discountAmount),
            total: money(inv.total),
          },
          newValue: { items: this.itemSummary(input.items), discount: totals.discount / 100, total: totals.total / 100 },
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async recordPayment(actor: Actor, id: string, input: RecordPaymentInput): Promise<InvoiceDto> {
    this.authz.assertPermission(actor, PERMISSIONS.BILLING_CREATE);
    const inv = await this.loadOpen(actor, id, input.version);
    await this.assertMethod(inv.chamberId, input.method);
    const due = toCents(money(inv.dueAmount));
    if (toCents(input.amount) > due) throw this.overpayment(due);
    await this.prisma.$transaction((tx) => this.applyPayment(tx, actor, inv, input));
    return this.get(actor, id);
  }

  /** Refunds are separate ledger entries (never edits of a payment) and require a reason. */
  async refund(actor: Actor, id: string, input: RefundInput): Promise<InvoiceDto> {
    this.authz.assertPermission(actor, PERMISSIONS.BILLING_REFUND);
    const inv = await this.loadOpen(actor, id, input.version);
    const paid = toCents(money(inv.paidAmount));
    const amount = toCents(input.amount);
    if (amount > paid) throw new AppError(ERROR_CODES.REFUND_EXCEEDS_PAID, `At most ${(paid / 100).toFixed(2)} can be refunded`, HttpStatus.CONFLICT);
    await this.prisma.$transaction(async (tx) => {
      const newPaid = paid - amount;
      const total = toCents(money(inv.total));
      const res = await tx.invoice.updateMany({
        where: { id, version: input.version, status: { not: 'VOID' } },
        data: {
          paidAmount: dec(newPaid),
          refundedAmount: dec(toCents(money(inv.refundedAmount)) + amount),
          dueAmount: dec(total - newPaid),
          status: invoiceStatusFor(total / 100, newPaid / 100),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      const receiptNumber = await this.nextNumber(tx, inv.chamberId, 'REFUND', 'RF');
      const p = await tx.payment.create({
        data: {
          invoiceId: id,
          chamberId: inv.chamberId,
          kind: 'REFUND',
          receiptNumber,
          amount: dec(amount),
          method: input.method,
          provider: input.provider,
          reference: input.reference,
          reason: input.reason,
          receivedById: actor.userId,
          receivedByName: actor.fullName,
          isDemo: inv.isDemo,
        },
      });
      await this.audit.record(
        actor,
        { action: 'payment.refunded', resourceType: 'invoice', resourceId: id, reason: input.reason, newValue: { receiptNumber, paymentId: p.id, amount: amount / 100, method: input.method } },
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** Voids a bill with no money on it (refund first). Void bills are frozen. */
  async void(actor: Actor, id: string, reason: string, version: number): Promise<InvoiceDto> {
    this.authz.assertPermission(actor, PERMISSIONS.BILLING_UPDATE);
    const inv = await this.loadOpen(actor, id, version);
    if (toCents(money(inv.paidAmount)) > 0) {
      throw new AppError(ERROR_CODES.INVOICE_HAS_PAYMENTS, 'Refund the payments before voiding this bill', HttpStatus.CONFLICT);
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.invoice.updateMany({
        where: { id, version, status: { not: 'VOID' } },
        data: { status: 'VOID', voidedAt: new Date(), voidedById: actor.userId, voidReason: reason, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      await this.audit.record(actor, { action: 'invoice.voided', resourceType: 'invoice', resourceId: id, reason, oldValue: { status: inv.status, total: money(inv.total) } }, tx);
    });
    return this.get(actor, id);
  }

  // ─────────────────────────── Reporting & printing ───────────────────────────

  /** Collections and dues for a period (the counter's day-end summary). */
  async summary(actor: Actor, q: BillingSummaryQuery): Promise<BillingSummaryDto> {
    const chamber = await this.chamber(actor);
    const start = zonedDayRange(q.from, chamber.timezone).start;
    const end = zonedDayRange(q.to, chamber.timezone).end;
    const byDoctor = q.doctorId ? Prisma.sql`AND i.doctor_id = ${q.doctorId}::uuid` : Prisma.empty;
    const [pay, inv, methods, doctors, collectors, open] = await Promise.all([
      this.prisma.$queryRaw<{ kind: string; amount: string | null; count: bigint }[]>`
        SELECT p.kind, sum(p.amount)::text AS amount, count(*) AS count
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.chamber_id = ${chamber.id}::uuid AND p.received_at >= ${start} AND p.received_at < ${end} ${byDoctor}
        GROUP BY p.kind`,
      this.prisma.$queryRaw<{ billed: string | null; discounts: string | null; count: bigint }[]>`
        SELECT sum(i.total)::text AS billed, sum(i.discount_amount)::text AS discounts, count(*) AS count
        FROM invoices i
        WHERE i.chamber_id = ${chamber.id}::uuid AND i.status <> 'VOID' AND i.issued_at >= ${start} AND i.issued_at < ${end} ${byDoctor}`,
      this.prisma.$queryRaw<{ method: string; amount: string; count: bigint }[]>`
        SELECT p.method::text AS method, sum(CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END)::text AS amount, count(*) FILTER (WHERE p.kind = 'PAYMENT') AS count
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.chamber_id = ${chamber.id}::uuid AND p.received_at >= ${start} AND p.received_at < ${end} ${byDoctor}
        GROUP BY p.method ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ doctor_id: string | null; billed: string | null; collected: string | null }[]>`
        SELECT doctor_id, sum(billed)::text AS billed, sum(collected)::text AS collected FROM (
          SELECT i.doctor_id, i.total AS billed, 0 AS collected FROM invoices i
          WHERE i.chamber_id = ${chamber.id}::uuid AND i.status <> 'VOID' AND i.issued_at >= ${start} AND i.issued_at < ${end} ${byDoctor}
          UNION ALL
          SELECT i.doctor_id, 0, CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.chamber_id = ${chamber.id}::uuid AND p.received_at >= ${start} AND p.received_at < ${end} ${byDoctor}
        ) x GROUP BY doctor_id`,
      this.prisma.$queryRaw<{ user_name: string | null; amount: string; count: bigint }[]>`
        SELECT p.received_by_name AS user_name, sum(CASE WHEN p.kind = 'REFUND' THEN -p.amount ELSE p.amount END)::text AS amount, count(*) AS count
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.chamber_id = ${chamber.id}::uuid AND p.received_at >= ${start} AND p.received_at < ${end} ${byDoctor}
        GROUP BY p.received_by_name ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ due: string | null; count: bigint }[]>`
        SELECT sum(i.due_amount)::text AS due, count(*) AS count FROM invoices i
        WHERE i.chamber_id = ${chamber.id}::uuid AND i.status IN ('UNPAID', 'PARTIALLY_PAID') ${byDoctor}`,
    ]);
    const names = new Map(
      (await this.prisma.doctor.findMany({ where: { id: { in: doctors.map((d) => d.doctor_id).filter((x): x is string => !!x) } }, select: { id: true, user: { select: { fullName: true } } } })).map((d) => [
        d.id,
        d.user.fullName,
      ]),
    );
    const payments = pay.find((p) => p.kind === 'PAYMENT');
    const refunds = pay.find((p) => p.kind === 'REFUND');
    const received = money(payments?.amount);
    const refunded = money(refunds?.amount);
    return {
      from: q.from,
      to: q.to,
      collected: (toCents(received) - toCents(refunded)) / 100,
      refunded,
      paymentsCount: Number(payments?.count ?? 0),
      billed: money(inv[0]?.billed),
      invoicesCount: Number(inv[0]?.count ?? 0),
      discounts: money(inv[0]?.discounts),
      byMethod: methods.map((m) => ({ method: m.method, amount: money(m.amount), count: Number(m.count) })),
      byDoctor: doctors
        .map((d) => ({ doctorId: d.doctor_id, doctorName: d.doctor_id ? (names.get(d.doctor_id) ?? null) : null, billed: money(d.billed), collected: money(d.collected) }))
        .sort((x, y) => y.billed - x.billed),
      byCollector: collectors.map((c) => ({ userName: c.user_name, amount: money(c.amount), count: Number(c.count) })),
      outstanding: money(open[0]?.due),
      outstandingCount: Number(open[0]?.count ?? 0),
    };
  }

  async printData(actor: Actor, id: string): Promise<InvoicePrintDto> {
    const inv = await this.load(actor, id);
    const [chamber, settings] = await Promise.all([
      this.prisma.chamber.findUniqueOrThrow({ where: { id: inv.chamberId }, select: { name: true, address: true, phone: true, email: true, timezone: true } }),
      this.settings.get(inv.chamberId),
    ]);
    const { version: _v, ...s } = settings;
    return { invoice: toInvoiceDto(inv), chamber, settings: s };
  }

  async logPrint(actor: Actor, id: string) {
    const inv = await this.load(actor, id);
    await this.audit.record(actor, { action: 'invoice.printed', resourceType: 'invoice', resourceId: id, newValue: { invoiceNumber: inv.invoiceNumber } });
    return { logged: true };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private totals(items: InvoiceItemInput[], discount: number) {
    const t = computeInvoiceTotals(items, discount);
    return { subtotal: toCents(t.subtotal), discount: toCents(t.discount), total: toCents(t.total) };
  }

  private itemRows(items: InvoiceItemInput[]) {
    return items.map((it, i) => ({
      type: it.type,
      description: it.description,
      quantity: it.quantity,
      unitPrice: dec(toCents(it.unitPrice)),
      amount: dec(toCents(it.unitPrice) * it.quantity),
      feeItemId: it.feeItemId ?? null,
      sortOrder: i,
    }));
  }

  private itemSummary(items: InvoiceItemInput[]) {
    return items.map((i) => ({ type: i.type, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice }));
  }

  private async applyPayment(tx: Tx, actor: Actor, inv: { id: string; chamberId: string; version: number; isDemo: boolean }, input: PaymentInput) {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, select: { total: true, paidAmount: true, version: true } });
    if (current.version !== inv.version) throw AppError.staleVersion();
    const total = toCents(money(current.total));
    const paid = toCents(money(current.paidAmount)) + toCents(input.amount);
    if (paid > total) throw this.overpayment(total - toCents(money(current.paidAmount)));
    const res = await tx.invoice.updateMany({
      where: { id: inv.id, version: inv.version, status: { not: 'VOID' } },
      data: { paidAmount: dec(paid), dueAmount: dec(total - paid), status: invoiceStatusFor(total / 100, paid / 100), version: { increment: 1 } },
    });
    if (res.count !== 1) throw AppError.staleVersion();
    const receiptNumber = await this.nextNumber(tx, inv.chamberId, 'RECEIPT', 'RCPT');
    const p = await tx.payment.create({
      data: {
        invoiceId: inv.id,
        chamberId: inv.chamberId,
        kind: 'PAYMENT',
        receiptNumber,
        amount: dec(toCents(input.amount)),
        method: input.method,
        provider: input.provider,
        reference: input.reference,
        note: input.note,
        receivedById: actor.userId,
        receivedByName: actor.fullName,
        isDemo: inv.isDemo,
      },
    });
    await this.audit.record(
      actor,
      { action: 'payment.recorded', resourceType: 'invoice', resourceId: inv.id, newValue: { receiptNumber, paymentId: p.id, amount: input.amount, method: input.method, provider: input.provider } },
      tx,
    );
  }

  private async assertMethod(chamberId: string, method: string) {
    const s = await this.settings.get(chamberId);
    if (!(s.enabledMethods as string[]).includes(method)) {
      throw new AppError(ERROR_CODES.PAYMENT_METHOD_DISABLED, 'This payment method is not enabled for the chamber', HttpStatus.UNPROCESSABLE_ENTITY, [{ path: 'method', message: 'validation.method_disabled' }]);
    }
  }

  private overpayment(dueCents: number) {
    return new AppError(ERROR_CODES.OVERPAYMENT, `The amount exceeds the due of ${(dueCents / 100).toFixed(2)}`, HttpStatus.UNPROCESSABLE_ENTITY, [{ path: 'amount', message: 'validation.amount_exceeds_due' }]);
  }

  private async nextNumber(tx: Tx, chamberId: string, kind: string, prefix: string): Promise<string> {
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO billing_sequences (chamber_id, kind, last_value) VALUES (${chamberId}::uuid, ${kind}, 1)
      ON CONFLICT (chamber_id, kind) DO UPDATE SET last_value = billing_sequences.last_value + 1
      RETURNING last_value`;
    return `${prefix}-${String(rows[0]!.last_value).padStart(6, '0')}`;
  }

  async load(actor: Actor, id: string): Promise<InvoiceRow> {
    const inv = await this.prisma.invoice.findFirst({ where: { id, ...this.authz.chamberScope(actor) }, include: invoiceInclude });
    if (!inv) throw AppError.notFound('Invoice');
    return inv;
  }

  private async loadOpen(actor: Actor, id: string, version: number): Promise<InvoiceRow> {
    const inv = await this.load(actor, id);
    if (inv.status === 'VOID') throw new AppError(ERROR_CODES.INVOICE_VOID, 'This bill has been voided', HttpStatus.CONFLICT);
    if (inv.version !== version) throw AppError.staleVersion();
    return inv;
  }

  static uniqueGuard(err: unknown): never {
    const text = err instanceof Error ? err.message : String(err);
    if (/invoices_one_per_appointment/.test(text)) throw new AppError(ERROR_CODES.INVOICE_EXISTS, 'This visit already has a bill', HttpStatus.CONFLICT);
    throw err;
  }
}


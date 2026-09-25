import { Prisma } from '@prisma/client';
import type { FeeItemDto, InvoiceDto, InvoiceSummaryDto, PaymentDto } from '@chamber/shared';

/** NUMERIC → number (two decimals). */
export const money = (d: Prisma.Decimal | number | string | null | undefined): number => (d === null || d === undefined ? 0 : Number(d));
/** cents → NUMERIC string for Prisma (never a float). */
export const dec = (cents: number): string => (cents / 100).toFixed(2);

export const invoiceSummaryInclude = {
  patient: { select: { id: true, patientCode: true, fullName: true, phone: true } },
  doctor: { select: { id: true, user: { select: { fullName: true } } } },
} satisfies Prisma.InvoiceInclude;
type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceSummaryInclude }>;

export function toInvoiceSummary(i: SummaryRow): InvoiceSummaryDto {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    status: i.status,
    patient: { id: i.patient.id, patientCode: i.patient.patientCode, fullName: i.patient.fullName, phone: i.patient.phone },
    doctor: i.doctor ? { id: i.doctor.id, fullName: i.doctor.user.fullName } : null,
    appointmentId: i.appointmentId,
    total: money(i.total),
    paid: money(i.paidAmount),
    due: i.status === 'VOID' ? 0 : money(i.dueAmount),
    issuedAt: i.issuedAt.toISOString(),
    createdByName: i.createdByName,
  };
}

export const invoiceInclude = {
  ...invoiceSummaryInclude,
  items: { orderBy: { sortOrder: 'asc' } },
  payments: { orderBy: { receivedAt: 'asc' } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function toPaymentDto(p: Prisma.PaymentGetPayload<object>): PaymentDto {
  return {
    id: p.id,
    kind: p.kind,
    receiptNumber: p.receiptNumber,
    amount: money(p.amount),
    method: p.method,
    provider: p.provider,
    reference: p.reference,
    note: p.note,
    reason: p.reason,
    receivedByName: p.receivedByName,
    receivedAt: p.receivedAt.toISOString(),
  };
}

export function toInvoiceDto(i: InvoiceRow): InvoiceDto {
  return {
    ...toInvoiceSummary(i),
    items: i.items.map((it) => ({
      id: it.id,
      type: it.type,
      description: it.description,
      quantity: it.quantity,
      unitPrice: money(it.unitPrice),
      amount: money(it.amount),
      feeItemId: it.feeItemId,
    })),
    subtotal: money(i.subtotal),
    discountAmount: money(i.discountAmount),
    discountPercent: i.discountPercent !== null ? money(i.discountPercent) : null,
    discountReason: i.discountReason,
    refunded: money(i.refundedAmount),
    notes: i.notes,
    payments: i.payments.map(toPaymentDto),
    voidedAt: i.voidedAt?.toISOString() ?? null,
    voidReason: i.voidReason,
    version: i.version,
  };
}

export function toFeeItemDto(f: Prisma.FeeItemGetPayload<object>): FeeItemDto {
  return { id: f.id, kind: f.kind, name: f.name, amount: money(f.amount), investigationId: f.investigationId, isActive: f.isActive };
}

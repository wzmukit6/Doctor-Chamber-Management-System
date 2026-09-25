import { z } from 'zod';
import { optionalText, requiredText, uuidSchema } from '../validation';

// ───────────── Billing & payments (spec §18) ─────────────

export const INVOICE_ITEM_TYPES = ['CONSULTATION', 'FOLLOW_UP', 'INVESTIGATION', 'PROCEDURE', 'OTHER'] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

export const INVOICE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_BANKING', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_KINDS = ['PAYMENT', 'REFUND'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const FEE_ITEM_KINDS = ['INVESTIGATION', 'PROCEDURE', 'OTHER'] as const;
export type FeeItemKind = (typeof FEE_ITEM_KINDS)[number];

/** Money as a number with at most two decimals (stored as NUMERIC(12,2)). */
export const moneySchema = z
  .number({ message: 'validation.number' })
  .min(0, 'validation.out_of_range')
  .max(9_999_999.99, 'validation.out_of_range')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'validation.money_decimals');

export const positiveMoneySchema = moneySchema.refine((v) => v > 0, 'validation.amount_positive');

/**
 * A payment reference (transaction ID, cheque number, last 4 card digits).
 * Full card numbers must never be stored (spec §18): any run of 12+ digits is rejected.
 */
export const paymentReferenceSchema = optionalText(100).refine((v) => !v || !/\d{12,}/.test(v.replace(/[\s-]/g, '')), 'validation.no_card_number');

export const invoiceItemSchema = z.object({
  type: z.enum(INVOICE_ITEM_TYPES),
  description: requiredText(200),
  quantity: z.number().int().min(1).max(100).default(1),
  unitPrice: moneySchema,
  feeItemId: uuidSchema.nullish(),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

const discountFields = {
  discountAmount: moneySchema.default(0),
  /** Informational: the percentage the discount was entered as. */
  discountPercent: z.number().min(0).max(100).nullish(),
  discountReason: optionalText(300),
};

function refineInvoice(v: { items: InvoiceItemInput[]; discountAmount: number; discountReason?: string | null }, ctx: z.RefinementCtx) {
  const { subtotal } = computeInvoiceTotals(v.items, 0);
  if (toCents(v.discountAmount) > toCents(subtotal)) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'validation.discount_exceeds' });
  if (v.discountAmount > 0 && !v.discountReason) ctx.addIssue({ code: 'custom', path: ['discountReason'], message: 'validation.required' });
}

export const paymentInputSchema = z.object({
  amount: positiveMoneySchema,
  method: z.enum(PAYMENT_METHODS),
  /** e.g. "bKash", "Nagad", "Visa" — from the chamber's configured list. */
  provider: optionalText(60),
  reference: paymentReferenceSchema,
  note: optionalText(300),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const createInvoiceSchema = z
  .object({
    patientId: uuidSchema,
    doctorId: uuidSchema.nullish(),
    appointmentId: uuidSchema.nullish(),
    items: z.array(invoiceItemSchema).min(1, 'validation.invoice_items').max(50),
    ...discountFields,
    notes: optionalText(500),
    /** Optional payment collected at the counter together with the bill. */
    payment: paymentInputSchema.nullish(),
  })
  .superRefine(refineInvoice);
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    items: z.array(invoiceItemSchema).min(1, 'validation.invoice_items').max(50),
    ...discountFields,
    notes: optionalText(500),
    /** Required: why an issued bill is changed (audited). */
    reason: requiredText(300),
    version: z.number().int().min(1),
  })
  .superRefine(refineInvoice);
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const recordPaymentSchema = paymentInputSchema.extend({ version: z.number().int().min(1) });
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const refundSchema = z.object({
  amount: positiveMoneySchema,
  method: z.enum(PAYMENT_METHODS),
  provider: optionalText(60),
  reference: paymentReferenceSchema,
  reason: requiredText(300),
  version: z.number().int().min(1),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const voidInvoiceSchema = z.object({ reason: requiredText(300), version: z.number().int().min(1) });

export const invoiceListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  patientId: uuidSchema.optional(),
  doctorId: uuidSchema.optional(),
  appointmentId: uuidSchema.optional(),
  /** Comma separated statuses; "OPEN" = unpaid or partially paid. */
  status: z.string().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const billingSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  doctorId: uuidSchema.optional(),
});
export type BillingSummaryQuery = z.infer<typeof billingSummaryQuerySchema>;

// ───────────── Fee schedule ─────────────

export const feeItemSchema = z.object({
  kind: z.enum(FEE_ITEM_KINDS),
  name: requiredText(200),
  amount: moneySchema,
  investigationId: uuidSchema.nullish(),
});
export type FeeItemInput = z.infer<typeof feeItemSchema>;

export const feeItemStatusSchema = z.object({ isActive: z.boolean() });

export const doctorFeesSchema = z.object({
  consultationFee: moneySchema.nullish(),
  followUpFee: moneySchema.nullish(),
  reportReviewFee: moneySchema.nullish(),
  version: z.number().int().min(1),
});
export type DoctorFeesInput = z.infer<typeof doctorFeesSchema>;

// ───────────── Settings ─────────────

export const billingSettingsSchema = z.object({
  currencySymbol: z.string().trim().min(1).max(5).default('৳'),
  /** Payment methods offered at the counter (locally configurable, spec §18). */
  enabledMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).default(['CASH', 'CARD', 'MOBILE_BANKING', 'BANK_TRANSFER', 'OTHER']),
  mobileProviders: z.array(z.string().trim().min(1).max(40)).max(10).default(['bKash', 'Nagad', 'Rocket']),
  cardProviders: z.array(z.string().trim().min(1).max(40)).max(10).default(['Visa', 'Mastercard', 'Amex']),
  receiptFooter: z.string().trim().max(300).default('Thank you. Please keep this receipt for your records.'),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
export const DEFAULT_BILLING_SETTINGS: BillingSettings = billingSettingsSchema.parse({});
export const updateBillingSettingsSchema = billingSettingsSchema.extend({ version: z.number().int().min(0) });
export type UpdateBillingSettingsInput = z.infer<typeof updateBillingSettingsSchema>;

// ───────────── Calculations (integer paisa/cents — never floating point) ─────────────

export const toCents = (v: number) => Math.round(v * 100);
export const fromCents = (c: number) => c / 100;

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  total: number;
}

export function computeInvoiceTotals(items: Pick<InvoiceItemInput, 'quantity' | 'unitPrice'>[], discountAmount: number): InvoiceTotals {
  const subtotal = items.reduce((sum, i) => sum + toCents(i.unitPrice) * (i.quantity ?? 1), 0);
  const discount = Math.min(toCents(discountAmount), subtotal);
  return { subtotal: fromCents(subtotal), discount: fromCents(discount), total: fromCents(subtotal - discount) };
}

/** Discount amount for a percentage of the subtotal, rounded to whole currency units. */
export function discountFromPercent(subtotal: number, percent: number): number {
  return Math.round((subtotal * percent) / 100);
}

/** Payment status from the bill total and the net amount paid (payments − refunds). */
export function invoiceStatusFor(total: number, paidNet: number): Exclude<InvoiceStatus, 'VOID'> {
  const t = toCents(total);
  const p = toCents(paidNet);
  if (p >= t) return 'PAID';
  return p > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}

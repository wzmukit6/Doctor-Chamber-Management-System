import { computeInvoiceTotals, createInvoiceSchema, discountFromPercent, invoiceStatusFor, moneySchema, paymentReferenceSchema } from '@chamber/shared';

const P = '11111111-1111-4111-8111-111111111111';

describe('billing rules', () => {
  it('totals are exact in paisa (no floating point drift)', () => {
    expect(computeInvoiceTotals([{ unitPrice: 0.1, quantity: 3 }, { unitPrice: 0.2, quantity: 1 }], 0)).toEqual({ subtotal: 0.5, discount: 0, total: 0.5 });
    expect(computeInvoiceTotals([{ unitPrice: 800, quantity: 1 }, { unitPrice: 400, quantity: 2 }], 150.5)).toEqual({ subtotal: 1600, discount: 150.5, total: 1449.5 });
    // A discount can never exceed the subtotal.
    expect(computeInvoiceTotals([{ unitPrice: 100, quantity: 1 }], 500).total).toBe(0);
  });

  it('percentage discounts round to whole currency units', () => {
    expect(discountFromPercent(1250, 10)).toBe(125);
    expect(discountFromPercent(999, 15)).toBe(150);
  });

  it('payment status follows total and net paid', () => {
    expect(invoiceStatusFor(1000, 0)).toBe('UNPAID');
    expect(invoiceStatusFor(1000, 0.01)).toBe('PARTIALLY_PAID');
    expect(invoiceStatusFor(1000, 1000)).toBe('PAID');
    expect(invoiceStatusFor(0, 0)).toBe('PAID'); // fully waived
  });

  it('money has at most two decimals and is not negative', () => {
    expect(moneySchema.safeParse(10.25).success).toBe(true);
    expect(moneySchema.safeParse(10.255).success).toBe(false);
    expect(moneySchema.safeParse(-1).success).toBe(false);
  });

  it('never accepts a full card number as a payment reference', () => {
    expect(paymentReferenceSchema.safeParse('4242 4242 4242 4242').success).toBe(false);
    expect(paymentReferenceSchema.safeParse('4242-4242-4242-4242').success).toBe(false);
    expect(paymentReferenceSchema.safeParse('•••• 4242').success).toBe(true);
    expect(paymentReferenceSchema.safeParse('TRX8K2M4Q').success).toBe(true);
  });

  it('bills need items; discounts need a reason and cannot exceed the subtotal', () => {
    const item = { type: 'CONSULTATION', description: 'Consultation', unitPrice: 800 };
    expect(createInvoiceSchema.safeParse({ patientId: P, items: [] }).success).toBe(false);
    const noReason = createInvoiceSchema.safeParse({ patientId: P, items: [item], discountAmount: 100 });
    expect(noReason.error?.issues[0]).toMatchObject({ path: ['discountReason'], message: 'validation.required' });
    const tooMuch = createInvoiceSchema.safeParse({ patientId: P, items: [item], discountAmount: 900, discountReason: 'x' });
    expect(tooMuch.error?.issues[0]).toMatchObject({ path: ['discountAmount'], message: 'validation.discount_exceeds' });
    expect(createInvoiceSchema.safeParse({ patientId: P, items: [item], discountAmount: 100, discountReason: 'Senior citizen' }).success).toBe(true);
  });
});

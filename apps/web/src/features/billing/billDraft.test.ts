import { billPayload, billTotals, itemDraft, type BillDraft } from './components/InvoiceItemsEditor';
import { formatAmount } from './money';

const draft = (patch: Partial<BillDraft> = {}): BillDraft => ({
  items: [itemDraft({ type: 'CONSULTATION', description: 'Consultation', unitPrice: 800 }), itemDraft({ type: 'INVESTIGATION', description: 'CBC', unitPrice: 400, quantity: 2 })],
  discountMode: 'amount',
  discountValue: '',
  discountReason: '',
  notes: '',
  ...patch,
});

describe('bill draft', () => {
  it('totals with amount and percentage discounts', () => {
    expect(billTotals(draft())).toMatchObject({ subtotal: 1600, discount: 0, total: 1600 });
    expect(billTotals(draft({ discountValue: '100' }))).toMatchObject({ discount: 100, total: 1500, discountPercent: null });
    expect(billTotals(draft({ discountMode: 'percent', discountValue: '10' }))).toMatchObject({ discount: 160, total: 1440, discountPercent: 10 });
    expect(billTotals(draft({ discountMode: 'percent', discountValue: '150' }))).toMatchObject({ total: 0, discountPercent: 100 });
  });

  it('builds the API payload', () => {
    const p = billPayload(draft({ discountValue: '100', discountReason: ' Senior ', notes: '  ' }));
    expect(p).toMatchObject({ discountAmount: 100, discountReason: 'Senior', notes: null });
    expect(p.items[1]).toEqual({ type: 'INVESTIGATION', description: 'CBC', quantity: 2, unitPrice: 400, feeItemId: null });
    expect(billPayload(draft({ discountReason: 'x' })).discountReason).toBeNull();
  });

  it('formats money with the currency symbol', () => {
    expect(formatAmount(1500, '৳', 'en')).toBe('৳1,500');
    expect(formatAmount(1449.5, '৳', 'en')).toBe('৳1,449.50');
    expect(formatAmount(-200, '৳', 'en')).toBe('− ৳200');
  });
});

import type { MedicineDto } from '@chamber/shared';
import { contentPayload, mergeAdvice, mergeRows, parseDuration, rowFromItem, rowFromMedicine, rowFromText, withQuantity } from './rx';

const medicine: MedicineDto = {
  id: '11111111-1111-4111-8111-111111111111',
  genericName: 'Paracetamol',
  brandName: null,
  manufacturer: null,
  form: 'TABLET',
  strength: '500 mg',
  category: null,
  route: null,
  defaultDose: '1 tab',
  commonFrequencies: ['1+1+1', 'SOS'],
  commonDurations: ['5 days'],
  keywords: null,
  isActive: true,
  isGlobal: true,
  isFavorite: false,
};

describe('prescription builder rows', () => {
  it('parses common durations', () => {
    expect(parseDuration('5 days')).toEqual([5, 'DAYS']);
    expect(parseDuration('1 month')).toEqual([1, 'MONTHS']);
    expect(parseDuration('2 Weeks')).toEqual([2, 'WEEKS']);
    expect(parseDuration('Continue')).toEqual([null, 'CONTINUE']);
    expect(parseDuration('as needed')).toEqual([null, null]);
  });

  it('pre-fills a picked medicine and calculates the quantity', () => {
    const r = rowFromMedicine(medicine);
    expect(r).toMatchObject({ name: 'Paracetamol', dose: '1 tab', frequency: '1+1+1', durationValue: '5', durationUnit: 'DAYS', route: 'ORAL', quantity: '15', quantityAuto: true });
    expect(withQuantity({ ...r, frequency: '1+0+1' }).quantity).toBe('10');
    // A typed quantity is kept when frequency changes.
    expect(withQuantity({ ...r, quantity: '20', quantityAuto: false, frequency: '1+0+0' }).quantity).toBe('20');
  });

  it('round-trips to the API payload', () => {
    const r = { ...rowFromMedicine(medicine), instructions: '  if fever  ' };
    const { items, advice } = contentPayload({ items: [r, { ...rowFromText('ORS'), durationUnit: 'CONTINUE', durationValue: '3' }], advice: '  ' });
    expect(advice).toBeNull();
    expect(items[0]).toMatchObject({ medicineId: medicine.id, durationValue: 5, quantity: 15, instructions: 'if fever', timing: null });
    expect(items[1]).toMatchObject({ name: 'ORS', durationValue: null, durationUnit: 'CONTINUE', quantity: null });
    expect(rowFromItem(items[0]!)).toMatchObject({ quantity: '15', quantityAuto: true });
  });

  it('merges without duplicates and appends advice once', () => {
    const a = rowFromMedicine(medicine);
    const [merged, skipped] = mergeRows([a], [rowFromMedicine(medicine), rowFromText('Omeprazole')]);
    expect(merged.map((r) => r.name)).toEqual(['Paracetamol', 'Omeprazole']);
    expect(skipped).toBe(1);
    expect(mergeAdvice('Rest', 'Fluids')).toBe('Rest\nFluids');
    expect(mergeAdvice('Rest\nFluids', 'Fluids')).toBe('Rest\nFluids');
    expect(mergeAdvice('', 'Fluids')).toBe('Fluids');
  });
});

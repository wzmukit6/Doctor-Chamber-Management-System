import {
  computeQuantity,
  formatMedicineName,
  medicineKey,
  prescriptionContentSchema,
  prescriptionTemplateSchema,
  sameGenericWarnings,
  unitsPerDay,
} from '@chamber/shared';
import { contentHash, itemRows } from './prescription-writer';

describe('prescription rules', () => {
  describe('unitsPerDay', () => {
    it('sums dose patterns including halves', () => {
      expect(unitsPerDay('1+0+1')).toBe(2);
      expect(unitsPerDay('1 + 1 + 1')).toBe(3);
      expect(unitsPerDay('1+1+1+1')).toBe(4);
      expect(unitsPerDay('½+0+½')).toBe(1);
      expect(unitsPerDay('0+0+2')).toBe(2);
    });
    it('understands named frequencies and multiplies by the dose', () => {
      expect(unitsPerDay('Twice daily')).toBe(2);
      expect(unitsPerDay('every 8 hours')).toBe(3);
      expect(unitsPerDay('Twice daily', '2 tab')).toBe(4);
      expect(unitsPerDay('Once weekly')).toBeCloseTo(1 / 7);
    });
    it('returns null for as-needed or unknown frequencies', () => {
      expect(unitsPerDay('SOS')).toBeNull();
      expect(unitsPerDay('when required')).toBeNull();
      expect(unitsPerDay('as advised')).toBeNull();
      expect(unitsPerDay(null)).toBeNull();
      expect(unitsPerDay('0+0+0')).toBeNull();
    });
  });

  describe('computeQuantity', () => {
    it('calculates countable forms: units per day × days', () => {
      expect(computeQuantity({ form: 'TABLET', frequency: '1+0+1', durationValue: 7, durationUnit: 'DAYS' })).toBe(14);
      expect(computeQuantity({ form: 'CAPSULE', frequency: '1+1+1', durationValue: 2, durationUnit: 'WEEKS' })).toBe(42);
      expect(computeQuantity({ form: 'TABLET', frequency: '0+0+1', durationValue: 1, durationUnit: 'MONTHS' })).toBe(30);
      expect(computeQuantity({ form: 'TABLET', frequency: '½+0+½', durationValue: 5, durationUnit: 'DAYS' })).toBe(5);
      expect(computeQuantity({ form: 'TABLET', frequency: 'Once weekly', durationValue: 4, durationUnit: 'WEEKS' })).toBe(4);
    });
    it('rounds partial units up', () => {
      expect(computeQuantity({ form: 'TABLET', frequency: '½+0+0', durationValue: 5, durationUnit: 'DAYS' })).toBe(3);
    });
    it('does not guess for liquids, SOS or continuing medicines', () => {
      expect(computeQuantity({ form: 'SYRUP', frequency: '1+1+1', durationValue: 5, durationUnit: 'DAYS' })).toBeNull();
      expect(computeQuantity({ form: 'TABLET', frequency: 'SOS', durationValue: 5, durationUnit: 'DAYS' })).toBeNull();
      expect(computeQuantity({ form: 'TABLET', frequency: '1+0+0', durationValue: null, durationUnit: 'CONTINUE' })).toBeNull();
      expect(computeQuantity({ form: null, frequency: '1+0+0', durationValue: 5, durationUnit: 'DAYS' })).toBeNull();
    });
  });

  describe('duplicate detection', () => {
    const para = { medicineId: null, name: 'Paracetamol', genericName: 'Paracetamol', strength: '500 mg' };
    it('rejects the exact same medicine twice', () => {
      const res = prescriptionContentSchema.safeParse({ items: [para, { ...para, name: 'paracetamol ' }] });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]?.message).toBe('validation.duplicate_medicine');
      expect(res.error?.issues[0]?.path).toEqual(['items', 1, 'name']);
    });
    it('allows different strengths but warns about the same generic', () => {
      const items = [para, { ...para, strength: '650 mg' }, { medicineId: null, name: 'Omeprazole', genericName: 'Omeprazole', strength: '20 mg' }];
      expect(prescriptionContentSchema.safeParse({ items }).success).toBe(true);
      expect(sameGenericWarnings(items)).toEqual([1]);
    });
    it('keys catalogue medicines by id', () => {
      expect(medicineKey({ medicineId: 'abc', name: 'X', strength: null })).toBe('abc');
      expect(medicineKey({ medicineId: null, name: ' Cetirizine ', strength: '10 mg' })).toBe('cetirizine|10 mg');
    });
    it('rejects a value with "continue" and a duration without unit', () => {
      const res = prescriptionContentSchema.safeParse({
        items: [
          { name: 'Metformin', durationValue: 5, durationUnit: 'CONTINUE' },
          { name: 'Amlodipine', durationValue: 5 },
        ],
      });
      expect(res.success).toBe(false);
      expect(res.error?.issues.map((i) => i.message)).toEqual(['validation.duration_continue', 'validation.required']);
    });
  });

  it('refuses empty templates', () => {
    expect(prescriptionTemplateSchema.safeParse({ name: 'Empty' }).success).toBe(false);
    expect(prescriptionTemplateSchema.safeParse({ name: 'Fever', advice: 'Plenty of fluids' }).success).toBe(true);
  });

  it('formats medicine names per chamber setting', () => {
    const brand = { name: 'Brandol', genericName: 'Paracetamol' };
    expect(formatMedicineName(brand)).toBe('Brandol (Paracetamol)');
    expect(formatMedicineName(brand, 'GENERIC_BRAND')).toBe('Paracetamol (Brandol)');
    expect(formatMedicineName(brand, 'GENERIC_ONLY')).toBe('Paracetamol');
    expect(formatMedicineName(brand, 'BRAND_ONLY')).toBe('Brandol');
    expect(formatMedicineName({ name: 'Paracetamol', genericName: 'Paracetamol' }, 'GENERIC_BRAND')).toBe('Paracetamol');
  });

  it('content hash is stable and changes with content', () => {
    const base = { rxNumber: 'RX-000001', versionNumber: 1, patientId: 'p', doctorId: 'd', advice: 'Rest', items: itemRows([{ name: 'Paracetamol', strength: '500 mg', frequency: '1+1+1' }]) };
    expect(contentHash(base)).toBe(contentHash({ ...base }));
    expect(contentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ ...base, advice: 'Rest well' })).not.toBe(contentHash(base));
    expect(contentHash({ ...base, versionNumber: 2 })).not.toBe(contentHash(base));
  });
});

import { computeBmi, parseBloodPressure } from '@chamber/shared';
import type { VitalDefinition } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { normalizeVitals, roundHalfUp } from './vitals';

const def = (over: Partial<VitalDefinition>): VitalDefinition =>
  ({
    id: 'd1',
    chamberId: null,
    key: 'weight',
    label: 'Weight',
    unit: 'kg',
    type: 'NUMBER',
    minValue: new Prisma.Decimal(0.5),
    maxValue: new Prisma.Decimal(350),
    decimals: 1,
    sortOrder: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as VitalDefinition;

describe('vitals', () => {
  it('rounds half-up without binary float surprises', () => {
    expect(roundHalfUp(72.35, 1)).toBe(72.4);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(98, 0)).toBe(98);
  });

  it('parses blood pressure and rejects implausible values', () => {
    expect(parseBloodPressure('120/80')).toEqual([120, 80]);
    expect(parseBloodPressure(' 140 / 90 ')).toEqual([140, 90]);
    expect(parseBloodPressure('80/120')).toBeNull();
    expect(parseBloodPressure('abc')).toBeNull();
  });

  it('computes BMI', () => {
    expect(computeBmi(70, 175)).toBe(22.9);
    expect(computeBmi(0, 175)).toBeNull();
  });

  it('normalizes values against definitions and reports field errors', () => {
    const defs = [def({}), def({ id: 'bp', key: 'bp', type: 'BLOOD_PRESSURE', minValue: null, maxValue: null, decimals: 0 })];
    expect(normalizeVitals([{ definitionId: 'd1', value: '72,35' }, { definitionId: 'bp', value: '120 / 80' }, { definitionId: 'd1', value: '' }], defs)).toEqual([
      { definitionId: 'd1', valueText: '72.4', valueNumber: 72.4, valueNumber2: null },
      { definitionId: 'bp', valueText: '120/80', valueNumber: 120, valueNumber2: 80 },
    ]);
    expect(() => normalizeVitals([{ definitionId: 'd1', value: '900' }], defs)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});

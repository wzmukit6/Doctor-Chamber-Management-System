import { Prisma } from '@prisma/client';
import { diff, sanitizeForAudit } from './sanitize';

describe('sanitizeForAudit', () => {
  it('strips secrets recursively and normalizes special types', () => {
    const out = sanitizeForAudit({
      email: 'a@b.c',
      passwordHash: 'secret',
      nested: { tokenHash: 'x', keep: 1 },
      at: new Date('2026-01-01T00:00:00.000Z'),
      fee: new Prisma.Decimal('800.50'),
      big: BigInt(5),
    });
    expect(out).toEqual({
      email: 'a@b.c',
      nested: { keep: 1 },
      at: '2026-01-01T00:00:00.000Z',
      fee: 800.5,
      big: '5',
    });
  });
});

describe('diff', () => {
  it('returns only changed keys and ignores bookkeeping fields', () => {
    const d = diff(
      { name: 'A', phone: '1', version: 1, updatedAt: new Date(1) },
      { name: 'B', phone: '1', version: 2, updatedAt: new Date(2) },
    );
    expect(d).toEqual({ oldValue: { name: 'A' }, newValue: { name: 'B' } });
  });
});

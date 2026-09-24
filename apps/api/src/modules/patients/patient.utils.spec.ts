import {
  ageFrom,
  dateFromQuery,
  escapeLike,
  estimatedDobFromAge,
  formatPatientCode,
  normalizePhoneForSearch,
  phoneDigitsFromQuery,
} from './patient.utils';

describe('patient utils', () => {
  it('normalizes Bangladeshi phone numbers to the local form', () => {
    expect(normalizePhoneForSearch('+8801711000000')).toBe('01711000000');
    expect(normalizePhoneForSearch('8801711000000')).toBe('01711000000');
    expect(normalizePhoneForSearch('01711-000000')).toBe('01711000000');
    expect(normalizePhoneForSearch('+441234567890')).toBe('441234567890');
    expect(normalizePhoneForSearch(null)).toBeNull();
  });

  it('detects phone-like search terms', () => {
    expect(phoneDigitsFromQuery('1711')).toBe('1711');
    expect(phoneDigitsFromQuery('+880 1711')).toBe('01711');
    expect(phoneDigitsFromQuery('rahim')).toBeNull();
    expect(phoneDigitsFromQuery('12')).toBeNull();
  });

  it('parses date search terms in common formats', () => {
    expect(dateFromQuery('1985-03-14')).toBe('1985-03-14');
    expect(dateFromQuery('14/03/1985')).toBe('1985-03-14');
    expect(dateFromQuery('4-3-1985')).toBe('1985-03-04');
    expect(dateFromQuery('31/02/1985')).toBeNull();
    expect(dateFromQuery('hello')).toBeNull();
  });

  it('computes age in completed years', () => {
    const today = new Date('2026-09-24T10:00:00Z');
    expect(ageFrom(new Date('1990-09-24T00:00:00Z'), today)).toBe(36);
    expect(ageFrom(new Date('1990-09-25T00:00:00Z'), today)).toBe(35);
    expect(ageFrom(null, today)).toBeNull();
  });

  it('estimates a date of birth from an age', () => {
    const today = new Date('2026-09-24T10:00:00Z');
    const dob = estimatedDobFromAge(40, today);
    expect(dob.toISOString().slice(0, 10)).toBe('1986-09-24');
    expect(ageFrom(dob, today)).toBe(40);
  });

  it('formats codes and escapes LIKE wildcards', () => {
    expect(formatPatientCode('DHN', 42)).toBe('DHN-00042');
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

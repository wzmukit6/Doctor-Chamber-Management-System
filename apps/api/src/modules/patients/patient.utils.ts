/**
 * Pure helpers for patient data. Kept framework-free so they are easy to unit test.
 */

/**
 * Digits-only local form used for phone search. Bangladeshi numbers are
 * normalized to the 11-digit local form so "+8801711000000", "8801711000000"
 * and "01711000000" all match each other.
 */
export function normalizePhoneForSearch(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('880') && digits.length >= 13) digits = `0${digits.slice(3)}`;
  return digits || null;
}

/** Converts a search term to phone digits when it looks like (part of) a phone number. */
export function phoneDigitsFromQuery(q: string): string | null {
  const compact = q.replace(/[\s\-()]/g, '');
  if (!/^\+?\d{3,15}$/.test(compact)) return null;
  let digits = compact.replace(/\D/g, '');
  if (digits.startsWith('880') && digits.length > 3) digits = `0${digits.slice(3)}`;
  return digits;
}

/** Parses YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY search terms into an ISO date string. */
export function dateFromQuery(q: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(q);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Completed years between the date of birth and `today`. */
export function ageFrom(dob: Date | null, today: Date = new Date()): number | null {
  if (!dob) return null;
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

/** Estimated date of birth for a patient who only knows their age: same day/month, N years ago. */
export function estimatedDobFromAge(ageYears: number, today: Date = new Date()): Date {
  const d = new Date(Date.UTC(today.getUTCFullYear() - ageYears, today.getUTCMonth(), today.getUTCDate()));
  return d;
}

export function formatPatientCode(chamberCode: string, sequence: number): string {
  return `${chamberCode}-${String(sequence).padStart(5, '0')}`;
}

/** Escapes LIKE/ILIKE wildcards in user input. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

import { z } from 'zod';

/**
 * Phone numbers: accepts local Bangladeshi mobile formats (01XXXXXXXXX)
 * and international E.164-like numbers (+8801XXXXXXXXX, +44...).
 */
export const PHONE_REGEX = /^(\+?[1-9]\d{7,14}|0\d{9,11})$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(PHONE_REGEX, 'validation.phone'));

export const emailSchema = z.string().trim().toLowerCase().email('validation.email').max(254);

export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
} as const;

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) issues.push('validation.password.min_length');
  if (password.length > PASSWORD_POLICY.maxLength) issues.push('validation.password.max_length');
  if (PASSWORD_POLICY.requireUpper && !/[A-Z]/.test(password)) issues.push('validation.password.upper');
  if (PASSWORD_POLICY.requireLower && !/[a-z]/.test(password)) issues.push('validation.password.lower');
  if (PASSWORD_POLICY.requireDigit && !/\d/.test(password)) issues.push('validation.password.digit');
  return issues;
}

export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const issue of passwordIssues(value)) ctx.addIssue({ code: 'custom', message: issue });
});

export const uuidSchema = z.string().uuid('validation.uuid');

/** Required non-empty trimmed text. */
export const requiredText = (max = 200) => z.string().trim().min(1, 'validation.required').max(max);

/** Optional text: empty strings become null so the DB never stores "". */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

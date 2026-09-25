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

/** Configurable policy (Settings → Security); defaults match PASSWORD_POLICY. */
export interface PasswordPolicyRules {
  passwordMinLength: number;
  passwordRequireUpper: boolean;
  passwordRequireLower: boolean;
  passwordRequireDigit: boolean;
  passwordRequireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyRules = {
  passwordMinLength: PASSWORD_POLICY.minLength,
  passwordRequireUpper: PASSWORD_POLICY.requireUpper,
  passwordRequireLower: PASSWORD_POLICY.requireLower,
  passwordRequireDigit: PASSWORD_POLICY.requireDigit,
  passwordRequireSymbol: false,
};

/** The absolute floor enforced by schemas; the configurable policy is checked on top by the server. */
export const PASSWORD_FLOOR = 8;

export function passwordIssues(password: string, policy: PasswordPolicyRules = DEFAULT_PASSWORD_POLICY): string[] {
  const issues: string[] = [];
  if (password.length < Math.max(policy.passwordMinLength, PASSWORD_FLOOR)) issues.push('validation.password.min_length');
  if (password.length > PASSWORD_POLICY.maxLength) issues.push('validation.password.max_length');
  if (policy.passwordRequireUpper && !/[A-Z]/.test(password)) issues.push('validation.password.upper');
  if (policy.passwordRequireLower && !/[a-z]/.test(password)) issues.push('validation.password.lower');
  if (policy.passwordRequireDigit && !/\d/.test(password)) issues.push('validation.password.digit');
  if (policy.passwordRequireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('validation.password.symbol');
  return issues;
}

/**
 * Structural check only (length floor/ceiling). The chamber-independent
 * platform policy (Settings → Security) is enforced by the server's
 * PasswordService, so an administrator can tighten or relax it at runtime.
 */
export const passwordSchema = z.string().superRefine((value, ctx) => {
  if (value.length < PASSWORD_FLOOR) ctx.addIssue({ code: 'custom', message: 'validation.password.min_length' });
  if (value.length > PASSWORD_POLICY.maxLength) ctx.addIssue({ code: 'custom', message: 'validation.password.max_length' });
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

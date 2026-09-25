import { z } from 'zod';
import { optionalText, uuidSchema } from '../validation';

// ───────────── Reports (spec §19, §33, §59) ─────────────

export const REPORT_GROUPS = ['operational', 'clinical', 'financial'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const REPORT_KEYS = [
  // operational — reports.view
  'appointments-daily',
  'no-show-rate',
  'patient-registrations',
  'queue-stats',
  'patient-list',
  'appointment-list',
  // clinical — reports.clinical
  'patients-seen',
  'consultations-daily',
  'diagnosis-stats',
  'prescription-stats',
  'follow-up-stats',
  'doctor-activity',
  'consultation-list',
  'prescription-history',
  // financial — reports.financial
  'revenue-daily',
  'revenue-monthly',
  'revenue-by-doctor',
  'payment-methods',
  'outstanding-dues',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');

export const reportQuerySchema = z
  .object({
    from: date,
    to: date,
    doctorId: uuidSchema.optional(),
    /** Super admin only: limit to one chamber (default: all chambers when signed in without one). */
    chamberId: uuidSchema.optional(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'], message: 'validation.end_after_start' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { path: ['to'], message: 'validation.range_too_large' });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const dashboardQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });

// ───────────── Chamber profile, doctor profile, security (spec §34) ─────────────

/** Small inline images (logo, signature) as data URLs: PNG/JPEG/WebP, ≤ 300 KB. */
export const IMAGE_DATA_URL_MAX = 400_000; // characters (≈ 300 KB binary)
export const imageDataUrlSchema = z
  .string()
  .max(IMAGE_DATA_URL_MAX, 'validation.image_too_large')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'validation.image_type')
  .nullish();

export const openingHoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      closed: z.boolean().default(false),
      open: z.string().regex(/^\d{2}:\d{2}$/, 'validation.time').nullish(),
      close: z.string().regex(/^\d{2}:\d{2}$/, 'validation.time').nullish(),
    }),
  )
  .max(7)
  .superRefine((rows, ctx) => {
    rows.forEach((r, i) => {
      if (!r.closed && (!r.open || !r.close)) ctx.addIssue({ code: 'custom', path: [i, 'open'], message: 'validation.required' });
      if (!r.closed && r.open && r.close && r.open >= r.close) ctx.addIssue({ code: 'custom', path: [i, 'close'], message: 'validation.end_after_start' });
    });
  });

export const chamberProfileSchema = z.object({
  logoDataUrl: imageDataUrlSchema,
  tagline: z.string().trim().max(150).default(''),
  openingHours: openingHoursSchema.default([]),
  /** Free-text note shown under the opening hours (e.g. "Closed on public holidays"). */
  hoursNote: z.string().trim().max(200).default(''),
});
export type ChamberProfile = z.infer<typeof chamberProfileSchema>;
export const DEFAULT_CHAMBER_PROFILE: ChamberProfile = chamberProfileSchema.parse({});
export const updateChamberProfileSchema = chamberProfileSchema.extend({ version: z.number().int().min(0) });
export type UpdateChamberProfileInput = z.infer<typeof updateChamberProfileSchema>;

export const doctorSelfProfileSchema = z.object({
  qualifications: optionalText(300),
  specialty: optionalText(150),
  registrationNo: optionalText(80),
  bio: optionalText(1000),
  signatureDataUrl: imageDataUrlSchema,
  /** Printed at the bottom of this doctor's prescriptions (in addition to the chamber footer). */
  prescriptionFooter: optionalText(300),
  version: z.number().int().min(1),
});
export type DoctorSelfProfileInput = z.infer<typeof doctorSelfProfileSchema>;

export const securitySettingsSchema = z.object({
  passwordMinLength: z.number().int().min(8).max(64).default(10),
  passwordRequireUpper: z.boolean().default(true),
  passwordRequireLower: z.boolean().default(true),
  passwordRequireDigit: z.boolean().default(true),
  passwordRequireSymbol: z.boolean().default(false),
  sessionIdleMinutes: z.number().int().min(5).max(480).default(30),
  sessionAbsoluteHours: z.number().int().min(1).max(72).default(12),
  loginMaxFailedAttempts: z.number().int().min(3).max(20).default(5),
  loginLockoutMinutes: z.number().int().min(1).max(1440).default(15),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;
export const updateSecuritySettingsSchema = securitySettingsSchema.extend({ version: z.number().int().min(0) });
export type UpdateSecuritySettingsInput = z.infer<typeof updateSecuritySettingsSchema>;

export type PasswordPolicy = Pick<SecuritySettings, 'passwordMinLength' | 'passwordRequireUpper' | 'passwordRequireLower' | 'passwordRequireDigit' | 'passwordRequireSymbol'>;

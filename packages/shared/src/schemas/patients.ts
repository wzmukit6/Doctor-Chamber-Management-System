import { z } from 'zod';
import { emailSchema, optionalText, phoneSchema, requiredText, uuidSchema } from '../validation';
import { paginationQuerySchema } from '../api';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const ALLERGY_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN'] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

/** YYYY-MM-DD, not in the future, not before 1900. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'validation.date')
  .refine((v) => v >= '1900-01-01', 'validation.date_too_old')
  .refine((v) => v <= new Date().toISOString().slice(0, 10), 'validation.date_future');

const emergencyContactSchema = z.object({
  name: requiredText(150),
  relation: optionalText(60),
  phone: phoneSchema,
});
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

/**
 * Demographic fields (spec §5 "Basic Information"). Either a date of birth or
 * an age in years must be given — many patients only know their approximate age;
 * the server then stores an estimated date of birth flagged as such.
 */
const demographicsShape = {
  fullName: requiredText(150),
  gender: z.enum(GENDERS, { message: 'validation.required' }),
  dateOfBirth: dateOnlySchema.nullish(),
  ageYears: z.number().int().min(0).max(130).nullish(),
  bloodGroup: z.enum(BLOOD_GROUPS).nullish(),
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  address: optionalText(500),
  occupation: optionalText(100),
  nationality: optionalText(60),
  emergencyContacts: z.array(emergencyContactSchema).max(3).default([]),
};

const requireDobOrAge = (v: { dateOfBirth?: string | null; ageYears?: number | null }) =>
  !!v.dateOfBirth || (v.ageYears !== null && v.ageYears !== undefined);

export const allergyInputSchema = z.object({
  allergen: requiredText(120),
  reaction: optionalText(200),
  severity: z.enum(ALLERGY_SEVERITIES).default('UNKNOWN'),
});
export type AllergyInput = z.infer<typeof allergyInputSchema>;

/** Medical information (spec §5). Requires `patients.update_medical`. */
export const medicalHistorySchema = z.object({
  existingConditions: optionalText(2000),
  previousSurgeries: optionalText(2000),
  currentMedications: optionalText(2000),
  relevantHistory: optionalText(4000),
  familyHistory: optionalText(2000),
  lifestyle: optionalText(2000),
});
export type MedicalHistoryInput = z.infer<typeof medicalHistorySchema>;

export const createPatientSchema = z
  .object({
    ...demographicsShape,
    /** Optional medical information captured at registration (needs `patients.update_medical`). */
    medicalHistory: medicalHistorySchema.optional(),
    allergies: z.array(allergyInputSchema).max(30).optional(),
    /** Set after the user reviewed the possible-duplicate warning. */
    allowDuplicate: z.boolean().default(false),
  })
  .refine(requireDobOrAge, { path: ['dateOfBirth'], message: 'validation.dob_or_age' });
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = z
  .object({ ...demographicsShape, version: z.number().int().min(1) })
  .refine(requireDobOrAge, { path: ['dateOfBirth'], message: 'validation.dob_or_age' });
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const updateMedicalHistorySchema = medicalHistorySchema.extend({ version: z.number().int().min(0) });
export type UpdateMedicalHistoryInput = z.infer<typeof updateMedicalHistorySchema>;

export const patientListQuerySchema = paginationQuerySchema.extend({
  gender: z.enum(GENDERS).optional(),
  registeredFrom: dateOnlySchema.optional(),
  registeredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

export const patientSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const duplicateCheckSchema = z.object({
  fullName: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(20).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  excludeId: uuidSchema.optional(),
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const TIMELINE_TYPES = [
  'registration',
  'record',
  'appointment',
  'consultation',
  'diagnosis',
  'prescription',
  'investigation',
  'payment',
  'follow_up',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

export const timelineQuerySchema = z.object({
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(TIMELINE_TYPES))),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

import { z } from 'zod';
import { optionalText, requiredText, uuidSchema } from '../validation';
import { prescriptionContentSchema } from './prescriptions';

export const CONSULTATION_STATUSES = ['DRAFT', 'FINALIZED', 'CANCELLED'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export const DIAGNOSIS_CERTAINTIES = ['CONFIRMED', 'PROVISIONAL', 'DIFFERENTIAL'] as const;
export type DiagnosisCertainty = (typeof DIAGNOSIS_CERTAINTIES)[number];

export const INVESTIGATION_PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;
export type InvestigationPriority = (typeof INVESTIGATION_PRIORITIES)[number];

export const VITAL_TYPES = ['NUMBER', 'BLOOD_PRESSURE', 'TEXT'] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

/** A recorded vital. BLOOD_PRESSURE values use "120/80"; NUMBER values are decimal strings. */
export const vitalValueSchema = z.object({
  definitionId: uuidSchema,
  value: z.string().trim().max(40),
});
export type VitalValueInput = z.infer<typeof vitalValueSchema>;

export const complaintItemSchema = z.object({
  complaintId: uuidSchema.nullish(),
  text: requiredText(200),
  duration: optionalText(60),
  note: optionalText(300),
});

export const diagnosisItemSchema = z.object({
  diagnosisId: uuidSchema.nullish(),
  /** Free-text diagnosis when not in the catalogue. */
  name: requiredText(200),
  code: optionalText(20),
  isPrimary: z.boolean().default(false),
  certainty: z.enum(DIAGNOSIS_CERTAINTIES).default('CONFIRMED'),
  note: optionalText(300),
});

export const investigationItemSchema = z.object({
  investigationId: uuidSchema.nullish(),
  name: requiredText(200),
  instructions: optionalText(300),
  priority: z.enum(INVESTIGATION_PRIORITIES).default('ROUTINE'),
});

/**
 * Full consultation draft (spec §9). The client autosaves the whole document;
 * child lists replace the previous ones. `version` provides optimistic locking.
 */
export const saveConsultationSchema = z
  .object({
    complaints: z.array(complaintItemSchema).max(30).default([]),
    presentIllness: optionalText(4000),
    pastHistory: optionalText(4000),
    familyHistory: optionalText(2000),
    medicationHistory: optionalText(2000),
    otherHistory: optionalText(2000),
    vitals: z.array(vitalValueSchema).max(40).default([]),
    examinationNotes: optionalText(4000),
    diagnoses: z.array(diagnosisItemSchema).max(20).default([]),
    investigations: z.array(investigationItemSchema).max(40).default([]),
    /** Doctor-only private notes (visible with `clinical_notes.view`). */
    clinicalNotes: optionalText(4000),
    followUpDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')
      .nullish(),
    followUpInstructions: optionalText(500),
    /** The consultation's prescription draft (version 1); omitted = unchanged. */
    prescription: prescriptionContentSchema.optional(),
    version: z.number().int().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.diagnoses.filter((d) => d.isPrimary).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['diagnoses'], message: 'validation.one_primary' });
    }
    const seen = new Set<string>();
    v.diagnoses.forEach((d, i) => {
      const key = (d.diagnosisId ?? d.name).toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['diagnoses', i, 'name'], message: 'validation.duplicate_item' });
      seen.add(key);
    });
    const inv = new Set<string>();
    v.investigations.forEach((d, i) => {
      const key = (d.investigationId ?? d.name).toLowerCase();
      if (inv.has(key)) ctx.addIssue({ code: 'custom', path: ['investigations', i, 'name'], message: 'validation.duplicate_item' });
      inv.add(key);
    });
    const vit = new Set<string>();
    v.vitals.forEach((d, i) => {
      if (vit.has(d.definitionId)) ctx.addIssue({ code: 'custom', path: ['vitals', i, 'value'], message: 'validation.duplicate_item' });
      vit.add(d.definitionId);
    });
  });
export type SaveConsultationInput = z.infer<typeof saveConsultationSchema>;

export const startConsultationSchema = z.object({
  patientId: uuidSchema,
  /** Optional; if omitted, today's waiting appointment of this doctor for the patient is used. */
  appointmentId: uuidSchema.nullish(),
});
export type StartConsultationInput = z.infer<typeof startConsultationSchema>;

export const finalizeConsultationSchema = z.object({ version: z.number().int().min(1) });
export const cancelConsultationSchema = z.object({ reason: requiredText(500), version: z.number().int().min(1) });
export const addendumSchema = z.object({ text: requiredText(4000) });

/** Vitals recorded before the consultation (e.g. by an assistant at check-in). */
export const recordVitalsSchema = z.object({ vitals: z.array(vitalValueSchema).min(1).max(40) });
export type RecordVitalsInput = z.infer<typeof recordVitalsSchema>;

export const consultationListQuerySchema = z.object({
  patientId: uuidSchema.optional(),
  doctorId: uuidSchema.optional(),
  status: z.enum(CONSULTATION_STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ConsultationListQuery = z.infer<typeof consultationListQuerySchema>;

// ───────────── Catalogues (spec §16, §17) ─────────────

export const catalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  scope: z.enum(['all', 'global', 'chamber']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const diagnosisCatalogSchema = z.object({
  name: requiredText(200),
  code: optionalText(20),
  codeSystem: z.string().trim().max(20).default('ICD-10'),
  category: optionalText(100),
  description: optionalText(1000),
  keywords: optionalText(300),
  /** Create as a platform-wide entry (super admin only). */
  global: z.boolean().default(false),
});
export type DiagnosisCatalogInput = z.infer<typeof diagnosisCatalogSchema>;

export const investigationCatalogSchema = z.object({
  name: requiredText(200),
  shortName: optionalText(40),
  category: optionalText(100),
  sampleType: optionalText(60),
  instructions: optionalText(500),
  global: z.boolean().default(false),
});
export type InvestigationCatalogInput = z.infer<typeof investigationCatalogSchema>;

export const complaintCatalogSchema = z.object({
  name: requiredText(200),
  global: z.boolean().default(false),
});
export type ComplaintCatalogInput = z.infer<typeof complaintCatalogSchema>;

export const catalogStatusSchema = z.object({ isActive: z.boolean() });

export const vitalDefinitionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'validation.slug'),
    label: requiredText(60),
    unit: optionalText(20),
    type: z.enum(VITAL_TYPES),
    minValue: z.number().nullish(),
    maxValue: z.number().nullish(),
    decimals: z.number().int().min(0).max(3).default(0),
    sortOrder: z.number().int().min(0).max(1000).default(100),
  })
  .refine((v) => v.minValue === null || v.minValue === undefined || v.maxValue === null || v.maxValue === undefined || v.minValue < v.maxValue, {
    path: ['maxValue'],
    message: 'validation.max_gt_min',
  });
export type VitalDefinitionInput = z.infer<typeof vitalDefinitionSchema>;

/** Parses "120/80" → [120, 80]; returns null if invalid. */
export function parseBloodPressure(value: string): [number, number] | null {
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(value);
  if (!m) return null;
  const sys = Number(m[1]);
  const dia = Number(m[2]);
  if (sys < 50 || sys > 300 || dia < 20 || dia > 200 || dia >= sys) return null;
  return [sys, dia];
}

/** BMI from weight (kg) and height (cm), one decimal. */
export function computeBmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

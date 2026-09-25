import { z } from 'zod';
import { optionalText, requiredText, uuidSchema } from '../validation';

// ───────────── Medicine master data (spec §15) ─────────────

export const MEDICINE_FORMS = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'SUSPENSION',
  'DROPS',
  'INJECTION',
  'INHALER',
  'NEBULIZER_SOLUTION',
  'CREAM',
  'OINTMENT',
  'GEL',
  'LOTION',
  'EYE_DROPS',
  'EAR_DROPS',
  'NASAL_SPRAY',
  'SACHET',
  'SUPPOSITORY',
  'MOUTHWASH',
  'OTHER',
] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];

export const MEDICINE_ROUTES = ['ORAL', 'TOPICAL', 'INHALATION', 'IV', 'IM', 'SC', 'SUBLINGUAL', 'NASAL', 'OPHTHALMIC', 'OTIC', 'RECTAL', 'VAGINAL', 'OTHER'] as const;
export type MedicineRoute = (typeof MEDICINE_ROUTES)[number];

export const MEAL_INSTRUCTIONS = ['BEFORE_MEAL', 'AFTER_MEAL', 'WITH_MEAL', 'EMPTY_STOMACH', 'BEDTIME'] as const;
export type MealInstruction = (typeof MEAL_INSTRUCTIONS)[number];

export const DURATION_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'CONTINUE'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

/** Forms counted in units (tablets, capsules…) — quantity can be calculated. */
export const COUNTABLE_FORMS: readonly MedicineForm[] = ['TABLET', 'CAPSULE', 'SACHET', 'SUPPOSITORY'];

/** Default route for a dosage form (the doctor can change it). */
export const DEFAULT_ROUTE_BY_FORM: Partial<Record<MedicineForm, MedicineRoute>> = {
  TABLET: 'ORAL',
  CAPSULE: 'ORAL',
  SYRUP: 'ORAL',
  SUSPENSION: 'ORAL',
  DROPS: 'ORAL',
  SACHET: 'ORAL',
  MOUTHWASH: 'ORAL',
  INHALER: 'INHALATION',
  NEBULIZER_SOLUTION: 'INHALATION',
  CREAM: 'TOPICAL',
  OINTMENT: 'TOPICAL',
  GEL: 'TOPICAL',
  LOTION: 'TOPICAL',
  EYE_DROPS: 'OPHTHALMIC',
  EAR_DROPS: 'OTIC',
  NASAL_SPRAY: 'NASAL',
  SUPPOSITORY: 'RECTAL',
};

/** Common dose patterns (morning + noon + night) offered as one-click chips. */
export const DOSE_PATTERNS = ['1+0+1', '1+0+0', '0+0+1', '1+1+1', '0+1+0', '1+1+1+1', '½+0+½'] as const;

/** Named frequencies with their number of intakes per day (null = not calculable). */
export const NAMED_FREQUENCIES: Record<string, number | null> = {
  'once daily': 1,
  'twice daily': 2,
  'thrice daily': 3,
  'four times daily': 4,
  'every 6 hours': 4,
  'every 8 hours': 3,
  'every 12 hours': 2,
  'at night': 1,
  'in the morning': 1,
  'once weekly': 1 / 7,
  'when required': null,
  sos: null,
};

const medicineStrings = (max: number) => z.array(z.string().trim().min(1).max(60)).max(max).default([]);

export const medicineSchema = z.object({
  genericName: requiredText(200),
  brandName: optionalText(200),
  manufacturer: optionalText(150),
  form: z.enum(MEDICINE_FORMS),
  strength: optionalText(80),
  category: optionalText(100),
  route: z.enum(MEDICINE_ROUTES).nullish(),
  defaultDose: optionalText(60),
  commonFrequencies: medicineStrings(8),
  commonDurations: medicineStrings(8),
  keywords: optionalText(300),
  /** Create as a platform-wide entry (requires `medicines.manage_global`). */
  global: z.boolean().default(false),
});
export type MedicineInput = z.infer<typeof medicineSchema>;

export const medicineQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  form: z.enum(MEDICINE_FORMS).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  scope: z.enum(['all', 'global', 'chamber', 'favorites']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MedicineQuery = z.infer<typeof medicineQuerySchema>;

export const medicineStatusSchema = z.object({ isActive: z.boolean() });

// ───────────── Prescription items (spec §9 "Medicines", §10) ─────────────

export const prescriptionItemSchema = z.object({
  medicineId: uuidSchema.nullish(),
  /** Display name as written (brand or generic); snapshot of the medicine at the time. */
  name: requiredText(200),
  genericName: optionalText(200),
  strength: optionalText(80),
  form: z.enum(MEDICINE_FORMS).nullish(),
  dose: optionalText(60),
  frequency: optionalText(60),
  route: z.enum(MEDICINE_ROUTES).nullish(),
  durationValue: z.number().int().min(1).max(365).nullish(),
  durationUnit: z.enum(DURATION_UNITS).nullish(),
  quantity: z.number().int().min(1).max(9999).nullish(),
  mealInstruction: z.enum(MEAL_INSTRUCTIONS).nullish(),
  timing: optionalText(100),
  instructions: optionalText(300),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;
/** Loose item shape (all optional fields may be omitted). */
export type PrescriptionItemLike = z.input<typeof prescriptionItemSchema>;

/** Identity used for exact-duplicate detection. */
export function medicineKey(item: Pick<PrescriptionItemLike, 'medicineId' | 'name' | 'strength'>): string {
  return item.medicineId ?? `${item.name.trim().toLowerCase()}|${(item.strength ?? '').trim().toLowerCase()}`;
}

/** Exact duplicates are errors; the same generic twice is only a warning (see `sameGenericWarnings`). */
export function refineItems(items: PrescriptionItemInput[], ctx: z.RefinementCtx, path: (string | number)[]) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const key = medicineKey(item);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [...path, i, 'name'], message: 'validation.duplicate_medicine' });
    seen.add(key);
    if (item.durationUnit === 'CONTINUE' && item.durationValue) {
      ctx.addIssue({ code: 'custom', path: [...path, i, 'durationValue'], message: 'validation.duration_continue' });
    }
    if (item.durationValue && !item.durationUnit) {
      ctx.addIssue({ code: 'custom', path: [...path, i, 'durationUnit'], message: 'validation.required' });
    }
  });
}

/** Indexes of items whose generic name repeats an earlier item (possible duplicate therapy). */
export function sameGenericWarnings(items: Pick<PrescriptionItemLike, 'genericName' | 'medicineId' | 'name' | 'strength'>[]): number[] {
  const byGeneric = new Map<string, string>();
  const out: number[] = [];
  items.forEach((item, i) => {
    const g = item.genericName?.trim().toLowerCase();
    if (!g) return;
    const key = medicineKey(item);
    const prev = byGeneric.get(g);
    if (prev !== undefined && prev !== key) out.push(i);
    else byGeneric.set(g, key);
  });
  return out;
}

export const prescriptionContentSchema = z
  .object({
    items: z.array(prescriptionItemSchema).max(40).default([]),
    advice: optionalText(2000),
  })
  .superRefine((v, ctx) => refineItems(v.items, ctx, ['items']));
export type PrescriptionContentInput = z.infer<typeof prescriptionContentSchema>;

/** Saving a revision draft (optimistic locking on the prescription's `version`). */
export const savePrescriptionDraftSchema = z
  .object({
    items: z.array(prescriptionItemSchema).max(40).default([]),
    advice: optionalText(2000),
    version: z.number().int().min(1),
  })
  .superRefine((v, ctx) => refineItems(v.items, ctx, ['items']));
export type SavePrescriptionDraftInput = z.infer<typeof savePrescriptionDraftSchema>;

export const startRevisionSchema = z.object({ reason: requiredText(500), version: z.number().int().min(1) });
export const prescriptionVersionActionSchema = z.object({ version: z.number().int().min(1) });
export const printPrescriptionSchema = z.object({ versionNumber: z.number().int().min(1) });

export const PRESCRIPTION_STATUSES = ['DRAFT', 'FINALIZED', 'REVISED', 'CANCELLED'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];
export const PRESCRIPTION_VERSION_STATUSES = ['DRAFT', 'FINALIZED', 'SUPERSEDED', 'DISCARDED'] as const;
export type PrescriptionVersionStatus = (typeof PRESCRIPTION_VERSION_STATUSES)[number];

export const prescriptionListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  patientId: uuidSchema.optional(),
  doctorId: uuidSchema.optional(),
  status: z.enum(PRESCRIPTION_STATUSES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PrescriptionListQuery = z.infer<typeof prescriptionListQuerySchema>;

// ───────────── Settings (spec §34 "Prescription Settings") ─────────────

export const MEDICINE_NAME_FORMATS = ['BRAND_GENERIC', 'GENERIC_BRAND', 'BRAND_ONLY', 'GENERIC_ONLY'] as const;
export type MedicineNameFormat = (typeof MEDICINE_NAME_FORMATS)[number];

export const prescriptionSettingsSchema = z.object({
  pageFormat: z.enum(['A4', 'A5']).default('A4'),
  /** Language of printed labels ("Rx", "Advice", "Follow-up"). Content stays as written. */
  language: z.enum(['en', 'bn']).default('en'),
  medicineNameFormat: z.enum(MEDICINE_NAME_FORMATS).default('BRAND_GENERIC'),
  showQr: z.boolean().default(true),
  showClinicalSection: z.boolean().default(true),
  showSignatureLine: z.boolean().default(true),
  headerNote: z.string().trim().max(200).default(''),
  defaultAdvice: z.string().trim().max(2000).default(''),
  footerText: z.string().trim().max(300).default(''),
});
export type PrescriptionSettings = z.infer<typeof prescriptionSettingsSchema>;
export const DEFAULT_PRESCRIPTION_SETTINGS: PrescriptionSettings = prescriptionSettingsSchema.parse({});

export const updatePrescriptionSettingsSchema = prescriptionSettingsSchema.extend({ version: z.number().int().min(0) });
export type UpdatePrescriptionSettingsInput = z.infer<typeof updatePrescriptionSettingsSchema>;

// ───────────── Helpers ─────────────

/** Units per day from a dose pattern ("1+0+1", "½+0+½") or a named frequency; null if unknown. */
export function unitsPerDay(frequency: string | null | undefined, dose?: string | null): number | null {
  if (!frequency) return null;
  const f = frequency.trim().toLowerCase();
  if (/^[0-9½¼.]+(\s*\+\s*[0-9½¼.]+){1,5}$/.test(f)) {
    const total = f.split('+').reduce((sum, part) => {
      const p = part.trim().replace('½', '.5').replace('¼', '.25');
      return sum + Number(p.startsWith('.') ? `0${p}` : p);
    }, 0);
    return Number.isFinite(total) && total > 0 ? total : null;
  }
  const perDay = NAMED_FREQUENCIES[f];
  if (perDay === undefined || perDay === null) return null;
  // "2 tab" twice daily → 4 units per day.
  const doseUnits = dose ? Number(/^\s*(\d+(?:\.\d+)?)/.exec(dose)?.[1] ?? 1) : 1;
  return perDay * (doseUnits > 0 ? doseUnits : 1);
}

export function durationDays(value: number | null | undefined, unit: DurationUnit | null | undefined): number | null {
  if (!value || !unit || unit === 'CONTINUE') return null;
  return value * (unit === 'WEEKS' ? 7 : unit === 'MONTHS' ? 30 : 1);
}

/**
 * Automatic quantity (spec §10) for countable forms: units per day × days, rounded up.
 * Returns null when it cannot be calculated (liquids, SOS, "continue").
 */
export function computeQuantity(item: Pick<PrescriptionItemLike, 'form' | 'frequency' | 'dose' | 'durationValue' | 'durationUnit'>): number | null {
  if (!item.form || !COUNTABLE_FORMS.includes(item.form)) return null;
  const perDay = unitsPerDay(item.frequency, item.dose);
  const days = durationDays(item.durationValue, item.durationUnit);
  if (perDay === null || days === null) return null;
  const qty = Math.ceil(perDay * days - 1e-9);
  return qty > 0 && qty <= 9999 ? qty : null;
}

/** Medicine name as printed, following the chamber's display format. */
export function formatMedicineName(
  item: { name: string; genericName?: string | null; brandName?: string | null },
  format: MedicineNameFormat = 'BRAND_GENERIC',
): string {
  const brand = item.brandName ?? (item.genericName && item.name.toLowerCase() !== item.genericName.toLowerCase() ? item.name : null);
  const generic = item.genericName ?? (brand ? null : item.name);
  if (!brand) return generic ?? item.name;
  if (!generic) return brand;
  switch (format) {
    case 'BRAND_ONLY':
      return brand;
    case 'GENERIC_ONLY':
      return generic;
    case 'GENERIC_BRAND':
      return `${generic} (${brand})`;
    default:
      return `${brand} (${generic})`;
  }
}

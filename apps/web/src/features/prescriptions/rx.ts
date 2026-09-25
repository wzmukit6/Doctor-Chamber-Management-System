import {
  computeQuantity,
  DEFAULT_ROUTE_BY_FORM,
  medicineKey,
  type DurationUnit,
  type MealInstruction,
  type MedicineDto,
  type MedicineForm,
  type MedicineRoute,
  type PrescriptionItemDto,
  type PrescriptionItemInput,
} from '@chamber/shared';

/** Editable prescription line in the builder (inputs kept as strings). */
export interface RxRow {
  key: string;
  medicineId: string | null;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: MedicineForm | null;
  dose: string;
  frequency: string;
  route: MedicineRoute | null;
  durationValue: string;
  durationUnit: DurationUnit | null;
  quantity: string;
  /** Quantity follows frequency × duration until the doctor types a value. */
  quantityAuto: boolean;
  mealInstruction: MealInstruction | null;
  timing: string;
  instructions: string;
  /** Common frequencies of the catalogue medicine (extra chips). */
  suggestions?: string[];
}

export interface RxDraft {
  items: RxRow[];
  advice: string;
}

let seq = 0;
const newKey = () => `rx-${Date.now().toString(36)}-${++seq}`;

export function autoQuantity(r: Pick<RxRow, 'form' | 'frequency' | 'dose' | 'durationValue' | 'durationUnit'>): number | null {
  return computeQuantity({ form: r.form, frequency: r.frequency || null, dose: r.dose || null, durationValue: r.durationValue ? Number(r.durationValue) : null, durationUnit: r.durationUnit });
}

/** Re-applies the automatic quantity after a change (unless overridden by hand). */
export function withQuantity(r: RxRow): RxRow {
  if (!r.quantityAuto) return r;
  const q = autoQuantity(r);
  return { ...r, quantity: q ? String(q) : '' };
}

export function rowFromItem(i: PrescriptionItemDto | PrescriptionItemInput): RxRow {
  const r: RxRow = {
    key: newKey(),
    medicineId: i.medicineId ?? null,
    name: i.name,
    genericName: i.genericName ?? null,
    strength: i.strength ?? null,
    form: (i.form as MedicineForm | null) ?? null,
    dose: i.dose ?? '',
    frequency: i.frequency ?? '',
    route: (i.route as MedicineRoute | null) ?? null,
    durationValue: i.durationValue ? String(i.durationValue) : '',
    durationUnit: (i.durationUnit as DurationUnit | null) ?? null,
    quantity: i.quantity ? String(i.quantity) : '',
    quantityAuto: false,
    mealInstruction: (i.mealInstruction as MealInstruction | null) ?? null,
    timing: i.timing ?? '',
    instructions: i.instructions ?? '',
  };
  // Keep auto mode when the stored quantity equals the calculated one.
  const q = autoQuantity(r);
  return { ...r, quantityAuto: !r.quantity || (q !== null && String(q) === r.quantity) };
}

/** "5 days" → [5, DAYS]; "Continue" → [null, CONTINUE]. */
export function parseDuration(text: string | undefined): [number | null, DurationUnit | null] {
  if (!text) return [null, null];
  if (/^continue/i.test(text.trim())) return [null, 'CONTINUE'];
  const m = /^(\d+)\s*(day|days|week|weeks|month|months)$/i.exec(text.trim());
  if (!m) return [null, null];
  const unit = m[2]!.toLowerCase().startsWith('day') ? 'DAYS' : m[2]!.toLowerCase().startsWith('week') ? 'WEEKS' : 'MONTHS';
  return [Number(m[1]), unit];
}

export function rowFromMedicine(m: MedicineDto): RxRow {
  const [dv, du] = parseDuration(m.commonDurations[0]);
  const form = m.form as MedicineForm;
  return withQuantity({
    key: newKey(),
    medicineId: m.id,
    name: m.brandName ?? m.genericName,
    genericName: m.genericName,
    strength: m.strength,
    form,
    dose: m.defaultDose ?? '',
    frequency: m.commonFrequencies[0] ?? '',
    route: (m.route as MedicineRoute | null) ?? DEFAULT_ROUTE_BY_FORM[form] ?? null,
    durationValue: dv ? String(dv) : '',
    durationUnit: du,
    quantity: '',
    quantityAuto: true,
    mealInstruction: null,
    timing: '',
    instructions: '',
    suggestions: m.commonFrequencies,
  });
}

export function rowFromText(name: string): RxRow {
  return {
    key: newKey(),
    medicineId: null,
    name,
    genericName: null,
    strength: null,
    form: null,
    dose: '',
    frequency: '',
    route: null,
    durationValue: '',
    durationUnit: null,
    quantity: '',
    quantityAuto: true,
    mealInstruction: null,
    timing: '',
    instructions: '',
  };
}

const nul = (v: string) => (v.trim() ? v.trim() : null);

export function toItemInput(r: RxRow): PrescriptionItemInput {
  return {
    medicineId: r.medicineId,
    name: r.name.trim(),
    genericName: r.genericName,
    strength: r.strength,
    form: r.form,
    dose: nul(r.dose),
    frequency: nul(r.frequency),
    route: r.route,
    durationValue: r.durationUnit === 'CONTINUE' || !r.durationValue ? null : Number(r.durationValue),
    durationUnit: r.durationUnit,
    quantity: r.quantity ? Number(r.quantity) : null,
    mealInstruction: r.mealInstruction,
    timing: nul(r.timing),
    instructions: nul(r.instructions),
  };
}

export function draftFrom(items: (PrescriptionItemDto | PrescriptionItemInput)[], advice: string | null | undefined): RxDraft {
  return { items: items.map(rowFromItem), advice: advice ?? '' };
}

export function contentPayload(d: RxDraft): { items: PrescriptionItemInput[]; advice: string | null } {
  return { items: d.items.map(toItemInput), advice: nul(d.advice) };
}

export function rowKeyOf(r: Pick<RxRow, 'medicineId' | 'name' | 'strength'>) {
  return medicineKey({ medicineId: r.medicineId, name: r.name, strength: r.strength });
}

/** Adds rows that are not already present; returns [merged, skippedCount]. */
export function mergeRows(existing: RxRow[], incoming: RxRow[]): [RxRow[], number] {
  const keys = new Set(existing.map(rowKeyOf));
  const add = incoming.filter((r) => !keys.has(rowKeyOf(r)));
  return [[...existing, ...add], incoming.length - add.length];
}

/** Appends advice text without duplicating it. */
export function mergeAdvice(current: string, extra: string | null | undefined): string {
  if (!extra?.trim()) return current;
  if (current.includes(extra.trim())) return current;
  return current.trim() ? `${current.trim()}\n${extra.trim()}` : extra.trim();
}

import type { TFunction } from 'i18next';
import { formatMedicineName, type MedicineNameFormat, type PrescriptionItemDto } from '@chamber/shared';

/** "7 days", "2 weeks", "Continue". */
export function formatDuration(t: TFunction, value: number | null, unit: string | null): string | null {
  if (unit === 'CONTINUE') return t('durationUnit.continue_long');
  if (!value || !unit) return null;
  return t(`durationCount.${unit}`, { count: value });
}

/** Dose | frequency | meal | duration — the second line of a printed item. */
export function formatDirections(t: TFunction, i: PrescriptionItemDto): string {
  return [i.dose, i.frequency, i.mealInstruction ? t(`meal.${i.mealInstruction}`) : null, i.timing, formatDuration(t, i.durationValue, i.durationUnit)].filter(Boolean).join('  |  ');
}

export function itemTitle(i: PrescriptionItemDto, format?: MedicineNameFormat): string {
  return formatMedicineName({ name: i.name, genericName: i.genericName }, format);
}

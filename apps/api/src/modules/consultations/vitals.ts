import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, parseBloodPressure, VitalValueInput } from '@chamber/shared';
import type { VitalDefinition } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';

export interface NormalizedVital {
  definitionId: string;
  valueText: string;
  valueNumber: number | null;
  valueNumber2: number | null;
}

/**
 * Validates vitals against their (configurable) definitions: numeric ranges,
 * decimals and blood-pressure format. Empty values are dropped.
 */
export function normalizeVitals(values: VitalValueInput[], definitions: VitalDefinition[], pathPrefix = 'vitals'): NormalizedVital[] {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const issues: { path: string; message: string }[] = [];
  const out: NormalizedVital[] = [];
  values.forEach((v, i) => {
    const value = v.value.trim();
    if (!value) return;
    const def = byId.get(v.definitionId);
    const path = `${pathPrefix}.${i}.value`;
    if (!def || !def.isActive) {
      issues.push({ path, message: 'validation.invalid' });
      return;
    }
    if (def.type === 'BLOOD_PRESSURE') {
      const bp = parseBloodPressure(value);
      if (!bp) issues.push({ path, message: 'validation.blood_pressure' });
      else out.push({ definitionId: def.id, valueText: `${bp[0]}/${bp[1]}`, valueNumber: bp[0], valueNumber2: bp[1] });
      return;
    }
    if (def.type === 'NUMBER') {
      const n = Number(value.replace(',', '.'));
      const min = def.minValue !== null ? Number(def.minValue) : null;
      const max = def.maxValue !== null ? Number(def.maxValue) : null;
      if (!Number.isFinite(n)) issues.push({ path, message: 'validation.number' });
      else if ((min !== null && n < min) || (max !== null && n > max)) issues.push({ path, message: 'validation.out_of_range' });
      else {
        const rounded = roundHalfUp(n, def.decimals);
        out.push({ definitionId: def.id, valueText: rounded.toFixed(def.decimals), valueNumber: rounded, valueNumber2: null });
      }
      return;
    }
    out.push({ definitionId: def.id, valueText: value.slice(0, 40), valueNumber: null, valueNumber2: null });
  });
  if (issues.length) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Some vitals are invalid', HttpStatus.UNPROCESSABLE_ENTITY, issues);
  return out;
}

/** Decimal-safe half-up rounding (72.35 → 72.4; plain toFixed gives 72.3 due to binary floats). */
export function roundHalfUp(value: number, decimals: number): number {
  return Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
}

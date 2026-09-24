import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import i18n from '@/i18n';
import { ApiError } from '@/services/api';

/** User-facing message for any error, translated when a known code exists. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    return i18n.exists(key) ? i18n.t(key) : err.message;
  }
  return i18n.t('errors.generic');
}

/** Maps server-side field errors onto react-hook-form fields. Returns true if any were applied. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): boolean {
  if (!(err instanceof ApiError) || err.details.length === 0) return false;
  for (const d of err.details) {
    if (d.path) setError(d.path as Path<T>, { type: 'server', message: d.message });
  }
  return true;
}

/** Translates validation messages that are i18n keys (from shared zod schemas). */
export function translateMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return i18n.exists(message) ? i18n.t(message) : message;
}

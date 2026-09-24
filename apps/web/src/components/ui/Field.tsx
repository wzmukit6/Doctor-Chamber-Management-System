import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { translateMessage } from '@/utils/errors';
import { useTranslation } from 'react-i18next';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}

/**
 * Accessible form field: associates label, hint and error with the control
 * via id / aria-describedby / aria-invalid (spec §36).
 */
export function Field({ label, error, hint, optional, className, children }: FieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      })
    : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-subtle">({t('common.optional')})</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {translateMessage(error)}
        </p>
      )}
    </div>
  );
}

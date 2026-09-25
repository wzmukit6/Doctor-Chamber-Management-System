import { useTranslation } from 'react-i18next';
import { PAYMENT_METHODS, type PaymentMethod } from '@chamber/shared';
import { Field, Input, Select } from '@/components/ui';
import { translateMessage } from '@/utils/errors';
import { useBillingSettings } from '../money';

export interface PaymentDraft {
  amount: string;
  method: PaymentMethod;
  provider: string;
  reference: string;
  note: string;
}

export const emptyPayment = (amount = ''): PaymentDraft => ({ amount, method: 'CASH', provider: '', reference: '', note: '' });

export function paymentPayload(p: PaymentDraft) {
  return {
    amount: Number(p.amount),
    method: p.method,
    provider: p.provider.trim() || null,
    reference: p.reference.trim() || null,
    note: p.note.trim() || null,
  };
}

/** Amount, method (only the chamber's enabled methods), provider (bKash, Nagad, Visa…) and reference. */
export function PaymentFields({ value, onChange, errors = {}, prefix = '', showNote = true }: { value: PaymentDraft; onChange: (p: PaymentDraft) => void; errors?: Record<string, string>; prefix?: string; showNote?: boolean }) {
  const { t } = useTranslation();
  const settings = useBillingSettings();
  const methods = settings.data?.enabledMethods ?? [...PAYMENT_METHODS];
  const providers = value.method === 'MOBILE_BANKING' ? settings.data?.mobileProviders : value.method === 'CARD' ? settings.data?.cardProviders : undefined;
  const err = (k: string) => (errors[`${prefix}${k}`] ? translateMessage(errors[`${prefix}${k}`]) : undefined);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('billing.amount')} error={err('amount')}>
        <Input type="number" inputMode="decimal" min={0} step="0.01" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
      </Field>
      <Field label={t('billing.method')} error={err('method')}>
        <Select value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value as PaymentMethod, provider: '' })}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {t(`paymentMethod.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      {providers && providers.length > 0 && (
        <Field label={t('billing.provider')} optional>
          <Select value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value })}>
            <option value="">—</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.method !== 'CASH' && (
        <Field label={t('billing.reference')} optional hint={value.method === 'CARD' ? t('billing.card_hint') : t('billing.reference_hint')} error={err('reference')}>
          <Input value={value.reference} maxLength={100} onChange={(e) => onChange({ ...value, reference: e.target.value })} />
        </Field>
      )}
      {showNote && (
        <Field label={t('billing.note')} optional className="sm:col-span-2">
          <Input value={value.note} maxLength={300} onChange={(e) => onChange({ ...value, note: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

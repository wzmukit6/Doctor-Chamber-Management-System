import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PAYMENT_METHODS, PERMISSIONS, type BillingSettings, type PaymentMethod } from '@chamber/shared';
import { Button, ErrorState, Field, Input, Skeleton, useToast } from '@/components/ui';
import { settingsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';

const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Billing settings (spec §18, locally common payment methods configurable): currency, methods, providers, receipt footer. */
export function BillingSettingsForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings', 'billing'], queryFn: settingsApi.billing });
  const [form, setForm] = useState<(BillingSettings & { version: number }) | null>(null);
  const [mobile, setMobile] = useState('');
  const [cards, setCards] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setForm(q.data);
    setMobile(q.data.mobileProviders.join(', '));
    setCards(q.data.cardProviders.join(', '));
  }, [q.data]);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!form) return <Skeleton className="h-64 w-full" />;

  const toggle = (m: PaymentMethod) =>
    setForm({ ...form, enabledMethods: form.enabledMethods.includes(m) ? form.enabledMethods.filter((x) => x !== m) : PAYMENT_METHODS.filter((x) => x === m || form.enabledMethods.includes(x)) });
  const save = async () => {
    setSaving(true);
    try {
      const saved = await settingsApi.updateBilling({ ...form, mobileProviders: list(mobile), cardProviders: list(cards) });
      queryClient.setQueryData(['settings', 'billing'], saved);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card max-w-2xl space-y-4 p-5">
      {!editable && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">{t('settings.read_only')}</p>}
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.bill_currency')}>
          <Input value={form.currencySymbol} maxLength={5} onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">{t('settings.bill_methods')}</span>
          <div className="flex flex-wrap gap-3">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={form.enabledMethods.includes(m)} disabled={form.enabledMethods.length === 1 && form.enabledMethods.includes(m)} onChange={() => toggle(m)} />
                {t(`paymentMethod.${m}`)}
              </label>
            ))}
          </div>
        </div>
        <Field label={t('settings.bill_mobile')} hint={t('medicines.list_hint', { example: 'bKash, Nagad, Rocket' })}>
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </Field>
        <Field label={t('settings.bill_cards')} hint={t('medicines.list_hint', { example: 'Visa, Mastercard' })}>
          <Input value={cards} onChange={(e) => setCards(e.target.value)} />
        </Field>
        <Field label={t('settings.bill_footer')} optional className="sm:col-span-2">
          <Input value={form.receiptFooter} maxLength={300} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
        </Field>
      </fieldset>
      {editable && (
        <div className="flex justify-end">
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import type { SecuritySettings } from '@chamber/shared';
import { Button, ErrorState, Field, Input, Skeleton, useToast } from '@/components/ui';
import { settingsApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';

type S = SecuritySettings & { version: number };

/** Security settings (spec §34): password policy, session timeouts, login lockout — platform-wide, super admin only. */
export function SecuritySettingsForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'security'], queryFn: settingsApi.security });
  const [s, setS] = useState<S | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!s) return <Skeleton className="h-64 w-full" />;
  const num = (k: keyof SecuritySettings, min: number, max: number, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" min={min} max={max} value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
    </Field>
  );
  const flag = (k: keyof SecuritySettings, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      {label}
    </label>
  );
  const save = async () => {
    setSaving(true);
    try {
      const saved = await settingsApi.updateSecurity(s);
      queryClient.setQueryData(['settings', 'security'], saved);
      void queryClient.invalidateQueries({ queryKey: ['password-policy'] });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card max-w-3xl space-y-6 p-5">
      <p className="flex items-start gap-2 rounded bg-canvas px-3 py-2 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" aria-hidden /> {t('settings.sec_intro')}
      </p>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t('settings.sec_password')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {num('passwordMinLength', 8, 64, t('settings.sec_min_length'), t('settings.sec_min_length_hint'))}
          <div className="space-y-2 pt-6">
            {flag('passwordRequireUpper', t('settings.sec_upper'))}
            {flag('passwordRequireLower', t('settings.sec_lower'))}
            {flag('passwordRequireDigit', t('settings.sec_digit'))}
            {flag('passwordRequireSymbol', t('settings.sec_symbol'))}
          </div>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t('settings.sec_sessions')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {num('sessionIdleMinutes', 5, 480, t('settings.sec_idle'), t('settings.sec_idle_hint'))}
          {num('sessionAbsoluteHours', 1, 72, t('settings.sec_absolute'), t('settings.sec_absolute_hint'))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t('settings.sec_login')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {num('loginMaxFailedAttempts', 3, 20, t('settings.sec_attempts'))}
          {num('loginLockoutMinutes', 1, 1440, t('settings.sec_lockout'))}
        </div>
      </div>
      <div className="rounded-lg border border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">{t('settings.sec_mfa')}</h3>
        <p className="text-xs text-ink-muted">{t('settings.sec_mfa_note')}</p>
      </div>
      <div className="flex justify-end">
        <Button loading={saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}

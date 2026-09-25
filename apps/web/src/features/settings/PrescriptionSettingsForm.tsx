import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MEDICINE_NAME_FORMATS, PERMISSIONS, type PrescriptionSettings } from '@chamber/shared';
import { Button, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { settingsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';

/** Prescription settings (spec §34): page format, print language, medicine name format, default advice, footer, QR. */
export function PrescriptionSettingsForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings', 'prescriptions'], queryFn: settingsApi.prescriptions });
  const [form, setForm] = useState<(PrescriptionSettings & { version: number }) | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!form) return <Skeleton className="h-64 w-full" />;
  const set = <K extends keyof PrescriptionSettings>(k: K, v: PrescriptionSettings[K]) => setForm({ ...form, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await settingsApi.updatePrescriptions(form);
      queryClient.setQueryData(['settings', 'prescriptions'], saved);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggles: [keyof PrescriptionSettings, string][] = [
    ['showQr', 'rx_show_qr'],
    ['showClinicalSection', 'rx_show_clinical'],
    ['showSignatureLine', 'rx_show_signature'],
  ];

  return (
    <section className="card max-w-2xl space-y-4 p-5">
      {!editable && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">{t('settings.read_only')}</p>}
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.rx_page_format')}>
          <Select value={form.pageFormat} onChange={(e) => set('pageFormat', e.target.value as PrescriptionSettings['pageFormat'])}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </Select>
        </Field>
        <Field label={t('settings.rx_language')} hint={t('settings.rx_language_hint')}>
          <Select value={form.language} onChange={(e) => set('language', e.target.value as PrescriptionSettings['language'])}>
            <option value="en">English</option>
            <option value="bn">বাংলা</option>
          </Select>
        </Field>
        <Field label={t('settings.rx_name_format')} className="sm:col-span-2">
          <Select value={form.medicineNameFormat} onChange={(e) => set('medicineNameFormat', e.target.value as PrescriptionSettings['medicineNameFormat'])}>
            {MEDICINE_NAME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`settings.rx_name_${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          {toggles.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={!!form[key]} onChange={(e) => set(key, e.target.checked as never)} />
              {t(`settings.${label}`)}
            </label>
          ))}
        </div>
        <Field label={t('settings.rx_header_note')} optional className="sm:col-span-2" hint={t('settings.rx_header_note_hint')}>
          <Input value={form.headerNote} maxLength={200} onChange={(e) => set('headerNote', e.target.value)} />
        </Field>
        <Field label={t('settings.rx_default_advice')} optional className="sm:col-span-2" hint={t('settings.rx_default_advice_hint')}>
          <Textarea rows={3} value={form.defaultAdvice} maxLength={2000} onChange={(e) => set('defaultAdvice', e.target.value)} />
        </Field>
        <Field label={t('settings.rx_footer')} optional className="sm:col-span-2">
          <Input value={form.footerText} maxLength={300} onChange={(e) => set('footerText', e.target.value)} />
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

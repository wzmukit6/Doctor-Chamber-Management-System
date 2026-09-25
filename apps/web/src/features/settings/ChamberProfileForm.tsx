import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type ChamberProfile } from '@chamber/shared';
import { Button, ErrorState, Field, Input, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { chambersApi, settingsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage, translateMessage } from '@/utils/errors';
import { imageToDataUrl } from './imageUpload';

const WEEK = [6, 0, 1, 2, 3, 4, 5];
type Hours = ChamberProfile['openingHours'];

/** Chamber settings (spec §34): name, address, phone, logo, opening hours. */
export function ChamberProfileForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const chamberId = user?.activeMembership.chamber?.id;
  const editable = can(PERMISSIONS.SETTINGS_MANAGE);
  const canEditDetails = can(PERMISSIONS.CHAMBERS_UPDATE);
  const chamber = useQuery({ queryKey: ['chambers', chamberId], queryFn: () => chambersApi.get(chamberId!), enabled: !!chamberId });
  const profile = useQuery({ queryKey: ['settings', 'chamber-profile'], queryFn: settingsApi.chamberProfile });
  const [details, setDetails] = useState({ name: '', phone: '', email: '', address: '' });
  const [p, setP] = useState<(ChamberProfile & { version: number }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chamber.data) setDetails({ name: chamber.data.name, phone: chamber.data.phone ?? '', email: chamber.data.email ?? '', address: chamber.data.address ?? '' });
  }, [chamber.data]);
  useEffect(() => {
    if (profile.data) setP(profile.data);
  }, [profile.data]);

  if (profile.isError) return <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />;
  if (!p || (chamberId && !chamber.data)) return <Skeleton className="h-64 w-full" />;

  const hours: Hours = WEEK.map((w) => p.openingHours.find((h) => h.weekday === w) ?? { weekday: w, closed: true, open: null, close: null });
  const setDay = (weekday: number, patch: Partial<Hours[number]>) =>
    setP({ ...p, openingHours: hours.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)) });

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      setP({ ...p, logoDataUrl: await imageToDataUrl(file, 480, 240) });
    } catch (err) {
      toast.error(translateMessage((err as Error).message) ?? errorMessage(err));
    }
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      if (canEditDetails && chamber.data) {
        const updated = await chambersApi.update(chamber.data.id, {
          name: details.name.trim(),
          phone: details.phone.trim() || null,
          email: details.email.trim() || null,
          address: details.address.trim() || null,
          version: chamber.data.version,
        });
        queryClient.setQueryData(['chambers', chamberId], updated);
      }
      const saved = await settingsApi.updateChamberProfile({ ...p, openingHours: hours.map((h) => (h.closed ? { weekday: h.weekday, closed: true, open: null, close: null } : h)) });
      queryClient.setQueryData(['settings', 'chamber-profile'], saved);
      toast.success(t('settings.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card max-w-3xl space-y-5 p-5">
      {!editable && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">{t('settings.read_only')}</p>}
      <fieldset disabled={!editable} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('chambers.name')} error={errors.name ? translateMessage(errors.name) : undefined}>
            <Input value={details.name} maxLength={150} disabled={!canEditDetails} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
          </Field>
          <Field label={t('chambers.phone')} optional>
            <Input value={details.phone} maxLength={20} disabled={!canEditDetails} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
          </Field>
          <Field label={t('chambers.email')} optional>
            <Input type="email" value={details.email} disabled={!canEditDetails} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
          </Field>
          <Field label={t('settings.ch_tagline')} optional hint={t('settings.ch_tagline_hint')}>
            <Input value={p.tagline} maxLength={150} onChange={(e) => setP({ ...p, tagline: e.target.value })} />
          </Field>
          <Field label={t('chambers.address')} optional className="sm:col-span-2">
            <Input value={details.address} maxLength={500} disabled={!canEditDetails} onChange={(e) => setDetails({ ...details, address: e.target.value })} />
          </Field>
        </div>

        <div>
          <span className="label">{t('settings.ch_logo')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-dashed border-border bg-canvas">
              {p.logoDataUrl ? <img src={p.logoDataUrl} alt={t('settings.ch_logo')} className="max-h-16 max-w-40 object-contain" /> : <span className="text-xs text-ink-subtle">{t('settings.no_image')}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pickLogo(e.target.files?.[0])} aria-label={t('settings.ch_logo')} />
            <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              {t('settings.upload_image')}
            </Button>
            {p.logoDataUrl && (
              <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setP({ ...p, logoDataUrl: null })}>
                {t('settings.remove_image')}
              </Button>
            )}
          </div>
          <p className="mt-1 text-2xs text-ink-subtle">{t('settings.ch_logo_hint')}</p>
        </div>

        <div>
          <span className="label">{t('settings.ch_hours')}</span>
          <div className="divide-y divide-border rounded-lg border border-border">
            {hours.map((h) => (
              <div key={h.weekday} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-24 text-sm font-medium text-ink">{t(`weekdays.${h.weekday}`)}</span>
                <label className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={!h.closed} onChange={(e) => setDay(h.weekday, e.target.checked ? { closed: false, open: h.open ?? '17:00', close: h.close ?? '21:00' } : { closed: true })} />
                  {t('settings.open')}
                </label>
                {h.closed ? (
                  <span className="text-sm text-ink-subtle">{t('settings.closed')}</span>
                ) : (
                  <>
                    <Input type="time" className="!w-32" aria-label={`${t(`weekdays.${h.weekday}`)} — ${t('settings.from')}`} value={h.open ?? ''} onChange={(e) => setDay(h.weekday, { open: e.target.value })} />
                    <span className="text-ink-subtle">–</span>
                    <Input type="time" className="!w-32" aria-label={`${t(`weekdays.${h.weekday}`)} — ${t('settings.to')}`} value={h.close ?? ''} onChange={(e) => setDay(h.weekday, { close: e.target.value })} />
                  </>
                )}
              </div>
            ))}
          </div>
          {Object.keys(errors).some((k) => k.startsWith('openingHours')) && <p className="mt-1 text-xs text-danger">{t('validation.end_after_start')}</p>}
          <Input className="mt-2" value={p.hoursNote} maxLength={200} placeholder={t('settings.ch_hours_note')} onChange={(e) => setP({ ...p, hoursNote: e.target.value })} />
        </div>
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

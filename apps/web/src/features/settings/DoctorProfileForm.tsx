import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { DoctorProfileDto } from '@chamber/shared';
import { Button, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { doctorProfileApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors } from '@/hooks/useChamber';
import { errorMessage, translateMessage } from '@/utils/errors';
import { imageToDataUrl } from './imageUpload';

/** Doctor settings (spec §34): qualifications, specialty, registration, signature, prescription footer. */
export function DoctorProfileForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const doctors = useDoctors();
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? '');
  useEffect(() => {
    if (!doctorId && doctors.data?.length) setDoctorId(doctors.data[0]!.id);
  }, [doctors.data, doctorId]);
  const q = useQuery({ queryKey: ['doctors', doctorId, 'profile'], queryFn: () => doctorProfileApi.get(doctorId), enabled: !!doctorId });
  const [p, setP] = useState<DoctorProfileDto | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!p) return <Skeleton className="h-64 w-full" />;
  const text = (k: 'qualifications' | 'specialty' | 'registrationNo' | 'bio' | 'prescriptionFooter') => p[k] ?? '';
  const set = (k: keyof DoctorProfileDto, v: string | null) => setP({ ...p, [k]: v });

  const pickSignature = async (file: File | undefined) => {
    if (!file) return;
    try {
      set('signatureDataUrl', await imageToDataUrl(file, 480, 160));
    } catch (err) {
      toast.error(translateMessage((err as Error).message) ?? errorMessage(err));
    }
  };
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const nul = (v: string | null) => (v && v.trim() ? v.trim() : null);
      const saved = await doctorProfileApi.update(p.id, {
        qualifications: nul(p.qualifications),
        specialty: nul(p.specialty),
        registrationNo: nul(p.registrationNo),
        bio: nul(p.bio),
        signatureDataUrl: p.signatureDataUrl,
        prescriptionFooter: nul(p.prescriptionFooter),
        version: p.version,
      });
      queryClient.setQueryData(['doctors', doctorId, 'profile'], saved);
      void queryClient.invalidateQueries({ queryKey: ['doctors'], exact: true });
      toast.success(t('settings.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const err = (k: string) => (errors[k] ? translateMessage(errors[k]) : undefined);

  return (
    <section className="card max-w-3xl space-y-5 p-5">
      {!user?.doctorId && (doctors.data?.length ?? 0) > 0 && (
        <Field label={t('appointments.doctor')}>
          <Select className="!w-auto" value={doctorId} onChange={(e) => (setP(null), setDoctorId(e.target.value))}>
            {doctors.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!p.canEdit && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">{t('settings.doc_read_only')}</p>}
      <fieldset disabled={!p.canEdit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.doc_name')} hint={t('settings.doc_name_hint')}>
          <Input value={p.fullName} disabled />
        </Field>
        <Field label={t('users.specialty')} optional error={err('specialty')}>
          <Input value={text('specialty')} maxLength={150} onChange={(e) => set('specialty', e.target.value)} />
        </Field>
        <Field label={t('users.qualifications')} optional error={err('qualifications')}>
          <Input value={text('qualifications')} maxLength={300} onChange={(e) => set('qualifications', e.target.value)} />
        </Field>
        <Field label={t('users.registration_no')} optional error={err('registrationNo')}>
          <Input value={text('registrationNo')} maxLength={80} onChange={(e) => set('registrationNo', e.target.value)} />
        </Field>
        <Field label={t('settings.doc_bio')} optional className="sm:col-span-2">
          <Textarea rows={2} value={text('bio')} maxLength={1000} onChange={(e) => set('bio', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">{t('settings.doc_signature')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-20 w-56 items-center justify-center rounded-lg border border-dashed border-border bg-white">
              {p.signatureDataUrl ? <img src={p.signatureDataUrl} alt={t('settings.doc_signature')} className="max-h-16 max-w-52 object-contain" /> : <span className="text-xs text-ink-subtle">{t('settings.no_image')}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t('settings.doc_signature')} onChange={(e) => void pickSignature(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              {t('settings.upload_image')}
            </Button>
            {p.signatureDataUrl && (
              <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => set('signatureDataUrl', null)}>
                {t('settings.remove_image')}
              </Button>
            )}
          </div>
          <p className="mt-1 text-2xs text-ink-subtle">{t('settings.doc_signature_hint')}</p>
        </div>
        <Field label={t('settings.doc_footer')} optional className="sm:col-span-2" hint={t('settings.doc_footer_hint')} error={err('prescriptionFooter')}>
          <Input value={text('prescriptionFooter')} maxLength={300} onChange={(e) => set('prescriptionFooter', e.target.value)} />
        </Field>
      </fieldset>
      {p.canEdit && (
        <div className="flex justify-end">
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </section>
  );
}

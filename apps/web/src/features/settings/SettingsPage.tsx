import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { doctorScheduleSchema, PERMISSIONS, type AppointmentSettings, type DoctorDto } from '@chamber/shared';
import { Badge, Button, ErrorState, Field, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { doctorsApi, settingsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors } from '@/hooks/useChamber';
import { VitalsSettings } from './VitalsSettings';
import { PrescriptionSettingsForm } from './PrescriptionSettingsForm';
import { BillingSettingsForm } from './BillingSettingsForm';
import { errorMessage, translateMessage } from '@/utils/errors';

/** Display order: Saturday first (Bangladesh work week). */
const WEEK = [6, 0, 1, 2, 3, 4, 5];

/** Settings (spec §34): appointments & tokens, doctor schedules, vitals, prescriptions, billing. */
export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'appointments' | 'schedules' | 'vitals' | 'prescriptions' | 'billing'>('appointments');
  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="mb-4 border-b border-border" role="tablist">
        <div className="-mb-px flex gap-1">
          {(['appointments', 'schedules', 'vitals', 'prescriptions', 'billing'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={clsx('border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary-700 text-primary-800' : 'border-transparent text-ink-muted hover:text-ink')}
            >
              {t(`settings.tab_${k}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'appointments' ? <AppointmentSettingsForm /> : tab === 'schedules' ? <DoctorSchedules /> : tab === 'vitals' ? <VitalsSettings /> : tab === 'prescriptions' ? <PrescriptionSettingsForm /> : <BillingSettingsForm />}
    </div>
  );
}

function AppointmentSettingsForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.SETTINGS_MANAGE);
  const q = useQuery({ queryKey: ['settings', 'appointments'], queryFn: settingsApi.appointments });
  const [form, setForm] = useState<(AppointmentSettings & { version: number }) | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!form) return <Skeleton className="h-64 w-full" />;

  const save = async () => {
    setSaving(true);
    try {
      const saved = await settingsApi.updateAppointments(form);
      queryClient.setQueryData(['settings', 'appointments'], saved);
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
        <Field label={t('settings.slot_minutes')}>
          <Input type="number" min={5} max={240} step={5} value={form.defaultSlotMinutes} onChange={(e) => setForm({ ...form, defaultSlotMinutes: Number(e.target.value) })} />
        </Field>
        <Field label={t('settings.max_daily')} hint={t('settings.max_daily_hint')} optional>
          <Input type="number" min={1} max={500} value={form.maxDailyPatients ?? ''} onChange={(e) => setForm({ ...form, maxDailyPatients: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label={t('settings.token_scope')}>
          <Select value={form.tokenScope} onChange={(e) => setForm({ ...form, tokenScope: e.target.value as 'DOCTOR' | 'CHAMBER' })}>
            <option value="DOCTOR">{t('settings.token_scope_DOCTOR')}</option>
            <option value="CHAMBER">{t('settings.token_scope_CHAMBER')}</option>
          </Select>
        </Field>
        <Field label={t('settings.token_prefix')} hint={t('settings.token_prefix_hint')} optional>
          <Input maxLength={4} value={form.tokenPrefix} onChange={(e) => setForm({ ...form, tokenPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={form.autoQueueOnCheckIn} onChange={(e) => setForm({ ...form, autoQueueOnCheckIn: e.target.checked })} />
          {t('settings.auto_queue')}
        </label>
      </fieldset>
      {editable && (
        <div className="flex justify-end">
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save_changes')}
          </Button>
        </div>
      )}
    </section>
  );
}

function DoctorSchedules() {
  const { t } = useTranslation();
  const doctors = useDoctors();
  const [doctorId, setDoctorId] = useState('');
  useEffect(() => {
    if (!doctorId && doctors.data?.length) setDoctorId(doctors.data[0]!.id);
  }, [doctors.data, doctorId]);
  if (doctors.isLoading) return <Skeleton className="h-64 w-full" />;
  const doctor = doctors.data?.find((d) => d.id === doctorId);
  return (
    <div className="space-y-4">
      <Select aria-label={t('appointments.doctor')} className="max-w-sm" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
        {doctors.data?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName}
            {d.specialty ? ` — ${d.specialty}` : ''}
          </option>
        ))}
      </Select>
      {doctor && <ScheduleEditor key={doctor.id + doctor.version} doctor={doctor} />}
    </div>
  );
}

type Window = { weekday: number; startTime: string; endTime: string };

function ScheduleEditor({ doctor }: { doctor: DoctorDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.SCHEDULES_MANAGE);
  const [windows, setWindows] = useState<Window[]>(doctor.schedule);
  const [slot, setSlot] = useState<string>(doctor.slotMinutes ? String(doctor.slotMinutes) : '');
  const [max, setMax] = useState<string>(doctor.maxDailyPatients ? String(doctor.maxDailyPatients) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<Window>) => setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const save = async () => {
    const input = { windows, slotMinutes: slot ? Number(slot) : null, maxDailyPatients: max ? Number(max) : null };
    const parsed = doctorScheduleSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await doctorsApi.updateSchedule(doctor.id, parsed.data);
      toast.success(t('settings.schedule_saved'));
      void queryClient.invalidateQueries({ queryKey: ['doctors'] });
      void queryClient.invalidateQueries({ queryKey: ['appointments', 'availability'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-ink">
        {t('settings.schedule_for')} — {doctor.fullName}
      </h2>
      {!editable && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">{t('settings.read_only')}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
        <Field label={t('settings.doctor_slot')} hint={t('settings.doctor_slot_hint')} optional>
          <Input type="number" min={5} max={240} step={5} disabled={!editable} value={slot} onChange={(e) => setSlot(e.target.value)} />
        </Field>
        <Field label={t('settings.doctor_max')} hint={t('settings.max_daily_hint')} optional>
          <Input type="number" min={1} max={500} disabled={!editable} value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
      </div>
      {windows.length === 0 && <p className="text-sm text-ink-muted">{t('settings.no_windows')}</p>}
      <div className="divide-y divide-border rounded-lg border border-border">
        {WEEK.map((day) => {
          const dayWindows = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === day);
          return (
            <div key={day} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <p className="w-28 shrink-0 pt-2 text-sm font-medium text-ink">{t(`weekdays.${day}`)}</p>
              <div className="flex-1 space-y-2">
                {dayWindows.length === 0 && <Badge>{t('settings.closed')}</Badge>}
                {dayWindows.map(({ w, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input type="time" aria-label={t('settings.from')} className="!w-32" disabled={!editable} value={w.startTime} onChange={(e) => update(i, { startTime: e.target.value })} />
                    <span className="text-ink-subtle">–</span>
                    <Input type="time" aria-label={t('settings.to')} className="!w-32" disabled={!editable} value={w.endTime} onChange={(e) => update(i, { endTime: e.target.value })} />
                    {editable && (
                      <Button variant="ghost" size="sm" aria-label={t('common.delete')} icon={<Trash2 className="h-4 w-4" />} onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))} />
                    )}
                    {(errors[`windows.${i}.endTime`] || errors[`windows.${i}.startTime`]) && (
                      <span className="text-xs text-danger">{translateMessage(errors[`windows.${i}.endTime`] ?? errors[`windows.${i}.startTime`])}</span>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setWindows((ws) => [...ws, { weekday: day, startTime: '17:00', endTime: '21:00' }])}>
                  {t('settings.add_window')}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save_changes')}
          </Button>
        </div>
      )}
    </section>
  );
}

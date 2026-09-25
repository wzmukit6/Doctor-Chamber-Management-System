import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { VISIT_TYPES, type PatientSummaryDto, type VisitType } from '@chamber/shared';
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { appointmentsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useChamberTz, useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { PatientPicker } from './PatientPicker';
import { SlotPicker } from './SlotPicker';

export interface BookingDefaults {
  patient?: PatientSummaryDto | null;
  doctorId?: string;
  date?: string;
  time?: string;
  walkIn?: boolean;
}

type Issue = 'doctor_busy' | 'outside_schedule' | 'daily_limit' | 'patient_busy';

/** Book (or walk-in check-in) an appointment with conflict/override handling (spec §7). */
export function BookAppointmentModal({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: BookingDefaults }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tz = useChamberTz();
  const today = useToday();
  const doctors = useDoctors();

  const [patient, setPatient] = useState<PatientSummaryDto | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('NEW');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const [issues, setIssues] = useState<{ list: Issue[]; overridable: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPatient(defaults?.patient ?? null);
    setDoctorId(defaults?.doctorId ?? user?.doctorId ?? '');
    setDate(defaults?.date ?? today);
    setTime(defaults?.time ?? '');
    setDuration('');
    setVisitType('NEW');
    setReason('');
    setNotes('');
    setWalkIn(!!defaults?.walkIn);
    setIssues(null);
    setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doctorId && doctors.data?.length === 1) setDoctorId(doctors.data[0]!.id);
  }, [doctors.data, doctorId]);
  useEffect(() => setIssues(null), [doctorId, date, time, duration, patient]);

  const submit = async (allowOverbook = false) => {
    const e: Record<string, string> = {};
    if (!patient) e.patient = 'validation.required';
    if (!doctorId) e.doctor = 'validation.required';
    if (!walkIn && !/^\d{2}:\d{2}$/.test(time)) e.time = 'validation.time';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await appointmentsApi.create({
        patientId: patient!.id,
        doctorId,
        date,
        time: walkIn ? '00:00' : time,
        durationMinutes: duration ? Number(duration) : undefined,
        visitType,
        reason: reason || null,
        notes: notes || null,
        checkInNow: walkIn,
        allowOverbook,
      });
      toast.success(t('appointments.created'));
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      onClose();
    } catch (err) {
      const data = err instanceof ApiError ? (err.data as { issues?: Issue[]; overridable?: boolean } | undefined) : undefined;
      if (data?.issues) setIssues({ list: data.issues, overridable: !!data.overridable });
      else if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('appointments.book')}
      description={t('appointments.tz_note', { tz })}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {issues?.overridable ? (
            <Button variant="danger" loading={busy} onClick={() => void submit(true)}>
              {t('appointments.book_anyway')}
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void submit(false)} disabled={!!issues && !issues.overridable}>
              {walkIn ? t('appointments.check_in') : t('appointments.book')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {issues && (
          <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft/70 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden /> {t('appointments.issues_title')}
            </p>
            <ul className="mt-1 list-disc pl-6 text-ink">
              {issues.list.map((i) => (
                <li key={i}>{t(`appointments.issue_${i}`)}</li>
              ))}
            </ul>
          </div>
        )}
        <Field label={t('appointments.patient')} error={errors.patient}>
          <PatientPicker value={patient} onChange={setPatient} error={!!errors.patient} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('appointments.doctor')} error={errors.doctor ?? errors.doctorId}>
            <Select value={doctorId} onChange={(e) => (setDoctorId(e.target.value), setTime(''))}>
              <option value="">—</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                  {d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('appointments.visit_type')}>
            <Select value={visitType} onChange={(e) => setVisitType(e.target.value as VisitType)}>
              {VISIT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`visitType.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary-700" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
          <span>
            <span className="font-medium text-ink">{t('appointments.walk_in')}</span>
            <span className="block text-xs text-ink-muted">{t('appointments.walk_in_hint')}</span>
          </span>
        </label>
        {!walkIn && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('appointments.date')} error={errors.date}>
                <Input type="date" min={today} value={date} onChange={(e) => (setDate(e.target.value), setTime(''))} />
              </Field>
              <Field label={t('appointments.custom_time')} error={errors.time}>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <Field label={t('appointments.duration')} optional>
                <Input type="number" min={5} max={240} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </Field>
            </div>
            {doctorId && (
              <div>
                <span className="label">{t('appointments.slots')}</span>
                <SlotPicker doctorId={doctorId} date={date} value={time} onChange={setTime} />
              </div>
            )}
          </>
        )}
        <Field label={t('appointments.reason')} optional>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('appointments.notes')} optional>
          <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

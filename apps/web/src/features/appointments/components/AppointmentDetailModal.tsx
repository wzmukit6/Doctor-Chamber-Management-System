import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock, History, Stethoscope, User } from 'lucide-react';
import { PERMISSIONS, RESCHEDULABLE_STATUSES, zonedDate, zonedTime, type AppointmentAction } from '@chamber/shared';
import { Badge, Button, ConfirmDialog, ErrorState, Field, Input, Modal, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { appointmentsApi, type AppointmentDetail } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useChamberTz, useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatDateTime, formatDayLabel, formatTimeIn } from '@/utils/format';
import { AppointmentStatusBadge, TokenPill } from './AppointmentBits';
import { availableActions } from './appointmentActions';
import { SlotPicker } from './SlotPicker';

const ACTION_VARIANT: Partial<Record<AppointmentAction, 'primary' | 'secondary' | 'danger'>> = {
  'check-in': 'primary',
  start: 'primary',
  complete: 'primary',
  cancel: 'danger',
};
const ACTION_LABEL: Record<AppointmentAction, string> = {
  confirm: 'appointments.confirm',
  'check-in': 'appointments.check_in',
  'send-to-queue': 'appointments.send_to_queue',
  start: 'appointments.start',
  complete: 'appointments.complete',
  'return-to-queue': 'appointments.return_to_queue',
  cancel: 'appointments.cancel',
  'no-show': 'appointments.no_show',
};

export function AppointmentDetailModal({ appointmentId, onClose }: { appointmentId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const tz = useChamberTz();
  const today = useToday();
  const doctors = useDoctors();
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [confirming, setConfirming] = useState<'cancel' | 'no-show' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resched, setResched] = useState({ date: today, time: '', doctorId: '', reason: '' });
  const [overbookNeeded, setOverbookNeeded] = useState<string[] | null>(null);
  const navigate = useNavigate();

  const q = useQuery({ queryKey: ['appointments', 'detail', appointmentId], queryFn: () => appointmentsApi.get(appointmentId!), enabled: !!appointmentId });
  const a: AppointmentDetail | undefined = q.data;

  useEffect(() => {
    setMode('view');
    setOverbookNeeded(null);
  }, [appointmentId]);
  useEffect(() => {
    if (a && mode === 'reschedule') setResched({ date: zonedDate(new Date(a.startsAt), tz), time: '', doctorId: a.doctor.id, reason: '' });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const run = async (action: AppointmentAction, reason?: string) => {
    if (!a) return;
    setBusy(action);
    try {
      const updated = await appointmentsApi.act(a.id, action, { reason: reason ?? null });
      if (action === 'start' && updated.consultationId) {
        onClose();
        navigate(`/consultations/${updated.consultationId}`);
      }
      toast.success(action === 'cancel' ? t('appointments.cancelled') : `${t(ACTION_LABEL[action])} ✓`);
      setConfirming(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reschedule = async (allowOverbook = false) => {
    if (!a || !resched.time) return;
    setBusy('reschedule');
    try {
      await appointmentsApi.reschedule(a.id, { ...resched, reason: resched.reason || null, allowOverbook, version: a.version });
      toast.success(t('appointments.rescheduled'));
      setMode('view');
      setOverbookNeeded(null);
      refresh();
    } catch (err) {
      const data = err instanceof ApiError ? (err.data as { issues?: string[]; overridable?: boolean } | undefined) : undefined;
      if (data?.issues && data.overridable) setOverbookNeeded(data.issues);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const actions = a
    ? availableActions(a, { can, doctorId: user?.doctorId ?? null, today, apptDay: zonedDate(new Date(a.startsAt), tz) })
    : [];
  const canReschedule = !!a && can(PERMISSIONS.APPOINTMENTS_UPDATE) && (RESCHEDULABLE_STATUSES as string[]).includes(a.status);

  return (
    <>
      <Modal open={!!appointmentId} onClose={onClose} title={t('appointments.details')} size="lg">
        {q.isLoading && <Skeleton className="h-48 w-full" />}
        {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {a && mode === 'view' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {a.token && <TokenPill label={a.token.label} onHold={a.token.onHold} />}
                <div>
                  <Link to={`/patients/${a.patient.id}`} className="text-base font-semibold text-ink hover:underline" onClick={onClose}>
                    {a.patient.fullName}
                  </Link>
                  <p className="text-xs text-ink-subtle">
                    <span className="font-mono">{a.patient.patientCode}</span>
                    {a.patient.age !== null && <> · {t('patients.age_value', { count: a.patient.age })}</>}
                    {a.patient.phone && <> · {a.patient.phone}</>}
                  </p>
                </div>
              </div>
              <AppointmentStatusBadge status={a.status} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-ink-subtle" aria-hidden />
                <span>
                  {formatDayLabel(zonedDate(new Date(a.startsAt), tz), { weekday: 'short', day: 'numeric', month: 'short' })}, {formatTimeIn(a.startsAt, tz)}–{formatTimeIn(a.endsAt, tz)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-ink-subtle" aria-hidden />
                <span>{a.doctor.fullName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-ink-subtle" aria-hidden />
                <span>
                  {t(`visitType.${a.visitType}`)} · {a.durationMinutes} min
                </span>
              </div>
              {a.createdByName && (
                <div className="flex items-center gap-2 text-ink-muted">
                  <User className="h-4 w-4 text-ink-subtle" aria-hidden />
                  <span>{t('appointments.booked_by', { name: a.createdByName })}</span>
                </div>
              )}
            </dl>
            {(a.reason || a.notes || a.cancelledReason) && (
              <div className="space-y-1 rounded-lg bg-canvas p-3 text-sm">
                {a.reason && (
                  <p>
                    <span className="text-ink-subtle">{t('appointments.reason')}:</span> {a.reason}
                  </p>
                )}
                {a.notes && (
                  <p>
                    <span className="text-ink-subtle">{t('appointments.notes')}:</span> {a.notes}
                  </p>
                )}
                {a.cancelledReason && (
                  <p className="text-danger">
                    <span className="opacity-70">{t('common.reason')}:</span> {a.cancelledReason}
                  </p>
                )}
              </div>
            )}
            {(actions.length > 0 || canReschedule || !!a.consultationId) && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {actions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant={ACTION_VARIANT[action] ?? 'secondary'}
                    loading={busy === action}
                    onClick={() => (action === 'cancel' || action === 'no-show' ? setConfirming(action) : void run(action))}
                  >
                    {t(ACTION_LABEL[action])}
                  </Button>
                ))}
                {a.consultationId && can(PERMISSIONS.CONSULTATIONS_VIEW) && (
                  <Button size="sm" variant="secondary" onClick={() => (onClose(), navigate(`/consultations/${a.consultationId}`))}>
                    {t('consultation.open')}
                  </Button>
                )}
                {canReschedule && (
                  <Button size="sm" variant="secondary" onClick={() => setMode('reschedule')}>
                    {t('appointments.reschedule')}
                  </Button>
                )}
              </div>
            )}
            <section aria-labelledby="appt-history">
              <h3 id="appt-history" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <History className="h-3.5 w-3.5" aria-hidden /> {t('appointments.history')}
              </h3>
              <ol className="space-y-1.5 text-sm">
                {a.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-2xs text-ink-subtle">{formatDateTime(h.createdAt)}</span>
                    <span className="text-ink">{describeHistory(h, t)}</span>
                    {h.changedByName && <span className="text-xs text-ink-muted">· {h.changedByName}</span>}
                    {h.reason && <span className="text-xs text-ink-muted">— {h.reason}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        {a && mode === 'reschedule' && (
          <div className="space-y-4">
            {overbookNeeded && (
              <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft/70 p-3 text-sm text-ink">
                {overbookNeeded.map((i) => (
                  <p key={i}>{t(`appointments.issue_${i}`)}</p>
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('appointments.doctor')}>
                <select className="input" value={resched.doctorId} onChange={(e) => setResched((r) => ({ ...r, doctorId: e.target.value, time: '' }))}>
                  {doctors.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('appointments.date')}>
                <Input type="date" min={today} value={resched.date} onChange={(e) => setResched((r) => ({ ...r, date: e.target.value, time: '' }))} />
              </Field>
              <Field label={t('appointments.custom_time')}>
                <Input type="time" value={resched.time} onChange={(e) => setResched((r) => ({ ...r, time: e.target.value }))} />
              </Field>
            </div>
            <SlotPicker doctorId={resched.doctorId} date={resched.date} value={resched.time} excludeAppointmentId={a.id} onChange={(time) => setResched((r) => ({ ...r, time }))} />
            <Field label={t('common.reason')} optional>
              <Input value={resched.reason} onChange={(e) => setResched((r) => ({ ...r, reason: e.target.value }))} />
            </Field>
            <p className="text-xs text-ink-muted">
              {t('appointments.date')}: {formatDayLabel(zonedDate(new Date(a.startsAt), tz), { day: 'numeric', month: 'short' })} {zonedTime(new Date(a.startsAt), tz)} →{' '}
              {resched.time ? `${formatDayLabel(resched.date, { day: 'numeric', month: 'short' })} ${resched.time}` : '…'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode('view')}>
                {t('common.back')}
              </Button>
              {overbookNeeded ? (
                <Button variant="danger" loading={busy === 'reschedule'} onClick={() => void reschedule(true)}>
                  {t('appointments.book_anyway')}
                </Button>
              ) : (
                <Button disabled={!resched.time} loading={busy === 'reschedule'} onClick={() => void reschedule(false)}>
                  {t('appointments.reschedule')}
                </Button>
              )}
            </div>
          </div>
        )}
        {a?.token?.onHold && mode === 'view' && <Badge className="mt-3">{t('queue.on_hold')}</Badge>}
      </Modal>
      <ConfirmDialog
        open={confirming === 'cancel'}
        title={t('appointments.cancel_title')}
        body={t('appointments.cancel_body')}
        confirmLabel={t('appointments.cancel')}
        requireReason
        loading={busy === 'cancel'}
        onClose={() => setConfirming(null)}
        onConfirm={(reason) => void run('cancel', reason)}
      />
      <ConfirmDialog
        open={confirming === 'no-show'}
        title={t('appointments.no_show_title')}
        confirmLabel={t('appointments.no_show')}
        loading={busy === 'no-show'}
        onClose={() => setConfirming(null)}
        onConfirm={() => void run('no-show')}
      />
    </>
  );
}

function describeHistory(h: AppointmentDetail['history'][number], t: (k: string, o?: Record<string, unknown>) => string): string {
  if (h.action === 'CREATED') return t('appointments.history_created');
  if (h.action === 'RESCHEDULED') return t('appointments.history_rescheduled');
  if (h.action === 'STATUS_CHANGED' && h.fromStatus && h.toStatus) {
    return t('appointments.history_status', { from: t(`appointmentStatus.${h.fromStatus}`), to: t(`appointmentStatus.${h.toStatus}`) });
  }
  const d = h.details ?? {};
  if (typeof d.token === 'string') return t('appointments.history_token', { token: d.token });
  if (d.onHold === true) return t('appointments.history_held');
  if (d.onHold === false) return t('appointments.history_resumed');
  return t('appointments.history_updated');
}

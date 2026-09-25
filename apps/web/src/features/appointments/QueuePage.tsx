import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Activity, BellRing, ClipboardList, Megaphone, Pause, Play, Plus, Radio, UserCheck } from 'lucide-react';
import { PERMISSIONS, zonedDate, type AppointmentAction, type QueueEntryDto } from '@chamber/shared';
import { ActionMenu, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { appointmentsApi, queueApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useChamberTz, useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatRelative, formatTimeIn } from '@/utils/format';
import { AppointmentStatusBadge, TokenPill } from './components/AppointmentBits';
import { availableActions } from './components/appointmentActions';
import { AppointmentDetailModal } from './components/AppointmentDetailModal';
import { BookAppointmentModal } from './components/BookAppointmentModal';
import { RecordVitalsModal } from '@/features/consultations/components/RecordVitalsModal';

const REFRESH_MS = 10_000;

/** Live chamber queue (spec §8): Token | Patient | Appointment | Status | Doctor + actions. */
export function QueuePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const tz = useChamberTz();
  const today = useToday();
  const doctors = useDoctors();
  const [date, setDate] = useState(today);
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<QueueEntryDto | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [vitalsFor, setVitalsFor] = useState<QueueEntryDto | null>(null);
  const navigate = useNavigate();
  const isToday = date === today;

  const q = useQuery({
    queryKey: ['queue', date, doctorId],
    queryFn: () => queueApi.get({ date, doctorId: doctorId || undefined }),
    refetchInterval: isToday ? REFRESH_MS : false,
  });
  useEffect(() => {
    if (!doctorId && doctors.data?.length === 1) setDoctorId(doctors.data[0]!.id);
  }, [doctors.data, doctorId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
  };
  const onError = (err: unknown) => toast.error(errorMessage(err));

  const callNext = useMutation({
    mutationFn: () => queueApi.callNext(doctorId),
    onSuccess: (entry) => {
      if (!entry) toast.info(t('queue.none_waiting'));
      else setAnnounce(t('queue.calling', { token: entry.token?.label ?? '', name: entry.patient.fullName }));
      refresh();
    },
    onError,
  });
  const queueAction = useMutation({
    mutationFn: ({ kind, id }: { kind: 'call' | 'hold' | 'resume'; id: string }) => queueApi[kind](id),
    onSuccess: (entry, v) => {
      if (v.kind === 'call') setAnnounce(t('queue.calling', { token: entry.token?.label ?? '', name: entry.patient.fullName }));
      refresh();
    },
    onError,
  });
  const apptAction = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: AppointmentAction; reason?: string }) => appointmentsApi.act(id, action, { reason }),
    onSuccess: (appt, v) => {
      setCancelling(null);
      refresh();
      // Starting the visit opens the consultation workspace.
      if (v.action === 'start' && appt.consultationId) navigate(`/consultations/${appt.consultationId}`);
    },
    onError,
  });

  useEffect(() => {
    if (!announce) return;
    const id = window.setTimeout(() => setAnnounce(null), 8000);
    return () => window.clearTimeout(id);
  }, [announce]);

  const data = q.data;
  const serving = data?.entries.filter((e) => e.status === 'IN_CONSULTATION') ?? [];
  // A doctor sees one patient at a time: hide "Start" while their consultation is in progress.
  const busyDoctors = new Set(serving.map((e) => e.doctor.id));
  const canManage = can(PERMISSIONS.QUEUE_MANAGE);
  const canCallFor = !!doctorId && canManage && (!user?.doctorId || user.doctorId === doctorId) && isToday;

  return (
    <div>
      <PageHeader
        title={t('queue.title')}
        subtitle={t('queue.subtitle')}
        actions={
          <>
            {can(PERMISSIONS.APPOINTMENTS_CREATE) && isToday && (
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setWalkIn(true)}>
                {t('appointments.walk_in_badge')}
              </Button>
            )}
            {canCallFor && (
              <Button icon={<Megaphone className="h-4 w-4" />} loading={callNext.isPending} onClick={() => callNext.mutate()}>
                {t('queue.call_next')}
              </Button>
            )}
          </>
        }
      />

      <div aria-live="assertive" className="sr-only">
        {announce}
      </div>
      {announce && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-primary-800">
          <BellRing className="h-5 w-5" aria-hidden />
          <p className="text-base font-semibold">{announce}</p>
        </div>
      )}

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <Input type="date" aria-label={t('appointments.date')} className="!w-auto" value={date} onChange={(e) => setDate(e.target.value || today)} />
        <Select aria-label={t('queue.doctor')} className="!w-auto" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">{t('appointments.all_doctors')}</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        {isToday && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-success">
            <Radio className={clsx('h-3.5 w-3.5', q.isFetching && 'animate-pulse')} aria-hidden /> {t('queue.refreshing')}
            {q.dataUpdatedAt > 0 && <span className="text-ink-subtle">· {t('queue.last_updated', { time: formatTimeIn(new Date(q.dataUpdatedAt), tz) })}</span>}
          </span>
        )}
        {!doctorId && canManage && isToday && <p className="w-full text-2xs text-ink-subtle">{t('queue.choose_doctor')}</p>}
      </div>

      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['waiting', data.summary.waiting, 'warning'],
              ['on_hold', data.summary.onHold, 'neutral'],
              ['in_consultation', data.summary.inConsultation, 'primary'],
              ['completed', data.summary.completed, 'success'],
              ['checked_in', data.summary.checkedIn, 'info'],
              ['booked', data.summary.booked, 'neutral'],
            ] as const
          ).map(([key, value, tone]) => (
            <div key={key} className="card p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{t(`queue.${key}`)}</p>
              <p className={clsx('mt-0.5 text-2xl font-semibold tabular-nums', tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink')}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {serving.length > 0 && (
        <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('queue.now_serving')}>
          {serving.map((e) => (
            <div key={e.id} className="card flex items-center gap-4 border-primary-200 bg-primary-50/60 p-4">
              <TokenPill label={e.token?.label ?? '—'} />
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wide text-primary-700">{t('queue.now_serving')}</p>
                <p className="truncate font-semibold text-ink">{e.patient.fullName}</p>
                <p className="truncate text-xs text-ink-muted">{e.doctor.fullName}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="card overflow-hidden">
        {q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : data && data.entries.length === 0 ? (
          <EmptyState
            title={t('queue.empty')}
            action={
              can(PERMISSIONS.APPOINTMENTS_CREATE) ? (
                <Link to="/appointments?new=1" className="text-sm font-medium text-primary-700 hover:underline">
                  {t('appointments.new')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <caption className="sr-only">{t('queue.title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-20">
                    {t('queue.token')}
                  </th>
                  <th scope="col">{t('queue.patient')}</th>
                  <th scope="col" className="hidden md:table-cell">
                    {t('queue.appointment')}
                  </th>
                  <th scope="col">{t('queue.status')}</th>
                  <th scope="col" className="hidden lg:table-cell">
                    {t('queue.doctor')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('queue.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.entries.map((e) => {
                  const actions = availableActions(e, { can, doctorId: user?.doctorId ?? null, today, apptDay: zonedDate(new Date(e.startsAt), tz) }).filter(
                    (a) => a !== 'start' || !busyDoctors.has(e.doctor.id),
                  );
                  const waiting = e.status === 'WAITING' || e.status === 'CHECKED_IN';
                  const ownQueue = !user?.doctorId || user.doctorId === e.doctor.id;
                  const primary: AppointmentAction | null = actions.includes('check-in')
                    ? 'check-in'
                    : actions.includes('start')
                      ? 'start'
                      : actions.includes('complete')
                        ? 'complete'
                        : actions.includes('send-to-queue')
                          ? 'send-to-queue'
                          : null;
                  return (
                    <tr key={e.id} className={clsx(e.status === 'IN_CONSULTATION' && 'bg-primary-50/50', e.token?.onHold && 'opacity-70', e.status === 'COMPLETED' && 'text-ink-muted')}>
                      <td>{e.token ? <TokenPill label={e.token.label} onHold={e.token.onHold} /> : <span className="text-ink-subtle">—</span>}</td>
                      <td>
                        <button type="button" className="text-left font-medium text-ink hover:underline" onClick={() => setSelected(e.id)}>
                          {e.patient.fullName}
                        </button>
                        <p className="text-2xs text-ink-subtle">
                          <span className="font-mono">{e.patient.patientCode}</span>
                          {e.patient.age !== null && <> · {t('patients.age_value', { count: e.patient.age })}</>}
                          {e.reason && <> · {e.reason}</>}
                        </p>
                      </td>
                      <td className="hidden whitespace-nowrap text-ink-muted md:table-cell">
                        {formatTimeIn(e.startsAt, tz)} · {t(`visitType.${e.visitType}`)}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <AppointmentStatusBadge status={e.status} />
                          {e.token?.onHold && <Badge>{t('queue.on_hold')}</Badge>}
                        </div>
                        {waiting && e.waitingSince && (
                          <p className="mt-0.5 text-2xs text-ink-subtle">
                            {e.token?.calledAt ? t('queue.called', { time: formatRelative(e.token.calledAt) }) : t('queue.waiting_for', { time: formatRelative(e.waitingSince) })}
                            {e.token && e.token.callCount > 1 && ` · ${t('queue.called_times', { count: e.token.callCount })}`}
                          </p>
                        )}
                      </td>
                      <td className="hidden text-ink-muted lg:table-cell">{e.doctor.fullName}</td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {e.status === 'IN_CONSULTATION' && e.consultationId && can(PERMISSIONS.CONSULTATIONS_VIEW) && ownQueue && (
                            <Button size="sm" icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => navigate(`/consultations/${e.consultationId}`)}>
                              {t('consultation.open')}
                            </Button>
                          )}
                          {primary && !(e.status === 'IN_CONSULTATION' && e.consultationId && ownQueue && can(PERMISSIONS.CONSULTATIONS_VIEW)) && (
                            <Button
                              size="sm"
                              variant={primary === 'send-to-queue' ? 'secondary' : 'primary'}
                              icon={primary === 'check-in' ? <UserCheck className="h-3.5 w-3.5" /> : primary === 'start' ? <Play className="h-3.5 w-3.5" /> : undefined}
                              loading={apptAction.isPending && apptAction.variables?.id === e.id}
                              onClick={() => apptAction.mutate({ id: e.id, action: primary })}
                            >
                              {t(`appointments.${primary.replace(/-/g, '_')}`)}
                            </Button>
                          )}
                          <ActionMenu
                            label={t('queue.actions')}
                            items={[
                              {
                                label: e.token?.calledAt ? t('queue.recall') : t('queue.call'),
                                icon: <Megaphone className="h-4 w-4" />,
                                hidden: !waiting || !canManage || !ownQueue || !e.token || !isToday,
                                onSelect: () => queueAction.mutate({ kind: 'call', id: e.id }),
                              },
                              {
                                label: e.token?.onHold ? t('queue.resume') : t('queue.hold'),
                                icon: e.token?.onHold ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />,
                                hidden: !waiting || !canManage || !e.token,
                                onSelect: () => queueAction.mutate({ kind: e.token?.onHold ? 'resume' : 'hold', id: e.id }),
                              },
                              ...actions
                                .filter((a) => a !== primary && a !== 'cancel' && a !== 'no-show')
                                .map((a) => ({ label: t(`appointments.${a.replace(/-/g, '_')}`), onSelect: () => apptAction.mutate({ id: e.id, action: a }) })),
                              {
                                label: t('consultation.record_vitals'),
                                icon: <Activity className="h-4 w-4" />,
                                hidden: !can(PERMISSIONS.VITALS_RECORD) || !['CHECKED_IN', 'WAITING', 'IN_CONSULTATION'].includes(e.status),
                                onSelect: () => setVitalsFor(e),
                              },
                              { label: t('appointments.details'), onSelect: () => setSelected(e.id) },
                              { label: t('appointments.no_show'), hidden: !actions.includes('no-show'), tone: 'danger', onSelect: () => apptAction.mutate({ id: e.id, action: 'no-show' }) },
                              { label: t('appointments.cancel'), hidden: !actions.includes('cancel'), tone: 'danger', onSelect: () => setCancelling(e) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AppointmentDetailModal appointmentId={selected} onClose={() => setSelected(null)} />
      <RecordVitalsModal appointmentId={vitalsFor?.id ?? null} patientName={vitalsFor?.patient.fullName} onClose={() => setVitalsFor(null)} />
      <BookAppointmentModal open={walkIn} onClose={() => setWalkIn(false)} defaults={{ doctorId: doctorId || undefined, walkIn: true }} />
      <ConfirmDialog
        open={!!cancelling}
        title={t('appointments.cancel_title')}
        body={t('appointments.cancel_body')}
        confirmLabel={t('appointments.cancel')}
        requireReason
        loading={apptAction.isPending}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancelling && apptAction.mutate({ id: cancelling.id, action: 'cancel', reason })}
      />
    </div>
  );
}

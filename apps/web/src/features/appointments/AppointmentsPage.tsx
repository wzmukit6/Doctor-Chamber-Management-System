import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { addDays, PERMISSIONS, weekdayOf, zonedDate, zonedParts, type AppointmentDto, type DoctorDto } from '@chamber/shared';
import { Button, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@/components/ui';
import { appointmentsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useChamberTz, useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatDayLabel, formatTimeIn } from '@/utils/format';
import { STATUS_BLOCK } from './components/AppointmentBits';
import { BookAppointmentModal, type BookingDefaults } from './components/BookAppointmentModal';
import { AppointmentDetailModal } from './components/AppointmentDetailModal';

type View = 'day' | 'week' | 'month';
/** Bangladesh work weeks start on Saturday. */
const WEEK_START = 6;
const PX_PER_MIN = 1.6;

function weekStart(date: string) {
  const back = (weekdayOf(date) - WEEK_START + 7) % 7;
  return addDays(date, -back);
}
function monthGridStart(date: string) {
  return weekStart(`${date.slice(0, 7)}-01`);
}

/** Chamber calendar with day, week and month views (spec §7). */
export function AppointmentsPage() {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const tz = useChamberTz();
  const today = useToday();
  const doctors = useDoctors();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'day';
  const date = params.get('date') || today;
  // Doctors default to their own calendar; "all" explicitly shows every doctor.
  const doctorParam = params.get('doctor');
  const doctorId = doctorParam === null ? (user?.doctorId ?? '') : doctorParam === 'all' ? '' : doctorParam;
  const [booking, setBooking] = useState<BookingDefaults | null>(params.get('new') ? {} : null);
  const [selected, setSelected] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.delete('new');
    setParams(next, { replace: true });
  };

  const range = useMemo(() => {
    if (view === 'day') return { from: date, to: date };
    if (view === 'week') {
      const s = weekStart(date);
      return { from: s, to: addDays(s, 6) };
    }
    const s = monthGridStart(date);
    return { from: s, to: addDays(s, 41) };
  }, [view, date]);

  const list = useQuery({
    queryKey: ['appointments', 'range', range, doctorId],
    queryFn: () => appointmentsApi.list({ ...range, doctorId: doctorId || undefined }),
    refetchInterval: 30_000,
  });

  const step = (dir: -1 | 1) => {
    if (view === 'day') set({ date: addDays(date, dir) });
    else if (view === 'week') set({ date: addDays(date, 7 * dir) });
    else {
      const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + dir);
      set({ date: d.toISOString().slice(0, 10) });
    }
  };

  const title =
    view === 'day'
      ? formatDayLabel(date)
      : view === 'week'
        ? `${formatDayLabel(range.from, { day: 'numeric', month: 'short' })} – ${formatDayLabel(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : formatDayLabel(`${date.slice(0, 7)}-01`, { month: 'long', year: 'numeric' });

  const visibleDoctors = (doctors.data ?? []).filter((d) => !doctorId || d.id === doctorId);
  const appts = (list.data ?? []).filter((a) => a.status !== 'CANCELLED');

  return (
    <div>
      <PageHeader
        title={t('appointments.title')}
        subtitle={t('appointments.tz_note', { tz })}
        actions={
          can(PERMISSIONS.APPOINTMENTS_CREATE) ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setBooking({ doctorId: doctorId || undefined, date: date >= today ? date : today })}>
              {t('appointments.new')}
            </Button>
          ) : undefined
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <Button variant="secondary" size="sm" onClick={() => set({ date: today })}>
          {t('appointments.today')}
        </Button>
        <div className="flex">
          <Button variant="ghost" size="sm" aria-label={t('appointments.previous')} icon={<ChevronLeft className="h-4 w-4" />} onClick={() => step(-1)} />
          <Button variant="ghost" size="sm" aria-label={t('appointments.next')} icon={<ChevronRight className="h-4 w-4" />} onClick={() => step(1)} />
        </div>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" aria-live="polite">
          {title}
        </h2>
        <Select aria-label={t('appointments.doctor')} className="!w-auto" value={doctorId} onChange={(e) => set({ doctor: e.target.value || 'all' })}>
          <option value="">{t('appointments.all_doctors')}</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        <div className="inline-flex rounded border border-border p-0.5" role="tablist" aria-label="View">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => set({ view: v })}
              className={clsx('rounded px-3 py-1 text-xs font-medium', view === v ? 'bg-primary-700 text-white' : 'text-ink-muted hover:bg-canvas')}
            >
              {t(`appointments.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {list.isError && <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />}
      {list.isLoading && <Skeleton className="h-96 w-full" />}
      {list.data && view !== 'month' && (
        <TimeGrid
          view={view}
          days={view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))}
          doctors={view === 'day' && !doctorId ? visibleDoctors : null}
          appointments={appts}
          tz={tz}
          today={today}
          canBook={can(PERMISSIONS.APPOINTMENTS_CREATE)}
          onSelect={setSelected}
          onBook={(d) => setBooking({ ...d, doctorId: d.doctorId ?? (doctorId || undefined) })}
        />
      )}
      {list.data && view === 'month' && (
        <MonthGrid start={range.from} month={date.slice(0, 7)} appointments={appts} tz={tz} today={today} onSelect={setSelected} onDay={(d) => set({ view: 'day', date: d })} />
      )}

      <BookAppointmentModal open={!!booking} onClose={() => setBooking(null)} defaults={booking ?? undefined} />
      <AppointmentDetailModal appointmentId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AppointmentBlock({ a, tz, compact, showDoctor, onClick, style }: { a: AppointmentDto; tz: string; compact?: boolean; showDoctor?: boolean; onClick: () => void; style?: React.CSSProperties }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={(e) => (e.stopPropagation(), onClick())}
      style={style}
      className={clsx('overflow-hidden rounded border border-border border-l-4 px-1.5 py-0.5 text-left text-2xs shadow-card hover:ring-2 hover:ring-primary-200', STATUS_BLOCK[a.status])}
      title={`${formatTimeIn(a.startsAt, tz)} ${a.patient.fullName} — ${t(`appointmentStatus.${a.status}`)}`}
    >
      <span className="block truncate font-semibold text-ink">
        {a.token && <span className="mr-1 rounded bg-ink/10 px-1 font-mono">{a.token.label}</span>}
        {a.patient.fullName}
      </span>
      {!compact && (
        <span className="block truncate text-ink-muted">
          {formatTimeIn(a.startsAt, tz)} · {t(`appointmentStatus.${a.status}`)}
          {showDoctor && ` · ${a.doctor.fullName}`}
        </span>
      )}
    </button>
  );
}

/** Day/week time grid. Columns are doctors (day, all doctors) or days (week). */
function TimeGrid({
  view,
  days,
  doctors,
  appointments,
  tz,
  today,
  canBook,
  onSelect,
  onBook,
}: {
  view: View;
  days: string[];
  doctors: DoctorDto[] | null;
  appointments: AppointmentDto[];
  tz: string;
  today: string;
  canBook: boolean;
  onSelect: (id: string) => void;
  onBook: (d: BookingDefaults) => void;
}) {
  const { t } = useTranslation();
  const columns = doctors
    ? doctors.map((d) => ({ key: d.id, label: d.fullName, day: days[0]!, doctorId: d.id as string | undefined }))
    : days.map((d) => ({ key: d, label: formatDayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' }), day: d, doctorId: undefined }));

  const minutesOf = (iso: string) => {
    const p = zonedParts(new Date(iso), tz);
    return p.hour * 60 + p.minute;
  };
  const inCol = (a: AppointmentDto, c: (typeof columns)[number]) => zonedDate(new Date(a.startsAt), tz) === c.day && (!c.doctorId || a.doctor.id === c.doctorId);
  const relevant = appointments.filter((a) => columns.some((c) => inCol(a, c)));
  const startHour = Math.min(8, ...relevant.map((a) => Math.floor(minutesOf(a.startsAt) / 60)));
  const endHour = Math.max(22, ...relevant.map((a) => Math.ceil(minutesOf(a.endsAt) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = (endHour - startHour) * 60 * PX_PER_MIN;
  const nowMin = minutesOf(new Date().toISOString());

  if (columns.length === 0) return <EmptyState title={t('appointments.empty_day')} />;

  return (
    <div className="card overflow-x-auto">
      <div className="flex min-w-[40rem]" style={{ minWidth: `${4 + columns.length * (view === 'week' ? 7 : 12)}rem` }}>
        <div className="w-14 shrink-0 border-r border-border">
          <div className="h-10 border-b border-border" />
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-2xs text-ink-subtle" style={{ top: (h - startHour) * 60 * PX_PER_MIN }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>
        {columns.map((c) => {
          const items = appointments.filter((a) => inCol(a, c)).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
          // Lane assignment so overlapping (overbooked) appointments sit side by side.
          const lanes: number[] = [];
          const placed = items.map((a) => {
            const s = minutesOf(a.startsAt);
            let lane = lanes.findIndex((end) => end <= s);
            if (lane === -1) lane = lanes.push(0) - 1;
            lanes[lane] = minutesOf(a.endsAt);
            return { a, lane };
          });
          const laneCount = Math.max(1, lanes.length);
          return (
            <div key={c.key} className="min-w-0 flex-1 border-r border-border last:border-r-0">
              <div className={clsx('flex h-10 items-center justify-center border-b border-border px-2 text-xs font-semibold', c.day === today ? 'text-primary-700' : 'text-ink')}>
                <span className="truncate">{c.label}</span>
              </div>
              <div
                className={clsx('relative', canBook && c.day >= today && 'cursor-copy')}
                style={{ height }}
                onClick={(e) => {
                  if (!canBook || c.day < today) return;
                  const y = e.nativeEvent.offsetY;
                  const m = Math.floor((startHour * 60 + y / PX_PER_MIN) / 15) * 15;
                  onBook({ date: c.day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, doctorId: c.doctorId });
                }}
              >
                {hours.map((h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: (h - startHour) * 60 * PX_PER_MIN }} />
                ))}
                {c.day === today && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: (nowMin - startHour * 60) * PX_PER_MIN }} aria-hidden />
                )}
                {placed.map(({ a, lane }) => {
                  const top = (minutesOf(a.startsAt) - startHour * 60) * PX_PER_MIN;
                  const h = Math.max(18, (minutesOf(a.endsAt) - minutesOf(a.startsAt)) * PX_PER_MIN - 2);
                  return (
                    <AppointmentBlock
                      key={a.id}
                      a={a}
                      tz={tz}
                      compact={h < 34}
                      showDoctor={view === 'week' && !doctors}
                      onClick={() => onSelect(a.id)}
                      style={{ position: 'absolute', top, height: h, left: `calc(${(lane / laneCount) * 100}% + 2px)`, width: `calc(${100 / laneCount}% - 4px)` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {relevant.length === 0 && <p className="border-t border-border px-4 py-3 text-center text-sm text-ink-muted">{view === 'day' ? t('appointments.empty_day') : t('appointments.empty_range')}</p>}
    </div>
  );
}

function MonthGrid({ start, month, appointments, tz, today, onSelect, onDay }: { start: string; month: string; appointments: AppointmentDto[]; tz: string; today: string; onSelect: (id: string) => void; onDay: (d: string) => void }) {
  const { t } = useTranslation();
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, AppointmentDto[]>();
  for (const a of appointments) {
    const d = zonedDate(new Date(a.startsAt), tz);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-canvas text-center text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="py-2">
            {formatDayLabel(d, { weekday: 'short' })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = (byDay.get(d) ?? []).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
          return (
            <div key={d} className={clsx('min-h-[6.5rem] border-b border-r border-border p-1.5', d.slice(0, 7) !== month && 'bg-canvas/60')}>
              <button
                type="button"
                onClick={() => onDay(d)}
                className={clsx('mb-1 rounded px-1.5 text-xs font-semibold hover:bg-canvas', d === today ? 'bg-primary-700 text-white hover:bg-primary-800' : 'text-ink-muted')}
              >
                {Number(d.slice(8))}
              </button>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((a) => (
                  <AppointmentBlock key={a.id} a={a} tz={tz} compact onClick={() => onSelect(a.id)} style={{ width: '100%', display: 'block' }} />
                ))}
                {items.length > 3 && (
                  <button type="button" onClick={() => onDay(d)} className="text-2xs font-medium text-primary-700 hover:underline">
                    {t('appointments.more', { count: items.length - 3 })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

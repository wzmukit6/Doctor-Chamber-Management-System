import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CalendarClock, CreditCard, FileText, FlaskConical, PencilLine, Stethoscope, UserPlus, Activity, Repeat } from 'lucide-react';
import { TIMELINE_TYPES, type TimelineEventDto, type TimelineType } from '@chamber/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { patientsApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { formatDate, formatDateTime } from '@/utils/format';

/** Types with data today; the rest are shown disabled until their module ships. */
const AVAILABLE: TimelineType[] = ['registration', 'record', 'appointment', 'consultation', 'diagnosis', 'investigation', 'follow_up'];

const ICONS: Record<TimelineType, typeof Activity> = {
  registration: UserPlus,
  record: PencilLine,
  appointment: CalendarClock,
  consultation: Stethoscope,
  diagnosis: Activity,
  prescription: FileText,
  investigation: FlaskConical,
  payment: CreditCard,
  follow_up: Repeat,
};

function EventItem({ event }: { event: TimelineEventDto }) {
  const { t } = useTranslation();
  const Icon = ICONS[event.type];
  const params = Object.fromEntries(Object.entries(event.details).map(([k, v]) => [k, v ?? '']));
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-primary-700">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">{t(event.titleKey, params)}</p>
      <p className="text-2xs text-ink-subtle">
        <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
        {event.actorName && <> · {t('timeline.by', { name: event.actorName })}</>}
      </p>
      {event.type === 'consultation' && event.details.complaints && <p className="mt-0.5 text-xs text-ink-muted">{event.details.complaints}</p>}
      {event.type === 'follow_up' && event.details.instructions && <p className="mt-0.5 text-xs text-ink-muted">{event.details.instructions}</p>}
      {event.details.consultationId && event.type === 'consultation' && (
        <Link to={`/consultations/${event.details.consultationId}`} className="mt-0.5 inline-block text-xs font-medium text-primary-700 hover:underline">
          {t('consultation.open')}
        </Link>
      )}
      {event.type === 'appointment' && event.details.visitType && (
        <p className="mt-0.5 text-xs text-ink-muted">{t(`visitType.${event.details.visitType}`)}</p>
      )}
      {(event.details.fields || event.details.allergen || event.details.reason) && (
        <p className="mt-1 text-xs text-ink-muted">
          {event.details.fields && t('timeline.fields', { fields: event.details.fields })}
          {event.details.allergen && <>{event.details.allergen}</>}
          {event.details.reason && <> — {event.details.reason}</>}
        </p>
      )}
    </li>
  );
}

/** Visual, filterable patient timeline grouped by day (spec §32). */
export function PatientTimeline({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState<TimelineType[]>([]);
  const query = useInfiniteQuery({
    queryKey: ['patients', patientId, 'timeline', types],
    queryFn: ({ pageParam }) => patientsApi.timeline(patientId, { types: types.join(',') || undefined, before: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.events[last.events.length - 1]?.occurredAt : undefined),
  });

  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  const groups = events.reduce<Record<string, TimelineEventDto[]>>((acc, e) => {
    const day = e.occurredAt.slice(0, 10);
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  const toggle = (type: TimelineType) => setTypes((cur) => (cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type]));

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t('timeline.title')}>
        <FilterChip active={types.length === 0} onClick={() => setTypes([])} label={t('timeline.filter_all')} />
        {TIMELINE_TYPES.map((type) => (
          <FilterChip
            key={type}
            label={t(`timeline.types.${type}`)}
            active={types.includes(type)}
            disabled={!AVAILABLE.includes(type)}
            title={!AVAILABLE.includes(type) ? t('timeline.pending_module') : undefined}
            onClick={() => toggle(type)}
          />
        ))}
      </div>
      {query.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      )}
      {query.isError && <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />}
      {!query.isLoading && !query.isError && events.length === 0 && <EmptyState title={t('timeline.empty')} />}
      <div className="space-y-6">
        {Object.entries(groups).map(([day, items]) => (
          <section key={day} aria-label={formatDate(day)}>
            <h3 className="mb-3 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{formatDate(day)}</h3>
            <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-3.5 before:top-1 before:w-px before:bg-border">
              {items.map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {query.hasNextPage && (
        <Button variant="secondary" size="sm" className="mt-4" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {t('timeline.load_more')}
        </Button>
      )}
    </div>
  );
}

function FilterChip({ label, active, disabled, onClick, title }: { label: string; active: boolean; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={clsx(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-border bg-surface text-ink-muted hover:bg-canvas',
      )}
    >
      {label}
    </button>
  );
}

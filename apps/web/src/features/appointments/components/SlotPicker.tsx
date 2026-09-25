import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { appointmentsApi } from '@/services/endpoints';
import { Skeleton } from '@/components/ui';

/** Grid of the doctor's slots for a date (booked/past slots disabled). */
export function SlotPicker({
  doctorId,
  date,
  value,
  onChange,
  excludeAppointmentId,
}: {
  doctorId: string;
  date: string;
  value: string;
  onChange: (time: string) => void;
  excludeAppointmentId?: string;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['appointments', 'availability', doctorId, date, excludeAppointmentId],
    queryFn: () => appointmentsApi.availability(doctorId, date, excludeAppointmentId),
    enabled: !!doctorId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  if (!doctorId) return null;
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  const data = q.data;
  if (!data || data.slots.length === 0) return <p className="text-xs text-ink-muted">{t('appointments.no_slots')}</p>;
  return (
    <div>
      <p className="mb-1.5 text-2xs text-ink-subtle">
        {data.windows.map((w) => `${w.startTime}–${w.endTime}`).join(', ')} · {t('appointments.slots_of', { booked: data.bookedCount })}
        {data.maxDailyPatients ? ` / ${data.maxDailyPatients}` : ''}
      </p>
      <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6" role="radiogroup" aria-label={t('appointments.slots')}>
        {data.slots.map((s) => (
          <button
            key={s.time}
            type="button"
            role="radio"
            aria-checked={value === s.time}
            disabled={!s.available}
            title={!s.available && !s.past ? t('appointments.slot_booked') : undefined}
            onClick={() => onChange(s.time)}
            className={clsx(
              'rounded border px-1 py-1.5 font-mono text-xs transition-colors',
              value === s.time
                ? 'border-primary-700 bg-primary-700 text-white'
                : s.available
                  ? 'border-border bg-surface text-ink hover:border-primary-500 hover:bg-primary-50'
                  : 'cursor-not-allowed border-border bg-canvas text-ink-subtle line-through',
            )}
          >
            {s.time}
          </button>
        ))}
      </div>
    </div>
  );
}

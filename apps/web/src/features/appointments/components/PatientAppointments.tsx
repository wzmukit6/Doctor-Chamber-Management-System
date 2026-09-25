import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addDays } from '@chamber/shared';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { appointmentsApi } from '@/services/endpoints';
import { useChamberTz, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatDateIn, formatTimeIn } from '@/utils/format';
import { AppointmentStatusBadge } from './AppointmentBits';
import { AppointmentDetailModal } from './AppointmentDetailModal';

/** A patient's appointments (upcoming first, then past) on the profile page. */
export function PatientAppointments({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const tz = useChamberTz();
  const today = useToday();
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['appointments', 'patient', patientId],
    queryFn: () => appointmentsApi.list({ patientId, from: addDays(today, -3 * 365), to: addDays(today, 365) }),
  });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const now = Date.now();
  const rows = [...(q.data ?? [])].sort((a, b) => {
    const af = new Date(a.startsAt).getTime() >= now;
    const bf = new Date(b.startsAt).getTime() >= now;
    if (af !== bf) return af ? -1 : 1;
    return af ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt);
  });
  if (rows.length === 0) return <EmptyState title={t('appointments.no_patient_appointments')} />;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => setSelected(a.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 text-left hover:bg-canvas">
              <span className="w-36 text-sm font-medium text-ink">
                {formatDateIn(a.startsAt, tz)} · {formatTimeIn(a.startsAt, tz)}
              </span>
              <span className="flex-1 text-sm text-ink-muted">
                {a.doctor.fullName} · {t(`visitType.${a.visitType}`)}
                {a.reason && ` · ${a.reason}`}
              </span>
              <AppointmentStatusBadge status={a.status} />
            </button>
          </li>
        ))}
      </ul>
      <AppointmentDetailModal appointmentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

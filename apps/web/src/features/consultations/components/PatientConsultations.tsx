import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { consultationsApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

/** A patient's consultation history on the profile (spec §12, §13 "track patient history"). */
export function PatientConsultations({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['consultations', 'patient', patientId], queryFn: () => consultationsApi.list({ patientId, pageSize: 50 }) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState title={t('consultation.empty')} />;
  return (
    <ul className="divide-y divide-border">
      {q.data.items.map((c) => (
        <li key={c.id}>
          <Link to={`/consultations/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-canvas">
            <span className="w-28 text-sm font-medium text-ink">{formatDate(c.finalizedAt ?? c.startedAt)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{c.primaryDiagnosis ?? (c.complaints.join(', ') || '—')}</span>
              <span className="text-2xs text-ink-subtle">
                {t('consultation.visit', { n: c.visitNumber })} · {c.doctor.fullName}
                {c.investigationCount > 0 && ` · ${t('consultation.investigation_count', { count: c.investigationCount })}`}
                {c.followUpDate && ` · ${t('consultation.follow_up')}: ${formatDate(c.followUpDate)}`}
              </span>
            </span>
            <Badge tone={c.status === 'FINALIZED' ? 'success' : 'warning'} dot>
              {t(`consultation.${c.status.toLowerCase()}`)}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

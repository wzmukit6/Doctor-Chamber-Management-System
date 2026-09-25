import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { PERMISSIONS } from '@chamber/shared';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { prescriptionsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { RX_STATUS_TONE } from '../PrescriptionsPage';

/** A patient's prescriptions on the profile (spec §12 "view previous prescriptions"). */
export function PatientPrescriptions({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['prescriptions', 'list', 'patient', patientId], queryFn: () => prescriptionsApi.list({ patientId, pageSize: 50 }) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState title={t('rx.none_for_patient')} />;
  return (
    <ul className="divide-y divide-border">
      {q.data.items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5">
          <Link to={`/prescriptions/${p.id}`} className="w-28 font-mono text-xs font-medium text-primary-800 hover:underline">
            {p.rxNumber ?? t('rx.unissued')}
            {p.currentVersion > 1 && <span className="text-ink-subtle"> v{p.currentVersion}</span>}
          </Link>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{p.primaryDiagnosis ?? '—'}</span>
            <span className="text-2xs text-ink-subtle">
              {formatDate(p.issuedAt ?? p.createdAt)} · {p.doctor.fullName} · {t('rx.medicine_count', { count: p.itemCount })}
            </span>
          </span>
          <Badge tone={RX_STATUS_TONE[p.status]} dot>
            {t(`rxStatus.${p.status}`)}
          </Badge>
          {p.rxNumber && can(PERMISSIONS.PRESCRIPTIONS_PRINT) && (
            <Link to={`/prescriptions/${p.id}/print`} target="_blank" rel="noopener" aria-label={t('rx.print_named', { rx: p.rxNumber })} className="rounded p-1.5 text-ink-subtle hover:bg-canvas hover:text-ink">
              <Printer className="h-4 w-4" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

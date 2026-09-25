import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { invoicesApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { useMoney } from '../money';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';

/** A patient's bills and outstanding dues on the profile. */
export function PatientInvoices({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const q = useQuery({ queryKey: ['invoices', 'list', 'patient', patientId], queryFn: () => invoicesApi.list({ patientId, pageSize: 50 }) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data?.items ?? [];
  if (!rows.length) return <EmptyState title={t('billing.none_for_patient')} />;
  const due = rows.reduce((s, i) => s + i.due, 0);
  return (
    <div>
      {due > 0 && <p className="mb-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{t('billing.patient_due', { amount: money(due) })}</p>}
      <ul className="divide-y divide-border">
        {rows.map((i) => (
          <li key={i.id}>
            <Link to={`/billing/invoices/${i.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-canvas">
              <span className="w-28 font-mono text-xs font-medium text-primary-800">{i.invoiceNumber}</span>
              <span className="min-w-0 flex-1 text-sm text-ink">
                {formatDate(i.issuedAt)}
                {i.doctor && <span className="text-ink-subtle"> · {i.doctor.fullName}</span>}
              </span>
              <span className="text-sm tabular-nums">{money(i.total)}</span>
              {i.due > 0 && <span className="text-sm font-semibold tabular-nums text-danger">{t('billing.due_amount', { amount: money(i.due) })}</span>}
              <InvoiceStatusBadge status={i.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

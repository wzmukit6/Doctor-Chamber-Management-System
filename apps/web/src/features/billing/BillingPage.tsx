import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertCircle, Banknote, FileText, Plus, Receipt, Search } from 'lucide-react';
import { addDays, PERMISSIONS, type InvoiceSummaryDto } from '@chamber/shared';
import { Button, DataTable, EmptyState, Input, PageHeader, Select, Skeleton, type Column } from '@/components/ui';
import { invoicesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors, useToday } from '@/hooks/useChamber';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { InvoiceStatusBadge } from './components/InvoiceStatusBadge';
import { FeesTab } from './FeesTab';
import { useMoney } from './money';

/** Billing & payments (spec §18): bills, collections summary and the fee schedule. */
export function BillingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (['invoices', 'summary', 'fees'] as const).find((k) => k === params.get('tab')) ?? 'invoices';
  return (
    <div>
      <PageHeader
        title={t('billing.title')}
        subtitle={t('billing.subtitle')}
        actions={
          can(PERMISSIONS.BILLING_CREATE) && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/billing/new')}>
              {t('billing.new')}
            </Button>
          )
        }
      />
      <div className="mb-4 border-b border-border" role="tablist">
        <div className="-mb-px flex gap-1">
          {(['invoices', 'summary', 'fees'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setParams(k === 'invoices' ? {} : { tab: k })}
              className={clsx('border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary-700 text-primary-800' : 'border-transparent text-ink-muted hover:text-ink')}
            >
              {t(`billing.tab_${k}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'invoices' ? <InvoicesTab /> : tab === 'summary' ? <SummaryTab /> : <FeesTab />}
    </div>
  );
}

export function StatTile({ label, value, icon, tone, hint, loading }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'success' | 'danger'; hint?: string; loading?: boolean }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <span className={clsx('flex h-9 w-9 items-center justify-center rounded-lg', tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'success' ? 'bg-success-soft text-success' : 'bg-primary-50 text-primary-700')}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-ink-subtle">{label}</p>
        {loading ? <Skeleton className="mt-1 h-6 w-24" /> : <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>}
        {hint && <p className="text-2xs text-ink-subtle">{hint}</p>}
      </div>
    </div>
  );
}

function InvoicesTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const today = useToday();
  const doctors = useDoctors();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 250);
  const params = { page, pageSize: 20, q: q || undefined, status: status || undefined, doctorId: doctorId || undefined, from: status === 'OPEN' ? undefined : from || undefined, to: status === 'OPEN' ? undefined : to || undefined };
  const list = useQuery({ queryKey: ['invoices', 'list', params], queryFn: () => invoicesApi.list(params), placeholderData: keepPreviousData });
  const summary = useQuery({ queryKey: ['invoices', 'summary', today, today], queryFn: () => invoicesApi.summary({ from: today, to: today }) });
  const s = summary.data;

  const columns: Column<InvoiceSummaryDto>[] = [
    {
      key: 'no',
      header: t('billing.invoice_no'),
      cell: (i) => (
        <Link to={`/billing/invoices/${i.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-primary-800 hover:underline">
          {i.invoiceNumber}
        </Link>
      ),
    },
    { key: 'date', header: t('billing.date'), cell: (i) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(i.issuedAt)}</span> },
    {
      key: 'patient',
      header: t('appointments.patient'),
      cell: (i) => (
        <span>
          <span className="font-medium text-ink">{i.patient.fullName}</span>
          <span className="block font-mono text-2xs text-ink-subtle">{i.patient.patientCode}</span>
        </span>
      ),
    },
    { key: 'doctor', header: t('appointments.doctor'), hideOnMobile: true, cell: (i) => <span className="text-ink-muted">{i.doctor?.fullName ?? '—'}</span> },
    { key: 'total', header: t('billing.total'), className: 'text-right', cell: (i) => <span className="tabular-nums">{money(i.total)}</span> },
    { key: 'paid', header: t('billing.paid'), className: 'text-right', hideOnMobile: true, cell: (i) => <span className="tabular-nums text-success">{money(i.paid)}</span> },
    { key: 'due', header: t('billing.due'), className: 'text-right', cell: (i) => <span className={clsx('tabular-nums', i.due > 0 ? 'font-semibold text-danger' : 'text-ink-subtle')}>{money(i.due)}</span> },
    { key: 'status', header: t('consultation.status'), cell: (i) => <InvoiceStatusBadge status={i.status} /> },
  ];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t('billing.collected_today')} value={money(s?.collected)} icon={<Banknote className="h-5 w-5" />} tone="success" loading={summary.isLoading} hint={s ? t('billing.payments_count', { count: s.paymentsCount }) : undefined} />
        <StatTile label={t('billing.billed_today')} value={money(s?.billed)} icon={<FileText className="h-5 w-5" />} loading={summary.isLoading} hint={s ? t('billing.invoices_count', { count: s.invoicesCount }) : undefined} />
        <button type="button" className="text-left" onClick={() => (setStatus('OPEN'), setPage(1))}>
          <StatTile label={t('billing.outstanding')} value={money(s?.outstanding)} icon={<AlertCircle className="h-5 w-5" />} tone="danger" loading={summary.isLoading} hint={s ? t('billing.open_bills', { count: s.outstandingCount }) : undefined} />
        </button>
      </div>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input type="search" className="pl-9" aria-label={t('common.search')} placeholder={t('billing.search')} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <Select aria-label={t('consultation.status')} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">{t('common.all')}</option>
          <option value="OPEN">{t('billing.open_dues')}</option>
          {(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const).map((x) => (
            <option key={x} value={x}>
              {t(`invoiceStatus.${x}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('appointments.doctor')} value={doctorId} onChange={(e) => (setDoctorId(e.target.value), setPage(1))}>
          <option value="">{t('appointments.all_doctors')}</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label={t('audit.from')} disabled={status === 'OPEN'} value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        <Input type="date" aria-label={t('audit.to')} disabled={status === 'OPEN'} value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
      </div>
      <DataTable
        caption={t('billing.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={<EmptyState icon={<Receipt className="h-6 w-6" />} title={t('billing.empty')} description={t('billing.empty_help')} />}
      />
    </>
  );
}

function SummaryTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const today = useToday();
  const doctors = useDoctors();
  const { user } = useAuth();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? '');
  const q = useQuery({ queryKey: ['invoices', 'summary', from, to, doctorId], queryFn: () => invoicesApi.summary({ from, to, doctorId: doctorId || undefined }), enabled: !!from && !!to && from <= to });
  const s = q.data;
  const presets: [string, string, string][] = [
    [t('billing.preset_today'), today, today],
    [t('billing.preset_7'), addDays(today, -6), today],
    [t('billing.preset_30'), addDays(today, -29), today],
  ];
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label>
          <span className="label">{t('audit.from')}</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="label">{t('audit.to')}</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Select aria-label={t('appointments.doctor')} className="!w-auto" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">{t('appointments.all_doctors')}</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        <div className="flex gap-1">
          {presets.map(([label, f, tt]) => (
            <Button key={label} size="sm" variant={from === f && to === tt ? 'primary' : 'secondary'} onClick={() => (setFrom(f), setTo(tt))}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t('billing.collected')} value={money(s?.collected)} icon={<Banknote className="h-5 w-5" />} tone="success" loading={q.isLoading} hint={s?.refunded ? t('billing.after_refunds', { amount: money(s.refunded) }) : undefined} />
        <StatTile label={t('billing.billed')} value={money(s?.billed)} icon={<FileText className="h-5 w-5" />} loading={q.isLoading} hint={s ? t('billing.invoices_count', { count: s.invoicesCount }) : undefined} />
        <StatTile label={t('billing.discounts')} value={money(s?.discounts)} icon={<Receipt className="h-5 w-5" />} loading={q.isLoading} />
        <StatTile label={t('billing.outstanding')} value={money(s?.outstanding)} icon={<AlertCircle className="h-5 w-5" />} tone="danger" loading={q.isLoading} hint={s ? t('billing.open_bills', { count: s.outstandingCount }) : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title={t('billing.by_method')} rows={(s?.byMethod ?? []).map((r) => [t(`paymentMethod.${r.method}`), money(r.amount), t('billing.payments_count', { count: r.count })])} />
        <Breakdown title={t('billing.by_doctor')} rows={(s?.byDoctor ?? []).map((r) => [r.doctorName ?? t('billing.no_doctor'), money(r.collected), t('billing.billed_amount', { amount: money(r.billed) })])} />
        <Breakdown title={t('billing.by_collector')} rows={(s?.byCollector ?? []).map((r) => [r.userName ?? '—', money(r.amount), t('billing.payments_count', { count: r.count })])} />
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, string, string][] }) {
  const { t } = useTranslation();
  return (
    <section className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t('billing.nothing_in_period')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(([label, value, hint]) => (
            <li key={label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="text-ink">{label}</span>
                <span className="block text-2xs text-ink-subtle">{hint}</span>
              </span>
              <span className="font-semibold tabular-nums text-ink">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Printer, Search } from 'lucide-react';
import { addDays, PERMISSIONS, PRESCRIPTION_STATUSES, type PrescriptionSummaryDto } from '@chamber/shared';
import { Badge, DataTable, EmptyState, Input, PageHeader, Select, type Column } from '@/components/ui';
import { prescriptionsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors, useToday } from '@/hooks/useChamber';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { TemplatesTab } from './TemplatesTab';

export const RX_STATUS_TONE = { DRAFT: 'warning', FINALIZED: 'success', REVISED: 'info', CANCELLED: 'danger' } as const;

/** Prescription register (spec §12 "search previous prescriptions") and templates (spec §11). */
export function PrescriptionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'templates' ? 'templates' : 'list';
  const tabs = ['list', ...(can(PERMISSIONS.PRESCRIPTIONS_CREATE) || can(PERMISSIONS.TEMPLATES_MANAGE) ? ['templates'] : [])] as const;
  return (
    <div>
      <PageHeader title={t('rx.list_title')} subtitle={t('rx.list_subtitle')} />
      {tabs.length > 1 && (
        <div className="mb-4 border-b border-border" role="tablist">
          <div className="-mb-px flex gap-1">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setParams(k === 'list' ? {} : { tab: k })}
                className={clsx('border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary-700 text-primary-800' : 'border-transparent text-ink-muted hover:text-ink')}
              >
                {t(`rx.tab_${k}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'templates' ? <TemplatesTab /> : <PrescriptionList />}
    </div>
  );
}

function PrescriptionList() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const today = useToday();
  const doctors = useDoctors();
  const [search, setSearch] = useState('');
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? '');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 250);
  const seesDrafts = can(PERMISSIONS.PRESCRIPTIONS_CREATE);
  const query = { page, pageSize: 20, q: q || undefined, doctorId: doctorId || undefined, status: status || undefined, from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: ['prescriptions', 'list', query], queryFn: () => prescriptionsApi.list(query), placeholderData: keepPreviousData });

  const columns: Column<PrescriptionSummaryDto>[] = [
    {
      key: 'rx',
      header: t('rx.rx_number'),
      cell: (p) => (
        <Link to={`/prescriptions/${p.id}`} className="whitespace-nowrap font-mono text-xs font-medium text-primary-800 hover:underline">
          {p.rxNumber ?? t('rx.unissued')}
          {p.currentVersion > 1 && <span className="ml-1 text-ink-subtle">v{p.currentVersion}</span>}
        </Link>
      ),
    },
    { key: 'date', header: t('consultation.date'), cell: (p) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(p.issuedAt ?? p.createdAt)}</span> },
    {
      key: 'patient',
      header: t('appointments.patient'),
      cell: (p) => (
        <span>
          <span className="font-medium text-ink">{p.patient.fullName}</span>
          <span className="block font-mono text-2xs text-ink-subtle">{p.patient.patientCode}</span>
        </span>
      ),
    },
    { key: 'dx', header: t('consultation.primary_dx'), hideOnMobile: true, cell: (p) => <span className="text-ink">{p.primaryDiagnosis ?? '—'}</span> },
    { key: 'items', header: t('rx.medicines'), hideOnMobile: true, cell: (p) => t('rx.medicine_count', { count: p.itemCount }) },
    { key: 'doctor', header: t('appointments.doctor'), hideOnMobile: true, cell: (p) => <span className="text-ink-muted">{p.doctor.fullName}</span> },
    {
      key: 'status',
      header: t('consultation.status'),
      cell: (p) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={RX_STATUS_TONE[p.status]} dot>
            {t(`rxStatus.${p.status}`)}
          </Badge>
          {p.hasDraftRevision && <Badge tone="warning">{t('rx.revision_open')}</Badge>}
        </span>
      ),
    },
    {
      key: 'print',
      header: '',
      className: 'w-12 text-right',
      cell: (p) =>
        can(PERMISSIONS.PRESCRIPTIONS_PRINT) && p.rxNumber ? (
          <Link to={`/prescriptions/${p.id}/print`} target="_blank" rel="noopener" aria-label={t('rx.print_named', { rx: p.rxNumber })} className="inline-flex rounded p-1.5 text-ink-subtle hover:bg-canvas hover:text-ink">
            <Printer className="h-4 w-4" />
          </Link>
        ) : null,
    },
  ];

  return (
    <>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input type="search" className="pl-9" aria-label={t('common.search')} placeholder={t('rx.search_list')} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
        <Select aria-label={t('appointments.doctor')} value={doctorId} onChange={(e) => (setDoctorId(e.target.value), setPage(1))}>
          <option value="">{t('appointments.all_doctors')}</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        <Select aria-label={t('consultation.status')} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">{t('common.all')}</option>
          {PRESCRIPTION_STATUSES.filter((s) => seesDrafts || s === 'FINALIZED' || s === 'REVISED').map((s) => (
            <option key={s} value={s}>
              {t(`rxStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label={t('audit.from')} value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        <Input type="date" aria-label={t('audit.to')} value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
      </div>
      <DataTable
        caption={t('rx.list_title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={<EmptyState title={t('rx.empty')} description={t('rx.empty_help')} />}
      />
    </>
  );
}

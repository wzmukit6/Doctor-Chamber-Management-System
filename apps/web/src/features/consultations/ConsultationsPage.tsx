import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addDays, CONSULTATION_STATUSES } from '@chamber/shared';
import { Badge, DataTable, EmptyState, Input, PageHeader, Select, type Column } from '@/components/ui';
import { consultationsApi } from '@/services/endpoints';
import type { ConsultationSummaryDto } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatDate, formatDateTime } from '@/utils/format';

/** Consultation register with filters (spec §12 "search previous consultations"). */
export function ConsultationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const today = useToday();
  const doctors = useDoctors();
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? '');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 20, doctorId: doctorId || undefined, status: status || undefined, from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: ['consultations', 'list', params], queryFn: () => consultationsApi.list(params), placeholderData: keepPreviousData });

  const columns: Column<ConsultationSummaryDto>[] = [
    { key: 'date', header: t('consultation.date'), cell: (c) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(c.finalizedAt ?? c.startedAt)}</span> },
    {
      key: 'patient',
      header: t('appointments.patient'),
      cell: (c) => (
        <Link to={`/consultations/${c.id}`} className="font-medium text-ink hover:underline">
          {c.patient.fullName}
          <span className="block text-2xs font-normal text-ink-subtle">
            <span className="font-mono">{c.patient.patientCode}</span> · {t('consultation.visit', { n: c.visitNumber })}
          </span>
        </Link>
      ),
    },
    { key: 'dx', header: t('consultation.primary_dx'), cell: (c) => <span className="text-ink">{c.primaryDiagnosis ?? <span className="text-ink-subtle">{c.complaints.join(', ') || '—'}</span>}</span> },
    { key: 'tests', header: t('consultation.investigations'), hideOnMobile: true, cell: (c) => (c.investigationCount ? t('consultation.investigation_count', { count: c.investigationCount }) : '—') },
    { key: 'fu', header: t('consultation.follow_up'), hideOnMobile: true, cell: (c) => (c.followUpDate ? formatDate(c.followUpDate) : '—') },
    { key: 'doctor', header: t('appointments.doctor'), hideOnMobile: true, cell: (c) => <span className="text-ink-muted">{c.doctor.fullName}</span> },
    {
      key: 'status',
      header: t('consultation.status'),
      cell: (c) => (
        <Badge tone={c.status === 'FINALIZED' ? 'success' : c.status === 'DRAFT' ? 'warning' : 'danger'} dot>
          {t(`consultation.${c.status.toLowerCase()}`)}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('consultation.list_title')} subtitle={t('consultation.list_subtitle')} />
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
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
          {CONSULTATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`consultation.${s.toLowerCase()}`)}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label={t('audit.from')} value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
        <Input type="date" aria-label={t('audit.to')} value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
      </div>
      <DataTable
        caption={t('consultation.list_title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={<EmptyState title={t('consultation.empty')} />}
      />
    </div>
  );
}

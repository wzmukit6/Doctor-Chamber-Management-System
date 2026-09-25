import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus, Search, UserSearch } from 'lucide-react';
import { GENDERS, PERMISSIONS, type PatientSummaryDto } from '@chamber/shared';
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { patientsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { Can } from '@/permissions/Can';
import { AgeGender, PatientLine } from './components/PatientBits';

/**
 * Patient list with fast global search (spec §6): partial / typo-tolerant names,
 * patient ID, any phone format, email or date of birth; keyboard navigation;
 * recent patients when no search is active.
 */
export function PatientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounce(search.trim(), 250);

  const params = { page, pageSize: 20, q: q || undefined, gender: gender || undefined, registeredFrom: from || undefined, registeredTo: to || undefined };
  const list = useQuery({ queryKey: ['patients', 'list', params], queryFn: () => patientsApi.list(params), placeholderData: keepPreviousData });
  const recent = useQuery({ queryKey: ['patients', 'recent'], queryFn: patientsApi.recent, enabled: !q });

  const rows = list.data?.items ?? [];
  useEffect(() => setActive(0), [q, gender, from, to, page]);
  useEffect(() => inputRef.current?.focus(), []);

  const open = (p: PatientSummaryDto | undefined) => p && navigate(`/patients/${p.id}`);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(rows[active]);
    }
  };

  const meta = list.data?.meta;
  const filtered = !!(q || gender || from || to);

  return (
    <div>
      <PageHeader
        title={t('patients.title')}
        subtitle={t('patients.subtitle')}
        actions={
          <Can permission={PERMISSIONS.PATIENTS_CREATE}>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/patients/new')}>
              {t('patients.new')}
            </Button>
          </Can>
        }
      />

      <div className="card mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="patient-results"
            aria-activedescendant={rows[active] ? `patient-row-${rows[active]!.id}` : undefined}
            aria-label={t('patients.search_placeholder')}
            placeholder={t('patients.search_placeholder')}
            className="h-11 pl-9 text-base"
            value={search}
            onKeyDown={onKeyDown}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <p className="mt-1.5 hidden text-2xs text-ink-subtle sm:block">{t('patients.search_hint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select aria-label={t('patients.gender')} value={gender} onChange={(e) => (setGender(e.target.value), setPage(1))}>
            <option value="">{t('patients.any_gender')}</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {t(`gender.${g}`)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="shrink-0">{t('patients.registered_from')}</span>
            <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="shrink-0">{t('patients.registered_to')}</span>
            <Input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </label>
        </div>
      </div>

      {!q && (recent.data?.length ?? 0) > 0 && (
        <section className="mb-4" aria-labelledby="recent-patients">
          <h2 id="recent-patients" className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t('patients.recent')}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recent.data!.slice(0, 4).map((p) => (
              <div key={p.id} className="card">
                <PatientLine patient={p} to={`/patients/${p.id}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card overflow-hidden">
        {list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <caption className="sr-only">{t('patients.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('patients.patient_id')}</th>
                  <th scope="col">{t('patients.name')}</th>
                  <th scope="col">{t('patients.age')}</th>
                  <th scope="col" className="hidden md:table-cell">
                    {t('common.phone')}
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    {t('patients.blood_group')}
                  </th>
                  <th scope="col" className="hidden md:table-cell">
                    {t('patients.registered')}
                  </th>
                </tr>
              </thead>
              <tbody id="patient-results">
                {list.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))}
                {rows.map((p, idx) => (
                  <tr
                    key={p.id}
                    id={`patient-row-${p.id}`}
                    aria-selected={idx === active}
                    onClick={() => open(p)}
                    onMouseEnter={() => setActive(idx)}
                    className={clsx('cursor-pointer', idx === active && q && '!bg-primary-50/60')}
                  >
                    <td className="whitespace-nowrap font-mono text-xs text-ink-muted">{p.patientCode}</td>
                    <td>
                      <span className="font-medium text-ink">{p.fullName}</span> {p.isDemo && <Badge tone="warning">{t('app.demo')}</Badge>}
                    </td>
                    <td className="text-ink-muted">
                      <AgeGender patient={p} />
                    </td>
                    <td className="hidden text-ink-muted md:table-cell">{p.phone ?? '—'}</td>
                    <td className="hidden text-ink-muted lg:table-cell">{p.bloodGroup ?? '—'}</td>
                    <td className="hidden text-ink-muted md:table-cell">{formatDate(p.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <EmptyState
            icon={<UserSearch className="h-6 w-6" />}
            title={q ? t('patients.empty_search', { q }) : t('patients.empty')}
            description={q ? t('patients.empty_search_hint') : undefined}
            action={
              can(PERMISSIONS.PATIENTS_CREATE) ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/patients/new', { state: q ? { name: q } : undefined })}>
                  {t('patients.new')}
                </Button>
              ) : undefined
            }
          />
        )}
        {meta && meta.totalPages > 1 && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-ink-muted" aria-label="Pagination">
            <span>
              {t('common.results', { count: meta.total })} · {t('common.page_of', { page: meta.page, total: meta.totalPages })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>
                {t('common.previous')}
              </Button>
              <Button size="sm" variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => setPage(meta.page + 1)}>
                {t('common.next')}
              </Button>
            </div>
          </nav>
        )}
        {!filtered && meta && meta.totalPages <= 1 && rows.length > 0 && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-ink-muted">{t('common.results', { count: meta.total })}</p>
        )}
      </div>
    </div>
  );
}

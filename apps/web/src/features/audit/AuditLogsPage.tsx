import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { PERMISSIONS, ROLE_KEYS, type AuditLogDto } from '@chamber/shared';
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { auditApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { describeDevice, formatDateTime } from '@/utils/format';
import { describeAction } from './describe';

const RESOURCE_TYPES = ['user', 'session', 'role', 'organization', 'chamber'];

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-canvas p-2 font-mono text-2xs text-ink">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function actionTone(action: string) {
  if (/failed|locked|blocked|deleted|deactivated|removed/.test(action)) return 'danger' as const;
  if (/created|activated/.test(action)) return 'success' as const;
  if (/updated|changed|reset|permissions/.test(action)) return 'warning' as const;
  return 'neutral' as const;
}

/** Activity log UI (spec §51) with filters. Sensitive client metadata is only returned to admins/managers. */
export function AuditLogsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ from: '', to: '', role: '', action: '', resourceType: '' });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const action = useDebounce(filters.action);

  const params = {
    page,
    pageSize: 25,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    role: filters.role || undefined,
    action: action || undefined,
    resourceType: filters.resourceType || undefined,
  };
  const list = useQuery({ queryKey: ['audit', params], queryFn: () => auditApi.list(params), placeholderData: keepPreviousData });

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const verify = async () => {
    try {
      const res = await auditApi.verify();
      if (res.valid) toast.success(t('dashboard.audit_chain_ok', { count: res.checked }));
      else toast.error(t('dashboard.audit_chain_broken', { seq: res.brokenAtSeq }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rows: AuditLogDto[] = list.data?.items ?? [];
  const meta = list.data?.meta;

  return (
    <div>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={
          can(PERMISSIONS.SYSTEM_MANAGE) ? (
            <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => void verify()}>
              {t('audit.verify')}
            </Button>
          ) : undefined
        }
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('audit.from')}>
          <Input type="date" value={filters.from} onChange={set('from')} />
        </Field>
        <Field label={t('audit.to')}>
          <Input type="date" value={filters.to} onChange={set('to')} />
        </Field>
        <Field label={t('users.role')}>
          <Select value={filters.role} onChange={set('role')}>
            <option value="">{t('audit.any_role')}</option>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('audit.resource_type')}>
          <Select value={filters.resourceType} onChange={set('resourceType')}>
            <option value="">{t('audit.any_resource')}</option>
            {RESOURCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('audit.action')}>
          <Input placeholder={t('audit.filter_action')} value={filters.action} onChange={set('action')} />
        </Field>
      </div>

      <div className="card overflow-hidden">
        {list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <caption className="sr-only">{t('audit.title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8" />
                  <th scope="col">{t('audit.time')}</th>
                  <th scope="col">{t('audit.user')}</th>
                  <th scope="col">{t('audit.action')}</th>
                  <th scope="col" className="hidden md:table-cell">
                    {t('audit.resource')}
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    {t('common.reason')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))}
                {rows.map((row) => {
                  const open = expanded === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className={clsx('cursor-pointer', open && 'bg-canvas/60')} onClick={() => setExpanded(open ? null : row.id)}>
                        <td>
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={t('common.details')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded(open ? null : row.id);
                            }}
                            className="rounded p-0.5 text-ink-subtle hover:bg-canvas"
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="whitespace-nowrap text-ink-muted">{formatDateTime(row.createdAt)}</td>
                        <td>
                          <p className="font-medium text-ink">{row.userName ?? t('audit.system')}</p>
                          {row.role && <p className="text-2xs text-ink-subtle">{t(`roles.${row.role}`, { defaultValue: row.role })}</p>}
                        </td>
                        <td>
                          <Badge tone={actionTone(row.action)}>{describeAction(row.action)}</Badge>
                        </td>
                        <td className="hidden md:table-cell">
                          <span className="text-ink-muted">{row.resourceType}</span>
                          {row.resourceId && <span className="ml-1 font-mono text-2xs text-ink-subtle">{row.resourceId.slice(0, 8)}</span>}
                        </td>
                        <td className="hidden max-w-xs truncate text-ink-muted lg:table-cell">{row.reason ?? ''}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td />
                          <td colSpan={5} className="bg-canvas/40">
                            <div className="space-y-3 py-1">
                              <div className="grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
                                <p>
                                  <span className="font-medium text-ink">{t('audit.action')}:</span> <code>{row.action}</code>
                                </p>
                                {row.ipAddress && (
                                  <p>
                                    <span className="font-medium text-ink">{t('audit.ip')}:</span> {row.ipAddress}
                                  </p>
                                )}
                                {row.userAgent && (
                                  <p>
                                    <span className="font-medium text-ink">{t('audit.device')}:</span> {describeDevice(row.userAgent)}
                                  </p>
                                )}
                                {row.reason && (
                                  <p className="sm:col-span-3">
                                    <span className="font-medium text-ink">{t('common.reason')}:</span> {row.reason}
                                  </p>
                                )}
                              </div>
                              {(row.oldValue !== null || row.newValue !== null) && (
                                <div className="flex flex-col gap-3 md:flex-row">
                                  <ValueBlock label={t('audit.before')} value={row.oldValue} />
                                  <ValueBlock label={t('audit.after')} value={row.newValue} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!list.isLoading && !list.isError && rows.length === 0 && <EmptyState title={t('audit.empty')} />}
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
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BarChart3, Download, FileSpreadsheet, LayoutDashboard, Printer, UserRound } from 'lucide-react';
import { addDays, PERMISSIONS, type ReportCatalogEntryDto, type ReportColumnDto, type ReportResultDto } from '@chamber/shared';
import { Button, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { ColumnChart, HBarChart, LineChart, SERIES_COLORS, type Datum } from '@/components/charts/Charts';
import { reportsApi, type ReportParams } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors, useToday } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { formatDate, formatDateTime } from '@/utils/format';
import { useMoney } from '@/features/billing/money';
import { AnalyticsOverview } from './AnalyticsOverview';

type Preset = 'today' | '7' | '30' | '90' | 'month' | 'last_month' | 'custom';

export function presetRange(p: Preset, today: string): [string, string] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'today':
      return [today, today];
    case '7':
      return [addDays(today, -6), today];
    case '90':
      return [addDays(today, -89), today];
    case 'month':
      return [`${y}-${pad(m)}-01`, today];
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
      return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${pad(lastDay)}`];
    }
    default:
      return [addDays(today, -29), today];
  }
}

/** Reports & analytics (spec §19, §33, §59): role-specific reports with chart, table and CSV/Excel/PDF export. */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === 'bn' ? 'bn' : 'en') as 'en' | 'bn';
  const [params, setParams] = useSearchParams();
  const selected = params.get('r') ?? 'overview';
  const catalog = useQuery({ queryKey: ['reports', 'catalog'], queryFn: reportsApi.catalog, staleTime: 10 * 60_000 });
  const groups = (['operational', 'clinical', 'financial'] as const)
    .map((g) => ({ g, items: (catalog.data ?? []).filter((r) => r.group === g) }))
    .filter((x) => x.items.length);
  const entry = catalog.data?.find((r) => r.key === selected);

  return (
    <div>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="no-print card h-fit p-2" aria-label={t('reports.title')}>
          <button
            type="button"
            onClick={() => setParams({})}
            aria-current={selected === 'overview' ? 'page' : undefined}
            className={clsx('flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm', selected === 'overview' ? 'bg-primary-50 font-medium text-primary-800' : 'text-ink hover:bg-canvas')}
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden /> {t('reports.overview')}
          </button>
          {catalog.isLoading && <Skeleton className="mt-2 h-40 w-full" />}
          {groups.map(({ g, items }) => (
            <div key={g} className="mt-3">
              <p className="px-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{t(`reports.group_${g}`)}</p>
              <ul className="mt-1">
                {items.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => setParams({ r: r.key })}
                      aria-current={selected === r.key ? 'page' : undefined}
                      className={clsx('w-full rounded px-2.5 py-1.5 text-left text-sm', selected === r.key ? 'bg-primary-50 font-medium text-primary-800' : 'text-ink hover:bg-canvas')}
                    >
                      {r.title[lang]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0">{catalog.isLoading ? <Skeleton className="h-96" /> : entry ? <ReportView key={entry.key} entry={entry} /> : <AnalyticsOverview />}</div>
      </div>
    </div>
  );
}

function ReportView({ entry }: { entry: ReportCatalogEntryDto }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language === 'bn' ? 'bn' : 'en') as 'en' | 'bn';
  const toast = useToast();
  const { can } = useAuth();
  const today = useToday();
  const doctors = useDoctors();
  const money = useMoney();
  const [preset, setPreset] = useState<Preset>('30');
  const [range, setRange] = useState<[string, string]>(() => presetRange('30', today));
  const [doctorId, setDoctorId] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const q: ReportParams = { from: range[0], to: range[1], doctorId: doctorId || undefined };
  const report = useQuery({ queryKey: ['reports', entry.key, q], queryFn: () => reportsApi.run(entry.key, q), placeholderData: keepPreviousData, enabled: range[0] <= range[1] });
  const r = report.data?.key === entry.key ? report.data : undefined;
  const fmt = useFormatter(lang, money);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, today));
  };
  const download = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      await reportsApi.download(entry.key, { ...q, format, lang });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print card flex flex-wrap items-end gap-2 p-3">
        <label>
          <span className="label">{t('reports.period')}</span>
          <Select className="!w-auto" value={preset} disabled={r?.ignoresRange} onChange={(e) => choose(e.target.value as Preset)}>
            {(['today', '7', '30', '90', 'month', 'last_month', 'custom'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`reports.preset_${p}`)}
              </option>
            ))}
          </Select>
        </label>
        {preset === 'custom' && (
          <>
            <label>
              <span className="label">{t('audit.from')}</span>
              <Input type="date" value={range[0]} max={range[1]} onChange={(e) => setRange([e.target.value, range[1]])} />
            </label>
            <label>
              <span className="label">{t('audit.to')}</span>
              <Input type="date" value={range[1]} min={range[0]} onChange={(e) => setRange([range[0], e.target.value])} />
            </label>
          </>
        )}
        {!entry.personal && (doctors.data?.length ?? 0) > 1 && (
          <label>
            <span className="label">{t('appointments.doctor')}</span>
            <Select className="!w-auto" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">{t('appointments.all_doctors')}</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </label>
        )}
        {entry.canExport && can(PERMISSIONS.REPORTS_EXPORT) && (
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} loading={exporting === 'csv'} disabled={!r?.rows.length} onClick={() => void download('csv')}>
              CSV
            </Button>
            <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting === 'xlsx'} disabled={!r?.rows.length} onClick={() => void download('xlsx')}>
              Excel
            </Button>
            <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={!r?.rows.length} onClick={() => window.print()} title={t('reports.pdf_hint')}>
              PDF
            </Button>
          </div>
        )}
      </div>

      {report.isError && !r ? (
        <ErrorState message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
      ) : !r ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className={clsx('space-y-4 transition-opacity', report.isFetching && 'opacity-60')}>
          <div>
            <h2 className="text-lg font-semibold text-ink">{r.title[lang]}</h2>
            <p className="text-sm text-ink-muted">{entry.description[lang]}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
              {r.params.scope === 'doctor' ? (
                <span className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-primary-800">
                  <UserRound className="h-3 w-3" aria-hidden /> {t('reports.scope_doctor')}
                </span>
              ) : (
                <span>{r.params.chamberName ?? t('reports.scope_platform')}</span>
              )}
              <span>·</span>
              <span>{r.ignoresRange ? t('reports.current_state') : `${formatDate(r.params.from)} – ${formatDate(r.params.to)}`}</span>
              <span>·</span>
              <span>{t('reports.generated', { time: formatDateTime(r.generatedAt) })}</span>
            </p>
          </div>

          {r.summary.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {r.summary.map((s) => (
                <div key={s.label.en} className="card p-4">
                  <p className="text-xs text-ink-subtle">{s.label[lang]}</p>
                  <p className="mt-0.5 text-xl font-semibold text-ink">{fmt(s.type, s.value)}</p>
                </div>
              ))}
            </div>
          )}

          {r.chart && r.rows.length > 0 && <ReportChart r={r} lang={lang} fmt={fmt} />}

          <ReportTable r={r} lang={lang} fmt={fmt} />
          {r.truncated && <p className="text-xs text-warning">{t('reports.truncated')}</p>}
        </div>
      )}
    </div>
  );
}

type Fmt = (type: ReportColumnDto['type'], v: string | number | null, options?: ReportColumnDto['options']) => string;

export function useFormatter(lang: 'en' | 'bn', money: (v: number) => string): Fmt {
  return useMemo(
    () => (type, v, options) => {
      if (v === null || v === undefined || v === '') return '—';
      if (options && typeof v === 'string') return options[v]?.[lang] ?? v;
      const nf = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 });
      switch (type) {
        case 'money':
          return money(Number(v));
        case 'percent':
          return `${nf.format(Number(v))}%`;
        case 'minutes':
          return `${nf.format(Number(v))} ${lang === 'bn' ? 'মিনিট' : 'min'}`;
        case 'number':
          return nf.format(Number(v));
        case 'date':
          return /^\d{4}-\d{2}$/.test(String(v)) ? String(v) : formatDate(String(v));
        case 'datetime':
          return formatDateTime(String(v));
        default:
          return String(v);
      }
    },
    [lang, money],
  );
}

function ReportChart({ r, lang, fmt }: { r: ReportResultDto; lang: 'en' | 'bn'; fmt: Fmt }) {
  const chart = r.chart!;
  const xCol = r.columns.find((c) => c.key === chart.x);
  const valueType = r.columns.find((c) => c.key === chart.series[0]!.key)?.type ?? 'number';
  const series = chart.series.map((s, i) => ({ key: s.key, label: s.label[lang], color: SERIES_COLORS[i] ?? SERIES_COLORS[0]! }));
  const data: Datum[] = r.rows.map((row) => {
    const x = xCol?.options && typeof row[chart.x] === 'string' ? (xCol.options[row[chart.x] as string]?.[lang] ?? String(row[chart.x])) : String(row[chart.x] ?? '—');
    return { x, ...Object.fromEntries(chart.series.map((s) => [s.key, Number(row[s.key]) || 0])) } as Datum;
  });
  const formatX = (x: string) => (xCol?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x.slice(5).replace('-', '/') : x);
  const format = (v: number) => fmt(valueType, v);
  return (
    <section className="card p-4" aria-label={chart.series.map((s) => s.label[lang]).join(', ')}>
      {chart.type === 'hbar' ? (
        <HBarChart data={data} series={series[0]!} format={format} max={12} />
      ) : chart.type === 'line' ? (
        <LineChart data={data} series={series} format={format} formatX={formatX} />
      ) : (
        <ColumnChart data={data} series={series} stacked={chart.type === 'stacked'} format={format} formatX={formatX} />
      )}
    </section>
  );
}

function ReportTable({ r, lang, fmt }: { r: ReportResultDto; lang: 'en' | 'bn'; fmt: Fmt }) {
  const { t } = useTranslation();
  if (!r.rows.length) return <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={t('reports.no_data')} />;
  const numeric = (c: ReportColumnDto) => ['number', 'money', 'percent', 'minutes'].includes(c.type);
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <caption className="sr-only">{r.title[lang]}</caption>
        <thead>
          <tr>
            {r.columns.map((c) => (
              <th key={c.key} className={clsx(numeric(c) && 'text-right')}>
                {c.label[lang]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i}>
              {r.columns.map((c) => (
                <td key={c.key} className={clsx('!py-2', numeric(c) && 'text-right tabular-nums', c.key === 'patient_code' && 'font-mono text-xs')}>
                  {fmt(c.type, row[c.key] ?? null, c.options)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

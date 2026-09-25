import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { DashboardAnalyticsDto } from '@chamber/shared';
import { Button, ErrorState, Skeleton } from '@/components/ui';
import { ChartCard, ColumnChart, HBarChart, LineChart, MiniTable, SERIES_COLORS } from '@/components/charts/Charts';
import { reportsApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { useMoney } from '@/features/billing/money';

const shortDate = (d: string) => d.slice(5).replace('-', '/');

type Key = 'appointments' | 'patients' | 'revenue' | 'diagnoses' | 'status' | 'workload';

/**
 * Dashboard analytics (spec §33): patients and appointments per day, revenue,
 * new vs returning, top diagnoses, appointment status and doctor workload —
 * each only when the viewer may see that report. `only` picks a subset for dashboards.
 */
export function AnalyticsOverview({ only, compact = false }: { only?: Key[]; compact?: boolean }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['reports', 'dashboard', days], queryFn: () => reportsApi.dashboard(days), staleTime: 60_000 });
  const d = q.data;
  const want = (k: Key) => !only || only.includes(k);
  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (q.isError || !d) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const status = (s: string) => t(`appointmentStatus.${s}`, { defaultValue: s });
  const cards = cardsFor(d, t, money, status).filter((c) => want(c.key));

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map((n) => (
            <Button key={n} size="sm" variant={days === n ? 'primary' : 'secondary'} onClick={() => setDays(n)}>
              {t('reports.last_days', { count: n })}
            </Button>
          ))}
          <span className="text-xs text-ink-subtle">
            {formatDate(d.from)} – {formatDate(d.to)}
            {d.scope === 'doctor' && ` · ${t('reports.scope_doctor')}`}
          </span>
        </div>
      )}
      <div className={clsx('grid gap-4', compact ? 'lg:grid-cols-2' : 'lg:grid-cols-2')}>
        {cards.map((c) => (
          <ChartCard key={c.key} title={c.title} subtitle={compact ? t('reports.last_days', { count: days }) : c.subtitle} table={c.table} empty={c.empty}>
            {c.chart}
          </ChartCard>
        ))}
      </div>
    </div>
  );
}

function cardsFor(d: DashboardAnalyticsDto, t: (k: string, o?: Record<string, unknown>) => string, money: (v: number) => string, status: (s: string) => string) {
  const cards: { key: Key; title: string; subtitle?: string; chart: React.ReactNode; table: React.ReactNode; empty: boolean }[] = [];
  if (d.appointmentsPerDay) {
    const data = d.appointmentsPerDay.map((r) => ({ x: r.date, total: r.total }));
    cards.push({
      key: 'appointments',
      title: t('reports.chart_appointments'),
      chart: <ColumnChart data={data} series={[{ key: 'total', label: t('reports.appointments'), color: SERIES_COLORS[0]! }]} formatX={shortDate} height={200} />,
      table: <MiniTable columns={[{ key: 'date', label: t('billing.date') }, { key: 'total', label: t('reports.appointments') }, { key: 'completed', label: t('appointmentStatus.COMPLETED') }]} rows={d.appointmentsPerDay} />,
      empty: d.appointmentsPerDay.every((r) => !r.total),
    });
  }
  if (d.patientsPerDay) {
    const data = d.patientsPerDay.map((r) => ({ x: r.date, new: r.new, returning: r.returning }));
    cards.push({
      key: 'patients',
      title: t('reports.chart_patients'),
      chart: (
        <ColumnChart
          data={data}
          stacked
          series={[
            { key: 'new', label: t('reports.new'), color: SERIES_COLORS[0]! },
            { key: 'returning', label: t('reports.returning'), color: SERIES_COLORS[1]! },
          ]}
          formatX={shortDate}
          height={200}
        />
      ),
      table: <MiniTable columns={[{ key: 'date', label: t('billing.date') }, { key: 'new', label: t('reports.new') }, { key: 'returning', label: t('reports.returning') }]} rows={d.patientsPerDay} />,
      empty: d.patientsPerDay.every((r) => !r.new && !r.returning),
    });
  }
  if (d.revenuePerDay) {
    const data = d.revenuePerDay.map((r) => ({ x: r.date, collected: r.collected }));
    cards.push({
      key: 'revenue',
      title: t('reports.chart_revenue'),
      chart: <LineChart data={data} series={[{ key: 'collected', label: t('billing.collected'), color: SERIES_COLORS[0]! }]} format={(v) => money(v)} formatX={shortDate} height={200} />,
      table: (
        <MiniTable
          columns={[
            { key: 'date', label: t('billing.date') },
            { key: 'collected', label: t('billing.collected'), format: (v) => money(Number(v)) },
            { key: 'billed', label: t('billing.billed'), format: (v) => money(Number(v)) },
          ]}
          rows={d.revenuePerDay}
        />
      ),
      empty: d.revenuePerDay.every((r) => !r.collected && !r.billed),
    });
  }
  if (d.topDiagnoses) {
    const data = d.topDiagnoses.map((r) => ({ x: r.name, count: r.count }));
    cards.push({
      key: 'diagnoses',
      title: t('reports.chart_diagnoses'),
      chart: <HBarChart data={data} series={{ key: 'count', label: t('reports.times'), color: SERIES_COLORS[0]! }} />,
      table: <MiniTable columns={[{ key: 'name', label: t('consultation.diagnosis') }, { key: 'count', label: t('reports.times') }]} rows={d.topDiagnoses} />,
      empty: !d.topDiagnoses.length,
    });
  }
  if (d.appointmentStatus) {
    const data = d.appointmentStatus.map((r) => ({ x: status(r.status), count: r.count }));
    cards.push({
      key: 'status',
      title: t('reports.chart_status'),
      chart: <HBarChart data={data} series={{ key: 'count', label: t('reports.appointments'), color: SERIES_COLORS[0]! }} />,
      table: <MiniTable columns={[{ key: 'status', label: t('consultation.status'), format: (v) => status(String(v)) }, { key: 'count', label: t('reports.appointments') }]} rows={d.appointmentStatus} />,
      empty: !d.appointmentStatus.length,
    });
  }
  if (d.doctorWorkload) {
    const data = d.doctorWorkload.map((r) => ({ x: r.doctorName, completed: r.completed }));
    cards.push({
      key: 'workload',
      title: t('reports.chart_workload'),
      chart: <HBarChart data={data} series={{ key: 'completed', label: t('appointmentStatus.COMPLETED'), color: SERIES_COLORS[0]! }} />,
      table: <MiniTable columns={[{ key: 'doctorName', label: t('appointments.doctor') }, { key: 'completed', label: t('appointmentStatus.COMPLETED') }]} rows={d.doctorWorkload} />,
      empty: !d.doctorWorkload.length,
    });
  }
  return cards;
}

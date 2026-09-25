import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

/**
 * Small, dependency-free SVG charts following the chart spec: thin marks
 * (bars ≤ 24px, 4px rounded data-ends, 2px lines), recessive hairline grid,
 * a 2px surface gap between stacked segments, per-mark hover/focus tooltips
 * (crosshair on lines), a legend for ≥ 2 series and a table view.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
}
export type Datum = { x: string } & Record<string, number | string>;

export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0 and 3–5 round ticks up to the max (1, 2, 2.5, 5 × 10ⁿ steps). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : Math.abs(v) >= 1e4 ? `${Math.round(v / 100) / 10}K` : v.toLocaleString('en-US'));

interface TipState {
  left: number;
  top: number;
  title: string;
  rows: { label: string; value: string; color: string }[];
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div role="status" className="pointer-events-none absolute z-10 min-w-[8rem] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-overlay" style={{ left: tip.left, top: tip.top, transform: 'translate(-50%, calc(-100% - 8px))' }}>
      <p className="mb-1 text-2xs text-ink-subtle">{tip.title}</p>
      {tip.rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} aria-hidden />
          <span className="font-semibold text-ink">{r.value}</span>
          <span className="text-ink-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-3 text-xs text-ink-muted">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function YAxis({ ticks, y, width, format }: { ticks: number[]; y: (v: number) => number; width: number; format: (v: number) => string }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
          <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Bar with 4px rounded data-end and a square baseline. */
function barPath(x: number, y: number, w: number, h: number, rounded: boolean) {
  if (h <= 0) return '';
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

const M = { top: 8, right: 8, bottom: 24 };

export function ColumnChart({
  data,
  series,
  stacked = false,
  height = 220,
  format = compact,
  formatX = (x: string) => x,
}: {
  data: Datum[];
  series: Series[];
  stacked?: boolean;
  height?: number;
  format?: (v: number) => string;
  formatX?: (x: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => (stacked ? series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0) : Math.max(...series.map((x) => Number(d[x.key]) || 0))));
  const ticks = niceTicks(Math.max(0, ...totals));
  const left = Math.max(28, ...ticks.map((t) => format(t).length * 6.5 + 12));
  const innerW = width - left - M.right;
  const innerH = height - M.top - M.bottom;
  const max = ticks[ticks.length - 1]!;
  const y = (v: number) => innerH - (v / max) * innerH;
  const band = innerW / Math.max(1, data.length);
  const groupW = Math.min(stacked ? 24 : 24 * series.length + 2 * (series.length - 1), band * 0.72);
  const barW = stacked ? groupW : (groupW - 2 * (series.length - 1)) / series.length;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));

  const show = (i: number) => {
    const d = data[i]!;
    setHover(i);
    setTip({
      left: left + band * i + band / 2,
      top: M.top + y(totals[i]!),
      title: formatX(d.x),
      rows: series.map((s) => ({ label: s.label, value: format(Number(d[s.key]) || 0), color: s.color })),
    });
  };

  return (
    <div ref={ref} className="relative" onPointerLeave={() => (setTip(null), setHover(null))}>
      <Legend series={series} />
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        <g transform={`translate(${left},${M.top})`}>
          <YAxis ticks={ticks} y={y} width={innerW} format={format} />
          {data.map((d, i) => {
            const x0 = band * i + (band - groupW) / 2;
            let acc = 0;
            return (
              <g key={d.x} opacity={hover === null || hover === i ? 1 : 0.55}>
                {series.map((s, k) => {
                  const v = Number(d[s.key]) || 0;
                  if (stacked) {
                    const yTop = y(acc + v);
                    const h = y(acc) - yTop - (acc > 0 ? 2 : 0); // 2px surface gap between segments
                    const isTop = series.slice(k + 1).every((n) => !(Number(d[n.key]) > 0));
                    acc += v;
                    return <path key={s.key} d={barPath(x0, yTop, barW, Math.max(0, h), isTop)} fill={s.color} />;
                  }
                  const yTop = y(v);
                  return <path key={s.key} d={barPath(x0 + k * (barW + 2), yTop, barW, innerH - yTop, true)} fill={s.color} />;
                })}
                {i % every === 0 && (
                  <text x={band * i + band / 2} y={innerH + 16} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                    {formatX(d.x)}
                  </text>
                )}
                {/* Hit target: the whole band, focusable for keyboard users. */}
                <rect
                  x={band * i}
                  y={0}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatX(d.x)}: ${series.map((s) => `${s.label} ${format(Number(d[s.key]) || 0)}`).join(', ')}`}
                  onPointerMove={() => show(i)}
                  onFocus={() => show(i)}
                  onBlur={() => (setTip(null), setHover(null))}
                  className="outline-none focus-visible:stroke-primary-500"
                />
              </g>
            );
          })}
        </g>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export function LineChart({
  data,
  series,
  height = 220,
  format = compact,
  formatX = (x: string) => x,
}: {
  data: Datum[];
  series: Series[];
  height?: number;
  format?: (v: number) => string;
  formatX?: (x: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const gid = useId();
  const max0 = Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const ticks = niceTicks(max0);
  const left = Math.max(28, ...ticks.map((t) => format(t).length * 6.5 + 12));
  const innerW = width - left - M.right;
  const innerH = height - M.top - M.bottom;
  const max = ticks[ticks.length - 1]!;
  const y = (v: number) => innerH - (v / max) * innerH;
  const x = (i: number) => (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));
  const path = (key: string) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(d[key]) || 0)}`).join(' ');
  const last = data.length - 1;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setIdx(Math.max(0, Math.min(last, Math.round(rel * last))));
  };
  const tip: TipState | null =
    idx === null
      ? null
      : {
          left: left + x(idx),
          top: M.top + Math.min(...series.map((s) => y(Number(data[idx]![s.key]) || 0))),
          title: formatX(data[idx]!.x),
          rows: series.map((s) => ({ label: s.label, value: format(Number(data[idx]![s.key]) || 0), color: s.color })),
        };

  return (
    <div ref={ref} className="relative">
      <Legend series={series} />
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        <g transform={`translate(${left},${M.top})`}>
          <YAxis ticks={ticks} y={y} width={innerW} format={format} />
          {series.length === 1 && data.length > 1 && (
            <>
              <defs>
                <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={series[0]!.color} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={series[0]!.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path d={`${path(series[0]!.key)} L${x(last)},${innerH} L${x(0)},${innerH} Z`} fill={`url(#${gid})`} />
            </>
          )}
          {series.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => (
            <circle key={s.key} cx={x(last)} cy={y(Number(data[last]?.[s.key]) || 0)} r={4} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />
          ))}
          {data.map((d, i) =>
            i % every === 0 ? (
              <text key={d.x} x={x(i)} y={innerH + 16} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                {formatX(d.x)}
              </text>
            ) : null,
          )}
          {idx !== null && (
            <g>
              <line x1={x(idx)} x2={x(idx)} y1={0} y2={innerH} stroke="var(--chart-axis)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={x(idx)} cy={y(Number(data[idx]![s.key]) || 0)} r={4} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            aria-label={series.map((s) => s.label).join(', ')}
            onPointerMove={onMove}
            onPointerLeave={() => setIdx(null)}
            onFocus={() => setIdx(last)}
            onBlur={() => setIdx(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setIdx((v) => Math.max(0, (v ?? last) - 1));
              if (e.key === 'ArrowRight') setIdx((v) => Math.min(last, (v ?? 0) + 1));
            }}
            className="outline-none"
          />
        </g>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Horizontal bars: label, bar (≤ 20px), value at the tip in text ink. */
export function HBarChart({ data, series, format = compact, max: maxRows = 10 }: { data: Datum[]; series: Series; format?: (v: number) => string; max?: number }) {
  const rows = data.slice(0, maxRows);
  const max = Math.max(0, ...rows.map((d) => Number(d[series.key]) || 0)) || 1;
  return (
    <ul className="space-y-2" aria-label={series.label}>
      {rows.map((d) => {
        const v = Number(d[series.key]) || 0;
        return (
          <li key={d.x} className="grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3 text-xs" title={`${d.x}: ${format(v)}`}>
            <span className="truncate text-ink-muted">{d.x}</span>
            <span className="flex items-center gap-2">
              <span className="h-4 rounded-r" style={{ width: `${Math.max(2, (v / max) * 85)}%`, background: series.color, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }} />
              <span className="font-medium tabular-nums text-ink">{format(v)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Card with title, optional table view toggle (identity and values never depend on the chart alone). */
export function ChartCard({ title, subtitle, children, table, empty, className }: { title: string; subtitle?: string; children: ReactNode; table?: ReactNode; empty?: boolean; className?: string }) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={clsx('card p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-2xs text-ink-subtle">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button type="button" onClick={() => setAsTable((v) => !v)} className="rounded px-2 py-0.5 text-2xs font-medium text-primary-700 hover:bg-primary-50" aria-pressed={asTable}>
            {asTable ? t('reports.show_chart') : t('reports.show_table')}
          </button>
        )}
      </div>
      {empty ? <p className="py-8 text-center text-sm text-ink-subtle">{t('reports.no_data')}</p> : asTable ? table : children}
    </section>
  );
}

export function MiniTable({ columns, rows }: { columns: { key: string; label: string; format?: (v: unknown) => string }[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="table-base text-xs">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className="!py-1.5 tabular-nums">
                  {c.format ? c.format(r[c.key]) : String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

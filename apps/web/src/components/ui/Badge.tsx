import type { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted border-border',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
  primary: 'bg-primary-50 text-primary-800 border-primary-200',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Consistent status indicator (spec §28 "clear status indicators"). */
export function StatusBadge({ active, locked, labels }: { active: boolean; locked?: boolean; labels: { active: string; inactive: string; locked: string } }) {
  if (locked) return <Badge tone="warning" dot>{labels.locked}</Badge>;
  return active ? <Badge tone="success" dot>{labels.active}</Badge> : <Badge tone="neutral" dot>{labels.inactive}</Badge>;
}

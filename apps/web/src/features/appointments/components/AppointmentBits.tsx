import { useTranslation } from 'react-i18next';
import type { AppointmentStatus } from '@chamber/shared';
import { Badge, type BadgeTone } from '@/components/ui';

const TONES: Record<AppointmentStatus, BadgeTone> = {
  BOOKED: 'neutral',
  CONFIRMED: 'info',
  CHECKED_IN: 'primary',
  WAITING: 'warning',
  IN_CONSULTATION: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

export const STATUS_BLOCK: Record<AppointmentStatus, string> = {
  BOOKED: 'border-l-ink-subtle bg-surface',
  CONFIRMED: 'border-l-info bg-info-soft/60',
  CHECKED_IN: 'border-l-primary-600 bg-primary-50',
  WAITING: 'border-l-warning bg-warning-soft/70',
  IN_CONSULTATION: 'border-l-primary-700 bg-primary-100',
  COMPLETED: 'border-l-success bg-success-soft/70',
  CANCELLED: 'border-l-danger bg-danger-soft/50 line-through opacity-60',
  NO_SHOW: 'border-l-danger bg-danger-soft/50 opacity-70',
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={TONES[status]} dot>
      {t(`appointmentStatus.${status}`)}
    </Badge>
  );
}

export function TokenPill({ label, onHold }: { label: string; onHold?: boolean }) {
  return (
    <span
      className={
        'inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-md px-2 font-mono text-sm font-bold ' +
        (onHold ? 'bg-canvas text-ink-subtle ring-1 ring-border' : 'bg-primary-700 text-white')
      }
    >
      {label}
    </span>
  );
}

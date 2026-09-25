/** Appointment lifecycle (spec §7, §8). */
export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const VISIT_TYPES = ['NEW', 'FOLLOW_UP', 'REPORT_REVIEW'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/**
 * Allowed transitions. Anything not listed is rejected by the API with
 * INVALID_STATUS_TRANSITION.
 *
 *  BOOKED ─┬─> CONFIRMED ─┐
 *          └──────────────┴─> CHECKED_IN ─> WAITING ─> IN_CONSULTATION ─> COMPLETED
 *  (pre-consultation states) ─> CANCELLED / NO_SHOW
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['WAITING', 'IN_CONSULTATION', 'CANCELLED'],
  WAITING: ['IN_CONSULTATION', 'CANCELLED', 'NO_SHOW'],
  IN_CONSULTATION: ['COMPLETED', 'WAITING'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

/** Statuses that occupy the doctor's time (used for conflict detection). */
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'];

/** Statuses in the live queue. */
export const QUEUE_STATUSES: AppointmentStatus[] = ['CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'];

export const RESCHEDULABLE_STATUSES: AppointmentStatus[] = ['BOOKED', 'CONFIRMED'];

export function isTerminal(status: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[status].length === 0;
}

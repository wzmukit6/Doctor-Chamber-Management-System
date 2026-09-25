import { timeToMinutes, weekdayOf } from '@chamber/shared';

export interface ScheduleWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

/** True when [time, time+duration) fits inside one of the doctor's windows for that weekday. */
export function fitsSchedule(windows: ScheduleWindow[], date: string, time: string, durationMinutes: number): boolean {
  if (windows.length === 0) return true; // no schedule configured = no restriction
  const weekday = weekdayOf(date);
  const start = timeToMinutes(time);
  const end = start + durationMinutes;
  return windows.some((w) => w.weekday === weekday && start >= timeToMinutes(w.startTime) && end <= timeToMinutes(w.endTime));
}

/** Windows for a given date. */
export function windowsFor(windows: ScheduleWindow[], date: string): ScheduleWindow[] {
  const weekday = weekdayOf(date);
  return windows.filter((w) => w.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Postgres exclusion-constraint violations (double booking caught by the database). */
export function isOverlapViolation(err: unknown): 'doctor' | 'patient' | null {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? '')}` : String(err);
  if (text.includes('appointments_no_doctor_overlap')) return 'doctor';
  if (text.includes('appointments_no_patient_overlap')) return 'patient';
  return null;
}

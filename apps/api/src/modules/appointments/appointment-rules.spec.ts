import { APPOINTMENT_TRANSITIONS, canTransition, zonedDate, zonedDayRange, zonedTime, zonedToUtc } from '@chamber/shared';
import { fitsSchedule, isOverlapViolation, windowsFor } from './appointment-rules';

describe('appointment rules', () => {
  const windows = [
    { weekday: 6, startTime: '17:00', endTime: '21:00' }, // Saturday
    { weekday: 0, startTime: '09:00', endTime: '12:00' },
  ];

  it('checks that a booking fits the doctor schedule', () => {
    expect(fitsSchedule(windows, '2026-09-26', '17:00', 15)).toBe(true); // Saturday
    expect(fitsSchedule(windows, '2026-09-26', '20:50', 15)).toBe(false); // runs past 21:00
    expect(fitsSchedule(windows, '2026-09-25', '17:00', 15)).toBe(false); // Friday: no window
    expect(fitsSchedule([], '2026-09-25', '03:00', 15)).toBe(true); // no schedule = unrestricted
    expect(windowsFor(windows, '2026-09-27')).toEqual([windows[1]]);
  });

  it('detects exclusion-constraint violations', () => {
    expect(isOverlapViolation(new Error('violates exclusion constraint "appointments_no_doctor_overlap"'))).toBe('doctor');
    expect(isOverlapViolation(new Error('appointments_no_patient_overlap'))).toBe('patient');
    expect(isOverlapViolation(new Error('other'))).toBeNull();
  });
});

describe('appointment state machine (spec §7, §39-style explicit transitions)', () => {
  it('allows the normal visit flow', () => {
    expect(canTransition('BOOKED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'WAITING')).toBe(true);
    expect(canTransition('WAITING', 'IN_CONSULTATION')).toBe(true);
    expect(canTransition('IN_CONSULTATION', 'COMPLETED')).toBe(true);
  });

  it('rejects invalid transitions and keeps terminal states terminal', () => {
    expect(canTransition('BOOKED', 'COMPLETED')).toBe(false);
    expect(canTransition('IN_CONSULTATION', 'CANCELLED')).toBe(false);
    for (const terminal of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(APPOINTMENT_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('timezone helpers', () => {
  it('converts chamber wall-clock time to UTC and back (Asia/Dhaka is UTC+6)', () => {
    const utc = zonedToUtc('2026-09-26', '17:30', 'Asia/Dhaka');
    expect(utc.toISOString()).toBe('2026-09-26T11:30:00.000Z');
    expect(zonedTime(utc, 'Asia/Dhaka')).toBe('17:30');
    expect(zonedDate(new Date('2026-09-25T19:00:00Z'), 'Asia/Dhaka')).toBe('2026-09-26');
  });

  it('computes a local day range', () => {
    const { start, end } = zonedDayRange('2026-09-26', 'Asia/Dhaka');
    expect(start.toISOString()).toBe('2026-09-25T18:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-26T18:00:00.000Z');
  });

  it('handles DST zones', () => {
    // London is UTC+1 in summer, UTC+0 in winter.
    expect(zonedToUtc('2026-07-01', '10:00', 'Europe/London').toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '10:00', 'Europe/London').toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });
});

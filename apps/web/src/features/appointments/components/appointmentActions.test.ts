import type { AppointmentDto, Permission } from '@chamber/shared';
import { availableActions } from './appointmentActions';

const base = {
  id: 'a1',
  doctor: { id: 'doc-1', fullName: 'Dr. A', specialty: null },
  startsAt: new Date(Date.now() - 60_000).toISOString(),
} as unknown as AppointmentDto;

const all = (_: Permission) => true;
const ctx = (doctorId: string | null, can = all) => ({ can, doctorId, today: '2026-09-25', apptDay: '2026-09-25' });

describe('availableActions', () => {
  it('front desk can check in a booked appointment but never start a consultation', () => {
    const actions = availableActions({ ...base, status: 'BOOKED' }, ctx(null, (p) => p !== 'consultations.create'));
    expect(actions).toEqual(expect.arrayContaining(['confirm', 'check-in', 'cancel', 'no-show']));
    expect(actions).not.toContain('start');
  });

  it('only the appointment doctor can start; others cannot complete', () => {
    expect(availableActions({ ...base, status: 'WAITING' }, ctx('doc-1'))).toContain('start');
    expect(availableActions({ ...base, status: 'WAITING' }, ctx('doc-2'))).not.toContain('start');
    expect(availableActions({ ...base, status: 'IN_CONSULTATION' }, ctx('doc-2'))).toEqual([]);
    expect(availableActions({ ...base, status: 'IN_CONSULTATION' }, ctx('doc-1'))).toEqual(['complete', 'return-to-queue']);
  });

  it('offers nothing on terminal appointments and no check-in on other days', () => {
    expect(availableActions({ ...base, status: 'COMPLETED' }, ctx('doc-1'))).toEqual([]);
    expect(availableActions({ ...base, status: 'BOOKED' }, { ...ctx(null), apptDay: '2026-09-26' })).not.toContain('check-in');
  });
});

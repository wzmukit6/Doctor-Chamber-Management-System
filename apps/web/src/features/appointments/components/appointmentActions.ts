import { canTransition, PERMISSIONS, type AppointmentAction, type AppointmentDto, type AppointmentStatus, type Permission } from '@chamber/shared';

const TARGET: Record<AppointmentAction, { to: AppointmentStatus; permission: Permission; doctorOnly?: boolean; ownDoctor?: boolean; from?: AppointmentStatus[] }> = {
  confirm: { to: 'CONFIRMED', permission: PERMISSIONS.APPOINTMENTS_UPDATE },
  'check-in': { to: 'CHECKED_IN', permission: PERMISSIONS.QUEUE_MANAGE },
  'send-to-queue': { to: 'WAITING', permission: PERMISSIONS.QUEUE_MANAGE, from: ['CHECKED_IN'] },
  start: { to: 'IN_CONSULTATION', permission: PERMISSIONS.CONSULTATIONS_CREATE, doctorOnly: true },
  complete: { to: 'COMPLETED', permission: PERMISSIONS.QUEUE_MANAGE, ownDoctor: true },
  'return-to-queue': { to: 'WAITING', permission: PERMISSIONS.QUEUE_MANAGE, ownDoctor: true, from: ['IN_CONSULTATION'] },
  cancel: { to: 'CANCELLED', permission: PERMISSIONS.APPOINTMENTS_CANCEL },
  'no-show': { to: 'NO_SHOW', permission: PERMISSIONS.APPOINTMENTS_UPDATE },
};

/**
 * Actions the current user may take on an appointment. Mirrors the server rules
 * (permission + state machine + doctor ownership) to show only valid buttons;
 * the API re-checks everything.
 */
export function availableActions(
  appt: AppointmentDto,
  ctx: { can: (p: Permission) => boolean; doctorId: string | null; today: string; apptDay: string },
): AppointmentAction[] {
  return (Object.keys(TARGET) as AppointmentAction[]).filter((action) => {
    const def = TARGET[action];
    if (!ctx.can(def.permission) || !canTransition(appt.status, def.to)) return false;
    if (def.from && !def.from.includes(appt.status)) return false;
    if (def.doctorOnly && ctx.doctorId !== appt.doctor.id) return false;
    if (def.ownDoctor && ctx.doctorId && ctx.doctorId !== appt.doctor.id) return false;
    if (action === 'check-in' && ctx.apptDay !== ctx.today) return false;
    if (action === 'no-show' && new Date(appt.startsAt).getTime() > Date.now()) return false;
    return true;
  });
}

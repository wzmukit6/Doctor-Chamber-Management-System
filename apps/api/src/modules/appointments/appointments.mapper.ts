import { Prisma } from '@prisma/client';
import type { AppointmentDto, AppointmentHistoryDto } from '@chamber/shared';
import { ageFrom } from '../patients/patient.utils';

export const appointmentInclude = {
  patient: { select: { id: true, patientCode: true, fullName: true, gender: true, dateOfBirth: true, phone: true } },
  doctor: { select: { id: true, specialty: true, user: { select: { fullName: true } } } },
  token: true,
} satisfies Prisma.AppointmentInclude;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function toAppointmentDto(a: AppointmentRow): AppointmentDto {
  return {
    id: a.id,
    chamberId: a.chamberId,
    patient: {
      id: a.patient.id,
      patientCode: a.patient.patientCode,
      fullName: a.patient.fullName,
      gender: a.patient.gender,
      age: ageFrom(a.patient.dateOfBirth),
      phone: a.patient.phone,
    },
    doctor: { id: a.doctor.id, fullName: a.doctor.user.fullName, specialty: a.doctor.specialty },
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
    status: a.status,
    visitType: a.visitType,
    reason: a.reason,
    notes: a.notes,
    token: a.token
      ? {
          number: a.token.tokenNumber,
          label: a.token.label,
          onHold: a.token.onHold,
          calledAt: a.token.calledAt?.toISOString() ?? null,
          callCount: a.token.callCount,
        }
      : null,
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    startedAt: a.startedAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    cancelledReason: a.cancelledReason,
    createdByName: a.createdByName,
    createdAt: a.createdAt.toISOString(),
    version: a.version,
  };
}

export function toHistoryDto(h: Prisma.AppointmentStatusHistoryGetPayload<object>): AppointmentHistoryDto {
  return {
    id: h.id,
    action: h.action,
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    details: (h.details as Record<string, unknown> | null) ?? null,
    reason: h.reason,
    changedByName: h.changedByName,
    createdAt: h.createdAt.toISOString(),
  };
}

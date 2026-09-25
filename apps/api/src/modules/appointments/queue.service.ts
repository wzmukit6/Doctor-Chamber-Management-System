import { HttpStatus, Injectable } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { ERROR_CODES, QueueDto, QueueEntryDto, zonedDate, zonedDayRange } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';
import { AppointmentsService } from './appointments.service';
import { appointmentInclude, toAppointmentDto } from './appointments.mapper';

const ORDER: Record<string, number> = { IN_CONSULTATION: 0, WAITING: 1, CHECKED_IN: 2, CONFIRMED: 3, BOOKED: 3, COMPLETED: 4 };

/**
 * Live chamber queue (spec §8): Token | Patient | Appointment | Status | Doctor,
 * with check-in, call next, start consultation, hold, complete and cancel.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
  ) {}

  async queue(actor: Actor, date?: string, doctorId?: string): Promise<QueueDto> {
    const chamber = await this.appointments.chamber(actor);
    const day = date ?? zonedDate(new Date(), chamber.timezone);
    const { start, end } = zonedDayRange(day, chamber.timezone);
    const rows = await this.prisma.appointment.findMany({
      where: {
        chamberId: chamber.id,
        startsAt: { gte: start, lt: end },
        status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'] as AppointmentStatus[] },
        ...(doctorId ? { doctorId } : {}),
      },
      include: appointmentInclude,
    });
    const entries: QueueEntryDto[] = rows
      .map((r) => ({ ...toAppointmentDto(r), waitingSince: (r.queuedAt ?? r.checkedInAt)?.toISOString() ?? null }))
      .sort((a, b) => {
        const byStatus = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
        if (byStatus) return byStatus;
        if (a.token && b.token) return Number(a.token.onHold) - Number(b.token.onHold) || a.token.number - b.token.number;
        return a.startsAt.localeCompare(b.startsAt);
      });
    const count = (pred: (e: QueueEntryDto) => boolean) => entries.filter(pred).length;
    return {
      date: day,
      timezone: chamber.timezone,
      entries,
      summary: {
        waiting: count((e) => (e.status === 'WAITING' || e.status === 'CHECKED_IN') && !e.token?.onHold),
        onHold: count((e) => !!e.token?.onHold && (e.status === 'WAITING' || e.status === 'CHECKED_IN')),
        inConsultation: count((e) => e.status === 'IN_CONSULTATION'),
        completed: count((e) => e.status === 'COMPLETED'),
        checkedIn: count((e) => !!e.checkedInAt),
        booked: count((e) => e.status === 'BOOKED' || e.status === 'CONFIRMED'),
      },
    };
  }

  /** Calls the next waiting (not held) patient for a doctor, by token order. */
  async callNext(actor: Actor, doctorId: string): Promise<QueueEntryDto | null> {
    this.assertOwnDoctorOrStaff(actor, doctorId);
    const chamber = await this.appointments.chamber(actor);
    const { start, end } = zonedDayRange(zonedDate(new Date(), chamber.timezone), chamber.timezone);
    const next = await this.prisma.appointment.findFirst({
      where: {
        chamberId: chamber.id,
        doctorId,
        status: 'WAITING',
        startsAt: { gte: start, lt: end },
        token: { onHold: false },
      },
      orderBy: { token: { tokenNumber: 'asc' } },
      select: { id: true },
    });
    if (!next) return null;
    return this.call(actor, next.id);
  }

  async call(actor: Actor, appointmentId: string): Promise<QueueEntryDto> {
    const appt = await this.appointments.load(actor, appointmentId);
    this.assertOwnDoctorOrStaff(actor, appt.doctorId);
    if (!appt.token || (appt.status !== 'WAITING' && appt.status !== 'CHECKED_IN')) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only waiting patients can be called', HttpStatus.CONFLICT);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.queueToken.update({ where: { appointmentId }, data: { calledAt: new Date(), callCount: { increment: 1 }, onHold: false } });
      await this.audit.record(actor, { action: 'queue.called', resourceType: 'appointment', resourceId: appointmentId, newValue: { token: appt.token!.label } }, tx);
    });
    return this.entry(actor, appointmentId);
  }

  async setHold(actor: Actor, appointmentId: string, onHold: boolean): Promise<QueueEntryDto> {
    const appt = await this.appointments.load(actor, appointmentId);
    if (!appt.token || (appt.status !== 'WAITING' && appt.status !== 'CHECKED_IN')) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only waiting patients can be put on hold', HttpStatus.CONFLICT);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.queueToken.update({ where: { appointmentId }, data: { onHold } });
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          action: 'UPDATED',
          fromStatus: appt.status,
          toStatus: appt.status,
          details: { onHold },
          changedById: actor.userId,
          changedByName: actor.fullName,
        },
      });
      await this.audit.record(actor, { action: onHold ? 'queue.held' : 'queue.resumed', resourceType: 'appointment', resourceId: appointmentId }, tx);
    });
    return this.entry(actor, appointmentId);
  }

  private async entry(actor: Actor, id: string): Promise<QueueEntryDto> {
    const a = await this.appointments.load(actor, id);
    return { ...toAppointmentDto(a), waitingSince: (a.queuedAt ?? a.checkedInAt)?.toISOString() ?? null };
  }

  /** A doctor may only drive their own queue; front-desk staff may drive any doctor's queue. */
  private assertOwnDoctorOrStaff(actor: Actor, doctorId: string) {
    if (actor.doctorId && actor.doctorId !== doctorId) {
      throw new AppError(ERROR_CODES.NOT_APPOINTMENT_DOCTOR, "You can only call patients from your own queue", HttpStatus.FORBIDDEN);
    }
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AppointmentAction,
  AppointmentDto,
  AppointmentHistoryDto,
  AppointmentListQuery,
  AvailabilityDto,
  canTransition,
  CreateAppointmentInput,
  ERROR_CODES,
  minutesToTime,
  PERMISSIONS,
  RESCHEDULABLE_STATUSES,
  RescheduleAppointmentInput,
  timeToMinutes,
  UpdateAppointmentDetailsInput,
  zonedDate,
  zonedDayRange,
  zonedTime,
  zonedToUtc,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppointmentSettingsService } from '../settings/appointment-settings.service';
import { AppError } from '../../common/errors/app-error';
import { Actor } from '../../common/request-context';
import { appointmentInclude, AppointmentRow, toAppointmentDto, toHistoryDto } from './appointments.mapper';
import { fitsSchedule, isOverlapViolation, overlaps, windowsFor } from './appointment-rules';

type Tx = Prisma.TransactionClient;
type BookingIssue = 'doctor_busy' | 'outside_schedule' | 'daily_limit';

const ACTIVE: AppointmentStatus[] = ACTIVE_APPOINTMENT_STATUSES as AppointmentStatus[];

/** What each action does: allowed source statuses → target, and required permission. */
const ACTIONS: Record<AppointmentAction, { to: AppointmentStatus; permission: string; reasonRequired?: boolean; from?: AppointmentStatus[] }> = {
  confirm: { to: 'CONFIRMED', permission: PERMISSIONS.APPOINTMENTS_UPDATE },
  'check-in': { to: 'CHECKED_IN', permission: PERMISSIONS.QUEUE_MANAGE },
  'send-to-queue': { to: 'WAITING', permission: PERMISSIONS.QUEUE_MANAGE, from: ['CHECKED_IN'] },
  start: { to: 'IN_CONSULTATION', permission: PERMISSIONS.CONSULTATIONS_CREATE },
  complete: { to: 'COMPLETED', permission: PERMISSIONS.QUEUE_MANAGE },
  'return-to-queue': { to: 'WAITING', permission: PERMISSIONS.QUEUE_MANAGE, from: ['IN_CONSULTATION'] },
  cancel: { to: 'CANCELLED', permission: PERMISSIONS.APPOINTMENTS_CANCEL, reasonRequired: true },
  'no-show': { to: 'NO_SHOW', permission: PERMISSIONS.APPOINTMENTS_UPDATE },
};

interface ChamberContext {
  id: string;
  organizationId: string;
  timezone: string;
}

/**
 * Appointments (spec §7): booking with conflict detection, rescheduling,
 * cancellation, no-shows and an explicit status machine. Double booking is
 * checked here for friendly errors and enforced again by database exclusion
 * constraints, so concurrent requests cannot both succeed.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly settings: AppointmentSettingsService,
  ) {}

  // ─────────────────────────── Queries ───────────────────────────

  async list(actor: Actor, q: AppointmentListQuery): Promise<AppointmentDto[]> {
    const chamber = await this.chamber(actor);
    const from = zonedDayRange(q.from, chamber.timezone).start;
    const to = zonedDayRange(q.to, chamber.timezone).end;
    // Calendar views need at most ~6 weeks; one patient's history may span years.
    const maxDays = q.patientId ? 5 * 366 : 62;
    if (to.getTime() - from.getTime() > maxDays * 86_400_000) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Date range too large (max ${maxDays} days)`, 422, [{ path: 'to', message: 'validation.range_too_large' }]);
    }
    const rows = await this.prisma.appointment.findMany({
      where: {
        chamberId: chamber.id,
        startsAt: { gte: from, lt: to },
        ...(q.doctorId ? { doctorId: q.doctorId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.status.length ? { status: { in: q.status } } : {}),
      },
      include: appointmentInclude,
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
    });
    return rows.map(toAppointmentDto);
  }

  async get(actor: Actor, id: string): Promise<AppointmentDto & { history: AppointmentHistoryDto[] }> {
    const appt = await this.load(actor, id);
    const history = await this.prisma.appointmentStatusHistory.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'asc' } });
    return { ...toAppointmentDto(appt), history: history.map(toHistoryDto) };
  }

  /** Slots for a doctor on a date, marking booked and past ones (spec §7 "configurable appointment duration"). */
  async availability(actor: Actor, doctorId: string, date: string, excludeAppointmentId?: string): Promise<AvailabilityDto> {
    const chamber = await this.chamber(actor);
    const doctor = await this.doctor(actor, doctorId);
    const settings = await this.settings.get(chamber.id);
    const slotMinutes = doctor.slotMinutes ?? settings.defaultSlotMinutes;
    const windows = windowsFor(doctor.schedule, date);
    const { start, end } = zonedDayRange(date, chamber.timezone);
    const booked = await this.prisma.appointment.findMany({
      where: { doctorId, startsAt: { gte: start, lt: end }, status: { in: ACTIVE }, ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}) },
      select: { startsAt: true, endsAt: true, isOverbooked: true },
    });
    const now = new Date();
    const slots = windows.flatMap((w) => {
      const out = [];
      for (let m = timeToMinutes(w.startTime); m + slotMinutes <= timeToMinutes(w.endTime); m += slotMinutes) {
        const time = minutesToTime(m);
        const s = zonedToUtc(date, time, chamber.timezone);
        const e = new Date(s.getTime() + slotMinutes * 60_000);
        const taken = booked.some((b) => !b.isOverbooked && overlaps(s, e, b.startsAt, b.endsAt));
        out.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), time, available: !taken && e > now, past: e <= now });
      }
      return out;
    });
    return {
      date,
      timezone: chamber.timezone,
      slotMinutes,
      windows: windows.map((w) => ({ startTime: w.startTime, endTime: w.endTime })),
      slots,
      bookedCount: booked.length,
      maxDailyPatients: doctor.maxDailyPatients ?? settings.maxDailyPatients,
    };
  }

  // ─────────────────────────── Commands ───────────────────────────

  async create(actor: Actor, input: CreateAppointmentInput): Promise<AppointmentDto> {
    const chamber = await this.chamber(actor);
    const patient = await this.prisma.patient.findFirst({ where: { id: input.patientId, chamberId: chamber.id, deletedAt: null } });
    if (!patient) throw AppError.notFound('Patient');
    const doctor = await this.doctor(actor, input.doctorId);
    const settings = await this.settings.get(chamber.id);
    const duration = input.durationMinutes ?? doctor.slotMinutes ?? settings.defaultSlotMinutes;

    // Walk-ins are booked "now" and join the queue immediately.
    const now = new Date();
    const date = input.checkInNow ? zonedDate(now, chamber.timezone) : input.date;
    const time = input.checkInNow ? zonedTime(now, chamber.timezone) : input.time;
    const startsAt = zonedToUtc(date, time, chamber.timezone);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (!input.checkInNow && endsAt.getTime() < now.getTime()) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Appointments cannot be booked in the past', 422, [{ path: 'time', message: 'validation.in_past' }]);
    }

    const overbook = await this.checkBooking({
      chamber,
      doctor,
      patientId: patient.id,
      date,
      time,
      startsAt,
      endsAt,
      duration,
      maxDaily: doctor.maxDailyPatients ?? settings.maxDailyPatients,
      allowOverbook: input.allowOverbook || input.checkInNow,
    });

    const id = await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.create({
          data: {
            organizationId: chamber.organizationId,
            chamberId: chamber.id,
            patientId: patient.id,
            doctorId: doctor.id,
            startsAt,
            endsAt,
            visitType: input.visitType,
            reason: input.reason,
            notes: input.notes,
            isWalkIn: input.checkInNow,
            isOverbooked: overbook,
            createdById: actor.userId,
            createdByName: actor.fullName,
          },
        });
        await this.history(tx, actor, appt.id, 'CREATED', null, 'BOOKED', {
          startsAt: startsAt.toISOString(),
          doctor: doctor.user.fullName,
          ...(overbook ? { overbooked: true } : {}),
          ...(input.checkInNow ? { walkIn: true } : {}),
        });
        await this.audit.record(
          actor,
          {
            action: 'appointment.created',
            resourceType: 'appointment',
            resourceId: appt.id,
            newValue: { patientId: patient.id, doctorId: doctor.id, startsAt: startsAt.toISOString(), durationMinutes: duration, visitType: input.visitType, overbooked: overbook, walkIn: input.checkInNow },
          },
          tx,
        );
        return appt.id;
      }),
    );
    if (input.checkInNow) return this.act(actor, id, 'check-in', {});
    return toAppointmentDto(await this.load(actor, id));
  }

  async reschedule(actor: Actor, id: string, input: RescheduleAppointmentInput): Promise<AppointmentDto> {
    const chamber = await this.chamber(actor);
    const appt = await this.load(actor, id);
    if (!(RESCHEDULABLE_STATUSES as string[]).includes(appt.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, `A ${appt.status.toLowerCase().replace('_', ' ')} appointment cannot be rescheduled`, HttpStatus.CONFLICT);
    }
    const doctor = await this.doctor(actor, input.doctorId ?? appt.doctorId);
    const settings = await this.settings.get(chamber.id);
    const duration = input.durationMinutes ?? Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000);
    const startsAt = zonedToUtc(input.date, input.time, chamber.timezone);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (endsAt.getTime() < Date.now()) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Appointments cannot be moved into the past', 422, [{ path: 'time', message: 'validation.in_past' }]);
    }
    const overbook = await this.checkBooking({
      chamber,
      doctor,
      patientId: appt.patientId,
      date: input.date,
      time: input.time,
      startsAt,
      endsAt,
      duration,
      maxDaily: doctor.maxDailyPatients ?? settings.maxDailyPatients,
      allowOverbook: input.allowOverbook,
      excludeId: id,
    });

    await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const res = await tx.appointment.updateMany({
          where: { id, version: input.version, status: { in: RESCHEDULABLE_STATUSES as AppointmentStatus[] } },
          data: { startsAt, endsAt, doctorId: doctor.id, isOverbooked: overbook, version: { increment: 1 } },
        });
        if (res.count !== 1) throw AppError.staleVersion();
        const details = {
          from: appt.startsAt.toISOString(),
          to: startsAt.toISOString(),
          ...(doctor.id !== appt.doctorId ? { fromDoctor: appt.doctor.user.fullName, toDoctor: doctor.user.fullName } : {}),
        };
        await this.history(tx, actor, id, 'RESCHEDULED', appt.status, appt.status, details, input.reason);
        await this.audit.record(
          actor,
          {
            action: 'appointment.rescheduled',
            resourceType: 'appointment',
            resourceId: id,
            oldValue: { startsAt: appt.startsAt.toISOString(), doctorId: appt.doctorId },
            newValue: { startsAt: startsAt.toISOString(), doctorId: doctor.id, overbooked: overbook },
            reason: input.reason,
          },
          tx,
        );
      }),
    );
    return toAppointmentDto(await this.load(actor, id));
  }

  async updateDetails(actor: Actor, id: string, input: UpdateAppointmentDetailsInput): Promise<AppointmentDto> {
    const appt = await this.load(actor, id);
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appt.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Closed appointments cannot be edited', HttpStatus.CONFLICT);
    }
    const { version, ...changes } = input;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({ where: { id, version }, data: { ...changes, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.staleVersion();
      const old = { visitType: appt.visitType, reason: appt.reason, notes: appt.notes };
      await this.history(tx, actor, id, 'UPDATED', appt.status, appt.status, { changed: Object.keys(changes) });
      await this.audit.record(actor, { action: 'appointment.updated', resourceType: 'appointment', resourceId: id, oldValue: old, newValue: changes }, tx);
    });
    return toAppointmentDto(await this.load(actor, id));
  }

  /** Applies a status action with permission, ownership and state-machine checks (spec §7, §8). */
  async act(actor: Actor, id: string, action: AppointmentAction, input: { reason?: string | null; version?: number }): Promise<AppointmentDto> {
    const def = ACTIONS[action];
    this.authz.assertPermission(actor, def.permission as never);
    if (def.reasonRequired && !input.reason) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A reason is required', 422, [{ path: 'reason', message: 'validation.required' }]);
    }
    const chamber = await this.chamber(actor);
    const appt = await this.load(actor, id);
    if (input.version !== undefined && input.version !== appt.version) throw AppError.staleVersion();

    // Only the appointment's own doctor may run the consultation (spec §48: Doctor A → Doctor B's patient).
    if (action === 'start' || ((action === 'complete' || action === 'return-to-queue') && actor.doctorId)) {
      if (!actor.doctorId || actor.doctorId !== appt.doctorId) {
        throw new AppError(ERROR_CODES.NOT_APPOINTMENT_DOCTOR, "Only the appointment's doctor can do this", HttpStatus.FORBIDDEN);
      }
    }
    // Actions sharing a target status are distinguished by their allowed source status.
    if (!canTransition(appt.status, def.to) || (def.from && !def.from.includes(appt.status))) {
      throw new AppError(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot ${action.replace(/-/g, ' ')} an appointment that is ${appt.status.toLowerCase().replace('_', ' ')}`,
        HttpStatus.CONFLICT,
        undefined,
        { from: appt.status, to: def.to },
      );
    }
    const today = zonedDate(new Date(), chamber.timezone);
    const apptDay = zonedDate(appt.startsAt, chamber.timezone);
    if (action === 'check-in' && apptDay !== today) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Patients can only be checked in on the day of the appointment', HttpStatus.CONFLICT);
    }
    if (action === 'no-show' && appt.startsAt.getTime() > Date.now()) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'An appointment cannot be marked as no-show before its start time', HttpStatus.CONFLICT);
    }
    if (action === 'start') {
      const busy = await this.prisma.appointment.findFirst({ where: { doctorId: appt.doctorId, status: 'IN_CONSULTATION', id: { not: id } }, select: { id: true } });
      if (busy) {
        throw new AppError(ERROR_CODES.APPOINTMENT_CONFLICT, 'Finish or return the current patient before starting another consultation', HttpStatus.CONFLICT, undefined, {
          inConsultation: busy.id,
        });
      }
    }

    const settings = action === 'check-in' ? await this.settings.get(chamber.id) : null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.AppointmentUpdateManyMutationInput = { status: def.to, version: { increment: 1 } };
      if (def.to === 'CHECKED_IN') data.checkedInAt = now;
      if (def.to === 'WAITING') data.queuedAt = now;
      if (def.to === 'IN_CONSULTATION') data.startedAt = now;
      if (def.to === 'COMPLETED') data.completedAt = now;
      if (def.to === 'CANCELLED') Object.assign(data, { cancelledAt: now, cancelledById: actor.userId, cancelledReason: input.reason });
      // Conditional on the current status: concurrent actions cannot both apply.
      const res = await tx.appointment.updateMany({ where: { id, status: appt.status }, data });
      if (res.count !== 1) throw AppError.staleVersion();
      await this.history(tx, actor, id, 'STATUS_CHANGED', appt.status, def.to, null, input.reason);

      let finalStatus: AppointmentStatus = def.to;
      if (action === 'check-in') {
        const token = await this.issueToken(tx, chamber, appt, settings!.tokenScope, settings!.tokenPrefix, today);
        await this.history(tx, actor, id, 'UPDATED', def.to, def.to, { token: token.label });
        if (settings!.autoQueueOnCheckIn) {
          await tx.appointment.update({ where: { id }, data: { status: 'WAITING', queuedAt: now, version: { increment: 1 } } });
          await this.history(tx, actor, id, 'STATUS_CHANGED', 'CHECKED_IN', 'WAITING', { automatic: true });
          finalStatus = 'WAITING';
        }
      }
      if (def.to === 'IN_CONSULTATION' || def.to === 'COMPLETED') {
        await tx.queueToken.updateMany({ where: { appointmentId: id }, data: { onHold: false } });
      }
      await this.audit.record(
        actor,
        {
          action: `appointment.${action.replace(/-/g, '_')}`,
          resourceType: 'appointment',
          resourceId: id,
          oldValue: { status: appt.status },
          newValue: { status: finalStatus },
          reason: input.reason ?? null,
        },
        tx,
      );
    });
    return toAppointmentDto(await this.load(actor, id));
  }

  // ─────────────────────────── Helpers ───────────────────────────

  async load(actor: Actor, id: string): Promise<AppointmentRow> {
    const appt = await this.prisma.appointment.findFirst({ where: { id, ...this.authz.chamberScope(actor) }, include: appointmentInclude });
    if (!appt) throw AppError.notFound('Appointment');
    return appt;
  }

  async chamber(actor: Actor): Promise<ChamberContext> {
    if (!actor.chamberId) throw AppError.forbidden('Appointments are managed inside a chamber. Sign in with a chamber membership.');
    return this.prisma.chamber.findUniqueOrThrow({ where: { id: actor.chamberId }, select: { id: true, organizationId: true, timezone: true } });
  }

  private async doctor(actor: Actor, doctorId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, ...this.authz.chamberScope(actor), isActive: true, user: { isActive: true, deletedAt: null } },
      include: { schedule: true, user: { select: { fullName: true } } },
    });
    if (!doctor) throw AppError.notFound('Doctor');
    return doctor;
  }

  /**
   * Validates a booking. Patient overlaps always block. Doctor overlaps, bookings
   * outside the schedule and exceeding the daily limit block unless the user
   * explicitly confirms (allowOverbook). Returns whether the booking is an overbook.
   */
  private async checkBooking(p: {
    chamber: ChamberContext;
    doctor: { id: string; schedule: { weekday: number; startTime: string; endTime: string }[] };
    patientId: string;
    date: string;
    time: string;
    startsAt: Date;
    endsAt: Date;
    duration: number;
    maxDaily: number | null;
    allowOverbook: boolean;
    excludeId?: string;
  }): Promise<boolean> {
    const exclude = p.excludeId ? { id: { not: p.excludeId } } : {};
    const patientClash = await this.prisma.appointment.findFirst({
      where: { patientId: p.patientId, status: { in: ACTIVE }, startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt }, ...exclude },
      include: appointmentInclude,
    });
    if (patientClash) {
      throw new AppError(ERROR_CODES.APPOINTMENT_CONFLICT, 'This patient already has an appointment at that time', HttpStatus.CONFLICT, undefined, {
        issues: ['patient_busy'],
        overridable: false,
        conflicting: toAppointmentDto(patientClash),
      });
    }

    const issues: BookingIssue[] = [];
    const doctorClash = await this.prisma.appointment.findFirst({
      where: { doctorId: p.doctor.id, status: { in: ACTIVE }, isOverbooked: false, startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt }, ...exclude },
      include: appointmentInclude,
    });
    if (doctorClash) issues.push('doctor_busy');
    if (!fitsSchedule(p.doctor.schedule, p.date, p.time, p.duration)) issues.push('outside_schedule');
    if (p.maxDaily) {
      const { start, end } = zonedDayRange(p.date, p.chamber.timezone);
      const count = await this.prisma.appointment.count({ where: { doctorId: p.doctor.id, status: { in: ACTIVE }, startsAt: { gte: start, lt: end }, ...exclude } });
      if (count >= p.maxDaily) issues.push('daily_limit');
    }
    if (issues.length && !p.allowOverbook) {
      const code = issues[0] === 'doctor_busy' ? ERROR_CODES.APPOINTMENT_CONFLICT : issues[0] === 'outside_schedule' ? ERROR_CODES.OUTSIDE_SCHEDULE : ERROR_CODES.DAILY_LIMIT_REACHED;
      const messages: Record<BookingIssue, string> = {
        doctor_busy: 'The doctor already has an appointment at that time',
        outside_schedule: "The time is outside the doctor's schedule",
        daily_limit: 'The doctor has reached the daily patient limit',
      };
      throw new AppError(code, messages[issues[0]!], HttpStatus.CONFLICT, undefined, {
        issues,
        overridable: true,
        conflicting: doctorClash ? toAppointmentDto(doctorClash) : null,
      });
    }
    // Only a doctor time clash needs to bypass the exclusion constraint.
    return issues.includes('doctor_busy');
  }

  /** Maps database exclusion-constraint violations (concurrent bookings) to APPOINTMENT_CONFLICT. */
  private async withOverlapGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const which = isOverlapViolation(err);
      if (!which) throw err;
      throw new AppError(
        ERROR_CODES.APPOINTMENT_CONFLICT,
        which === 'doctor' ? 'The doctor was just booked at that time' : 'This patient already has an appointment at that time',
        HttpStatus.CONFLICT,
        undefined,
        { issues: [which === 'doctor' ? 'doctor_busy' : 'patient_busy'], overridable: which === 'doctor' },
      );
    }
  }

  private async issueToken(tx: Tx, chamber: ChamberContext, appt: AppointmentRow, scope: 'DOCTOR' | 'CHAMBER', prefix: string, today: string) {
    const scopeKey = scope === 'CHAMBER' ? 'ALL' : appt.doctorId;
    const queueDate = new Date(`${today}T00:00:00Z`);
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO queue_token_sequences (chamber_id, scope_key, queue_date, last_value)
      VALUES (${chamber.id}::uuid, ${scopeKey}, ${queueDate}::date, 1)
      ON CONFLICT (chamber_id, scope_key, queue_date)
      DO UPDATE SET last_value = queue_token_sequences.last_value + 1
      RETURNING last_value`;
    const tokenNumber = rows[0]!.last_value;
    return tx.queueToken.create({
      data: {
        chamberId: chamber.id,
        doctorId: appt.doctorId,
        appointmentId: appt.id,
        queueDate,
        scopeKey,
        tokenNumber,
        label: `${prefix}${tokenNumber}`,
      },
    });
  }

  private history(
    tx: Tx,
    actor: Actor,
    appointmentId: string,
    action: 'CREATED' | 'STATUS_CHANGED' | 'RESCHEDULED' | 'UPDATED',
    fromStatus: AppointmentStatus | null,
    toStatus: AppointmentStatus | null,
    details: Record<string, unknown> | null,
    reason?: string | null,
  ) {
    return tx.appointmentStatusHistory.create({
      data: {
        appointmentId,
        action,
        fromStatus,
        toStatus,
        details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: reason ?? null,
        changedById: actor.userId,
        changedByName: actor.fullName,
      },
    });
  }
}

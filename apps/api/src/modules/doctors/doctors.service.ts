import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DoctorDto, DoctorFeesInput, DoctorScheduleInput } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';

const include = {
  user: { select: { fullName: true, isActive: true, deletedAt: true } },
  schedule: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.DoctorInclude;
type DoctorRow = Prisma.DoctorGetPayload<{ include: typeof include }>;

function toDto(d: DoctorRow): DoctorDto {
  return {
    id: d.id,
    userId: d.userId,
    fullName: d.user.fullName,
    specialty: d.specialty,
    qualifications: d.qualifications,
    consultationFee: d.consultationFee !== null ? Number(d.consultationFee) : null,
    followUpFee: d.followUpFee !== null ? Number(d.followUpFee) : null,
    reportReviewFee: d.reportReviewFee !== null ? Number(d.reportReviewFee) : null,
    isActive: d.isActive && d.user.isActive && !d.user.deletedAt,
    schedule: d.schedule.map((w) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })),
    slotMinutes: d.slotMinutes,
    maxDailyPatients: d.maxDailyPatients,
    version: d.version,
  };
}

/** Doctors of a chamber and their weekly availability (spec §7, §14 "Manage doctor availability"). */
@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, includeInactive = false): Promise<DoctorDto[]> {
    const rows = await this.prisma.doctor.findMany({
      where: {
        ...this.authz.chamberScope(actor),
        ...(includeInactive ? {} : { isActive: true }),
        user: {
          ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
          // A doctor profile only counts while the DOCTOR membership in a chamber is active.
          memberships: { some: { isActive: true, role: { key: 'DOCTOR' } } },
        },
      },
      include,
      orderBy: { user: { fullName: 'asc' } },
    });
    return rows.map(toDto);
  }

  async get(actor: Actor, id: string): Promise<DoctorDto> {
    return toDto(await this.load(actor, id));
  }

  /** Loads a doctor inside the actor's chamber (other chambers → not found). */
  async load(actor: Actor, id: string): Promise<DoctorRow> {
    const doctor = await this.prisma.doctor.findFirst({ where: { id, ...this.authz.chamberScope(actor) }, include });
    if (!doctor) throw AppError.notFound('Doctor');
    return doctor;
  }

  async updateSchedule(actor: Actor, id: string, input: DoctorScheduleInput): Promise<DoctorDto> {
    const before = await this.load(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.doctorScheduleWindow.deleteMany({ where: { doctorId: id } });
      await tx.doctorScheduleWindow.createMany({ data: input.windows.map((w) => ({ doctorId: id, ...w })) });
      await tx.doctor.update({
        where: { id },
        data: { slotMinutes: input.slotMinutes ?? null, maxDailyPatients: input.maxDailyPatients ?? null, version: { increment: 1 } },
      });
      await this.audit.record(
        actor,
        {
          action: 'doctor.schedule_updated',
          resourceType: 'doctor',
          resourceId: id,
          oldValue: { windows: toDto(before).schedule, slotMinutes: before.slotMinutes, maxDailyPatients: before.maxDailyPatients },
          newValue: input,
          chamberId: before.chamberId,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** Consultation / follow-up / report-review fees (spec §20 "MANAGER modified consultation fee" — audited). */
  async updateFees(actor: Actor, id: string, input: DoctorFeesInput): Promise<DoctorDto> {
    const before = await this.load(actor, id);
    if (before.version !== input.version) throw AppError.staleVersion();
    const fees = { consultationFee: input.consultationFee ?? null, followUpFee: input.followUpFee ?? null, reportReviewFee: input.reportReviewFee ?? null };
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.doctor.updateMany({ where: { id, version: input.version }, data: { ...fees, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.staleVersion();
      const old = toDto(before);
      await this.audit.record(
        actor,
        {
          action: 'doctor.fees_updated',
          resourceType: 'doctor',
          resourceId: id,
          oldValue: { consultationFee: old.consultationFee, followUpFee: old.followUpFee, reportReviewFee: old.reportReviewFee },
          newValue: fees,
          chamberId: before.chamberId,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }
}

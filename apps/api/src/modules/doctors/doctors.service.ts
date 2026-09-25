import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DoctorDto, DoctorFeesInput, DoctorProfileDto, DoctorScheduleInput, DoctorSelfProfileInput, PERMISSIONS } from '@chamber/shared';
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
    registrationNo: d.registrationNo,
    hasSignature: !!d.signatureDataUrl,
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

  /** Doctor settings (spec §34): the doctor edits their own profile; managers (users.update) any doctor in the chamber. */
  private canEditProfile(actor: Actor, doctorId: string) {
    return actor.doctorId === doctorId || actor.permissions.has(PERMISSIONS.USERS_UPDATE);
  }

  async getProfile(actor: Actor, id: string): Promise<DoctorProfileDto> {
    const d = await this.load(actor, id);
    return {
      id: d.id,
      fullName: d.user.fullName,
      qualifications: d.qualifications,
      specialty: d.specialty,
      registrationNo: d.registrationNo,
      bio: d.bio,
      signatureDataUrl: d.signatureDataUrl,
      prescriptionFooter: d.prescriptionFooter,
      version: d.version,
      canEdit: this.canEditProfile(actor, d.id),
    };
  }

  async updateProfile(actor: Actor, id: string, input: DoctorSelfProfileInput): Promise<DoctorProfileDto> {
    const before = await this.load(actor, id);
    if (!this.canEditProfile(actor, id)) throw AppError.forbidden('You can only edit your own doctor profile');
    if (before.version !== input.version) throw AppError.staleVersion();
    const data = {
      qualifications: input.qualifications,
      specialty: input.specialty,
      registrationNo: input.registrationNo,
      bio: input.bio,
      signatureDataUrl: input.signatureDataUrl ?? null,
      prescriptionFooter: input.prescriptionFooter,
    };
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.doctor.updateMany({ where: { id, version: input.version }, data: { ...data, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.staleVersion();
      const view = (v: { signatureDataUrl: string | null } & Record<string, unknown>) => ({ ...v, signatureDataUrl: v.signatureDataUrl ? 'image' : null });
      await this.audit.record(
        actor,
        {
          action: 'doctor.profile_updated',
          resourceType: 'doctor',
          resourceId: id,
          oldValue: view({ qualifications: before.qualifications, specialty: before.specialty, registrationNo: before.registrationNo, bio: before.bio, signatureDataUrl: before.signatureDataUrl, prescriptionFooter: before.prescriptionFooter }),
          newValue: view(data),
          chamberId: before.chamberId,
        },
        tx,
      );
    });
    return this.getProfile(actor, id);
  }
}

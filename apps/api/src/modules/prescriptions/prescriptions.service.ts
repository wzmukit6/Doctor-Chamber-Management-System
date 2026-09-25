import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  PERMISSIONS,
  PrescriptionDto,
  PrescriptionListQuery,
  PrescriptionPrintDto,
  PrescriptionSummaryDto,
  PrescriptionVerificationDto,
  PrescriptionVersionDto,
  SavePrescriptionDraftInput,
  zonedDayRange,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrescriptionSettingsService } from '../settings/prescription-settings.service';
import { AppError } from '../../common/errors/app-error';
import { Actor } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageMeta } from '../../common/utils/pagination';
import { ageFrom, formatDateOnly } from '../patients/patient.utils';
import { finalizeVersion, itemRows, writeDraftContent } from './prescription-writer';
import { prescriptionInclude, PrescriptionRow, prescriptionSummaryInclude, toPrescriptionDto, toPrescriptionSummary, toVersionDto, versionInclude } from './prescriptions.mapper';

const ISSUED: Prisma.EnumPrescriptionStatusFilter = { in: ['FINALIZED', 'REVISED'] };

/**
 * Prescription lifecycle after the consultation (spec §12, §39): finalized
 * versions are immutable; changes create a revision (draft version N+1) that
 * supersedes the previous version when finalized. Version 1 itself is written
 * and finalized by the consultation workflow.
 */
@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly settings: PrescriptionSettingsService,
  ) {}

  /** Assistants and managers see issued prescriptions only; prescribers also see drafts. */
  private seesDrafts(actor: Actor) {
    return actor.permissions.has(PERMISSIONS.PRESCRIPTIONS_CREATE);
  }

  // ─────────────────────────── Queries ───────────────────────────

  async list(actor: Actor, q: PrescriptionListQuery): Promise<PageResult<PrescriptionSummaryDto>> {
    const scope = this.authz.chamberScope(actor);
    const tz = actor.chamberId ? (await this.prisma.chamber.findUnique({ where: { id: actor.chamberId }, select: { timezone: true } }))?.timezone : undefined;
    const timezone = tz ?? 'Asia/Dhaka';
    const term = q.q?.trim();
    const status: Prisma.PrescriptionWhereInput['status'] = this.seesDrafts(actor)
      ? (q.status ?? { not: 'CANCELLED' })
      : q.status
        ? q.status === 'FINALIZED' || q.status === 'REVISED'
          ? q.status
          : { in: [] }
        : ISSUED;
    const where: Prisma.PrescriptionWhereInput = {
      ...scope,
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      status,
      ...(term
        ? {
            OR: [
              { rxNumber: { contains: term, mode: 'insensitive' } },
              { patient: { fullName: { contains: term, mode: 'insensitive' } } },
              { patient: { patientCode: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: zonedDayRange(q.from, timezone).start } : {}),
              ...(q.to ? { lt: zonedDayRange(q.to, timezone).end } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.prescription.count({ where }),
      this.prisma.prescription.findMany({
        where,
        include: prescriptionSummaryInclude,
        orderBy: [{ createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return new PageResult(rows.map(toPrescriptionSummary), pageMeta(q, total));
  }

  async get(actor: Actor, id: string): Promise<PrescriptionDto> {
    return this.dto(actor, await this.load(actor, id));
  }

  /** The patient's most recent issued prescription (current version) — for "copy previous". */
  async latestForPatient(actor: Actor, patientId: string, excludeConsultationId?: string): Promise<(PrescriptionVersionDto & { rxNumber: string | null; issuedAt: string | null }) | null> {
    const rx = await this.prisma.prescription.findFirst({
      where: { ...this.authz.chamberScope(actor), patientId, status: ISSUED, ...(excludeConsultationId ? { consultationId: { not: excludeConsultationId } } : {}) },
      orderBy: { issuedAt: 'desc' },
      include: { versions: { where: { status: 'FINALIZED' }, include: versionInclude } },
    });
    const v = rx?.versions[0];
    if (!rx || !v) return null;
    return { ...toVersionDto(v, { showToken: false }), rxNumber: rx.rxNumber, issuedAt: rx.issuedAt?.toISOString() ?? null };
  }

  // ─────────────────────────── Revisions ───────────────────────────

  /** FINALIZED → create revision (draft version N+1 copied from the current version). */
  async startRevision(actor: Actor, id: string, reason: string, version: number): Promise<PrescriptionDto> {
    this.authz.assertPermission(actor, PERMISSIONS.PRESCRIPTIONS_REVISE);
    const rx = await this.loadOwn(actor, id);
    if (rx.version !== version) throw AppError.staleVersion();
    if (rx.status === 'DRAFT' || rx.status === 'CANCELLED') {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only issued prescriptions can be revised', HttpStatus.CONFLICT);
    }
    if (rx.versions.some((v) => v.status === 'DRAFT')) {
      throw new AppError(ERROR_CODES.REVISION_IN_PROGRESS, 'A revision of this prescription is already in progress', HttpStatus.CONFLICT);
    }
    const current = rx.versions.find((v) => v.status === 'FINALIZED')!;
    const nextNumber = Math.max(...rx.versions.map((v) => v.versionNumber)) + 1;
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.prescription.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
      if (bumped.count !== 1) throw AppError.staleVersion();
      const draft = await tx.prescriptionVersion.create({
        data: {
          prescriptionId: id,
          versionNumber: nextNumber,
          advice: current.advice,
          revisionReason: reason,
          createdById: actor.userId,
          createdByName: actor.fullName,
        },
      });
      if (current.items.length) await tx.prescriptionItem.createMany({ data: itemRows(current.items.map((i) => ({ ...i }))).map((r) => ({ ...r, versionId: draft.id })) });
      await this.audit.record(
        actor,
        { action: 'prescription.revision_started', resourceType: 'prescription', resourceId: id, reason, newValue: { rxNumber: rx.rxNumber, fromVersion: current.versionNumber, versionNumber: nextNumber } },
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** Saves the open revision draft (version 1 drafts are saved with the consultation). */
  async saveDraft(actor: Actor, id: string, input: SavePrescriptionDraftInput): Promise<PrescriptionDto> {
    this.authz.assertPermission(actor, PERMISSIONS.PRESCRIPTIONS_UPDATE);
    const rx = await this.loadOwn(actor, id);
    const draft = this.revisionDraft(rx);
    if (rx.version !== input.version) throw AppError.staleVersion();
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.prescription.updateMany({ where: { id, version: input.version }, data: { version: { increment: 1 } } });
      if (bumped.count !== 1) throw AppError.staleVersion();
      await writeDraftContent(tx, actor, draft.id, rx.chamberId, { items: input.items, advice: input.advice });
    });
    return this.get(actor, id);
  }

  /** Finalizes the revision: previous version → SUPERSEDED, draft → FINALIZED, prescription → REVISED. */
  async finalizeRevision(actor: Actor, id: string, version: number): Promise<PrescriptionDto> {
    this.authz.assertPermission(actor, PERMISSIONS.PRESCRIPTIONS_FINALIZE);
    const rx = await this.loadOwn(actor, id);
    const draft = this.revisionDraft(rx);
    if (rx.version !== version) throw AppError.staleVersion();
    const previous = rx.versions.find((v) => v.status === 'FINALIZED')!;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.prescription.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
      if (bumped.count !== 1) throw AppError.staleVersion();
      // Supersede first: at most one FINALIZED version may exist (partial unique index).
      await tx.prescriptionVersion.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED', supersededAt: now } });
      const { finalized, version: finalVersion } = await finalizeVersion(tx, actor, { id, rxNumber: rx.rxNumber!, patientId: rx.patientId, doctorId: rx.doctorId }, draft.id, now);
      if (!finalized) throw AppError.staleVersion();
      await tx.prescription.update({ where: { id }, data: { status: 'REVISED', currentVersion: draft.versionNumber } });
      const summary = (items: { name: string; strength: string | null; frequency: string | null; durationValue: number | null; durationUnit: string | null }[]) =>
        items.map((i) => [i.name, i.strength, i.frequency, i.durationValue ? `${i.durationValue} ${i.durationUnit?.toLowerCase()}` : null].filter(Boolean).join(' '));
      await this.audit.record(
        actor,
        {
          action: 'prescription.revised',
          resourceType: 'prescription',
          resourceId: id,
          reason: draft.revisionReason,
          oldValue: { versionNumber: previous.versionNumber, medicines: summary(previous.items), advice: previous.advice },
          newValue: { rxNumber: rx.rxNumber, versionNumber: draft.versionNumber, medicines: summary(finalVersion.items), advice: finalVersion.advice },
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async discardRevision(actor: Actor, id: string, version: number): Promise<PrescriptionDto> {
    this.authz.assertPermission(actor, PERMISSIONS.PRESCRIPTIONS_REVISE);
    const rx = await this.loadOwn(actor, id);
    const draft = this.revisionDraft(rx);
    if (rx.version !== version) throw AppError.staleVersion();
    await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.prescription.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
      if (bumped.count !== 1) throw AppError.staleVersion();
      await tx.prescriptionVersion.update({ where: { id: draft.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
      await this.audit.record(actor, { action: 'prescription.revision_discarded', resourceType: 'prescription', resourceId: id, newValue: { versionNumber: draft.versionNumber } }, tx);
    });
    return this.get(actor, id);
  }

  // ─────────────────────────── Printing & verification ───────────────────────────

  async printData(actor: Actor, id: string, versionNumber?: number): Promise<PrescriptionPrintDto> {
    const rx = await this.load(actor, id);
    const v = rx.versions.find((x) => x.versionNumber === (versionNumber ?? rx.currentVersion));
    const issuedVersion = v && (v.status === 'FINALIZED' || v.status === 'SUPERSEDED');
    // Drafts can be previewed by prescribers (marked as not valid); discarded drafts never.
    if (!v || v.status === 'DISCARDED' || (!issuedVersion && !this.seesDrafts(actor))) throw AppError.notFound('Prescription version');
    const [c, settings] = await Promise.all([
      this.prisma.consultation.findUniqueOrThrow({
        where: { id: rx.consultationId },
        include: {
          chamber: { select: { name: true, address: true, phone: true, email: true, timezone: true } },
          patient: { select: { patientCode: true, fullName: true, gender: true, dateOfBirth: true, phone: true } },
          doctor: { select: { qualifications: true, specialty: true, registrationNo: true, user: { select: { fullName: true } } } },
          symptoms: { orderBy: { sortOrder: 'asc' } },
          vitals: { include: { definition: true } },
          diagnoses: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
          investigations: { orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.settings.get(rx.chamberId),
    ]);
    const { version: _v, ...printSettings } = settings;
    return {
      prescriptionId: rx.id,
      rxNumber: rx.rxNumber,
      status: rx.status,
      version: toVersionDto(v, { showToken: !!issuedVersion }),
      latestVersionNumber: rx.currentVersion,
      chamber: c.chamber,
      doctor: { fullName: c.doctor.user.fullName, qualifications: c.doctor.qualifications, specialty: c.doctor.specialty, registrationNo: c.doctor.registrationNo },
      patient: { patientCode: c.patient.patientCode, fullName: c.patient.fullName, age: ageFrom(c.patient.dateOfBirth), gender: c.patient.gender, phone: c.patient.phone },
      visit: {
        visitNumber: c.visitNumber,
        date: (v.finalizedAt ?? c.finalizedAt ?? c.startedAt).toISOString(),
        complaints: c.symptoms.map((s) => ({ text: s.text, duration: s.duration })),
        vitals: c.vitals.sort((a, b) => a.definition.sortOrder - b.definition.sortOrder).map((x) => ({ label: x.definition.label, value: x.valueText, unit: x.definition.unit })),
        examinationNotes: c.examinationNotes,
        diagnoses: c.diagnoses.map((d) => ({ name: d.name, code: d.code, isPrimary: d.isPrimary, certainty: d.certainty })),
        investigations: c.investigations.map((i) => ({ name: i.name, instructions: i.instructions, priority: i.priority })),
        followUpDate: formatDateOnly(c.followUpDate),
        followUpInstructions: c.followUpInstructions,
      },
      settings: printSettings,
    };
  }

  /** Printing is audited (spec §20 "Assistant prints prescription"). */
  async logPrint(actor: Actor, id: string, versionNumber: number) {
    const rx = await this.load(actor, id);
    const v = rx.versions.find((x) => x.versionNumber === versionNumber);
    if (!v || (v.status !== 'FINALIZED' && v.status !== 'SUPERSEDED')) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only finalized prescriptions can be printed', HttpStatus.CONFLICT);
    }
    await this.audit.record(actor, { action: 'prescription.printed', resourceType: 'prescription', resourceId: id, newValue: { rxNumber: rx.rxNumber, versionNumber, superseded: v.status === 'SUPERSEDED' } });
    return { logged: true };
  }

  /** Public verification (spec §14): minimum information, never patient data. */
  async verify(token: string): Promise<PrescriptionVerificationDto> {
    const v = await this.prisma.prescriptionVersion.findUnique({
      where: { verificationToken: token },
      include: {
        prescription: {
          select: {
            rxNumber: true,
            status: true,
            currentVersion: true,
            issuedAt: true,
            chamber: { select: { name: true } },
            doctor: { select: { qualifications: true, registrationNo: true, user: { select: { fullName: true } } } },
          },
        },
      },
    });
    if (!v || (v.status !== 'FINALIZED' && v.status !== 'SUPERSEDED')) throw AppError.notFound('Prescription');
    const p = v.prescription;
    const status = p.status === 'CANCELLED' ? 'CANCELLED' : v.status === 'FINALIZED' ? 'VALID' : 'SUPERSEDED';
    return {
      valid: status === 'VALID',
      status,
      rxNumber: p.rxNumber,
      versionNumber: v.versionNumber,
      latestVersionNumber: p.currentVersion,
      issuedAt: v.finalizedAt?.toISOString() ?? null,
      supersededAt: v.supersededAt?.toISOString() ?? null,
      doctor: { fullName: p.doctor.user.fullName, qualifications: p.doctor.qualifications, registrationNo: p.doctor.registrationNo },
      chamber: { name: p.chamber.name },
      contentHash: v.contentHash,
    };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private dto(actor: Actor, rx: PrescriptionRow): PrescriptionDto {
    return toPrescriptionDto(rx, {
      showDrafts: this.seesDrafts(actor),
      showToken: actor.permissions.has(PERMISSIONS.PRESCRIPTIONS_PRINT),
      canRevise: actor.doctorId === rx.doctorId && actor.permissions.has(PERMISSIONS.PRESCRIPTIONS_REVISE) && (rx.status === 'FINALIZED' || rx.status === 'REVISED'),
    });
  }

  async load(actor: Actor, id: string): Promise<PrescriptionRow> {
    const rx = await this.prisma.prescription.findFirst({ where: { id, ...this.authz.chamberScope(actor) }, include: prescriptionInclude });
    if (!rx) throw AppError.notFound('Prescription');
    if (!this.seesDrafts(actor) && rx.status !== 'FINALIZED' && rx.status !== 'REVISED') throw AppError.notFound('Prescription');
    return rx;
  }

  /** Only the prescribing doctor may revise (spec §2 "Doctor should not modify finalized prescriptions without a revision"). */
  private async loadOwn(actor: Actor, id: string): Promise<PrescriptionRow> {
    const rx = await this.load(actor, id);
    if (!actor.doctorId || actor.doctorId !== rx.doctorId) {
      throw new AppError(ERROR_CODES.NOT_PRESCRIPTION_DOCTOR, 'Only the prescribing doctor can change this prescription', HttpStatus.FORBIDDEN);
    }
    return rx;
  }

  private revisionDraft(rx: PrescriptionRow) {
    const draft = rx.versions.find((v) => v.status === 'DRAFT');
    if (rx.status === 'DRAFT') {
      throw new AppError(ERROR_CODES.CONFLICT, 'This prescription is still part of an open consultation; edit it there', HttpStatus.CONFLICT);
    }
    if (!draft) {
      throw new AppError(ERROR_CODES.PRESCRIPTION_ALREADY_FINALIZED, 'This prescription cannot be modified directly. Create a revision instead.', HttpStatus.CONFLICT);
    }
    return draft;
  }
}


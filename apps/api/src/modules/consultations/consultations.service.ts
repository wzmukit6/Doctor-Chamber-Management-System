import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConsultationContextDto,
  ConsultationDto,
  ConsultationListQuery,
  ConsultationSummaryDto,
  ERROR_CODES,
  PERMISSIONS,
  RecordVitalsInput,
  SaveConsultationInput,
  StartConsultationInput,
  zonedDate,
  zonedDayRange,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrescriptionSettingsService } from '../settings/prescription-settings.service';
import { cancelConsultationPrescription, finalizeConsultationPrescription, upsertConsultationDraft } from '../prescriptions/prescription-writer';
import { AppError } from '../../common/errors/app-error';
import { Actor } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageMeta } from '../../common/utils/pagination';
import { toDateOnly } from '../patients/patient.utils';
import { createDraftConsultation } from './consultation-factory';
import { consultationInclude, ConsultationRow, consultationSummaryInclude, toConsultationDto, toConsultationSummary } from './consultations.mapper';
import { normalizeVitals } from './vitals';

/** Draft autosaves are audited at most once per consultation in this window. */
const DRAFT_AUDIT_WINDOW_MS = 10 * 60_000;

/**
 * Consultation workflow (spec §9): start → autosaved DRAFT → FINALIZED (immutable,
 * addenda only) or CANCELLED. Only the consultation's own doctor may edit,
 * finalize or cancel it. Finalizing completes the linked appointment.
 */
@Injectable()
export class ConsultationsService {
  private lastDraftAudit = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly prescriptionSettings: PrescriptionSettingsService,
  ) {}

  // ─────────────────────────── Queries ───────────────────────────

  async get(actor: Actor, id: string): Promise<ConsultationDto & { context: ConsultationContextDto }> {
    const c = await this.load(actor, id);
    return { ...this.dto(actor, c), context: await this.context(actor, c) };
  }

  async list(actor: Actor, q: ConsultationListQuery): Promise<PageResult<ConsultationSummaryDto>> {
    const chamber = await this.appointments.chamber(actor);
    const where: Prisma.ConsultationWhereInput = {
      chamberId: chamber.id,
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }),
      ...(q.from || q.to
        ? {
            startedAt: {
              ...(q.from ? { gte: zonedDayRange(q.from, chamber.timezone).start } : {}),
              ...(q.to ? { lt: zonedDayRange(q.to, chamber.timezone).end } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.consultation.count({ where }),
      this.prisma.consultation.findMany({
        where,
        include: consultationSummaryInclude,
        orderBy: { startedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return new PageResult(rows.map(toConsultationSummary), pageMeta(q, total));
  }

  /** Finalized consultations with a follow-up date in the range (dashboard "follow-ups due"). */
  async followUps(actor: Actor, from: string, to: string, doctorId?: string): Promise<ConsultationSummaryDto[]> {
    const chamber = await this.appointments.chamber(actor);
    const rows = await this.prisma.consultation.findMany({
      where: {
        chamberId: chamber.id,
        status: 'FINALIZED',
        followUpDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
        ...(doctorId ? { doctorId } : {}),
      },
      include: consultationSummaryInclude,
      orderBy: { followUpDate: 'asc' },
      take: 200,
    });
    return rows.map(toConsultationSummary);
  }

  // ─────────────────────────── Commands ───────────────────────────

  /**
   * Starts a consultation for a patient. If the patient has an appointment with
   * this doctor today that is waiting, it is started (and linked); an existing
   * draft for the patient is resumed instead of creating a duplicate.
   */
  async start(actor: Actor, input: StartConsultationInput): Promise<ConsultationDto & { context: ConsultationContextDto }> {
    this.authz.assertPermission(actor, PERMISSIONS.CONSULTATIONS_CREATE);
    if (!actor.doctorId) throw new AppError(ERROR_CODES.NOT_CONSULTATION_DOCTOR, 'Only doctors can start consultations', HttpStatus.FORBIDDEN);
    const chamber = await this.appointments.chamber(actor);
    const patient = await this.prisma.patient.findFirst({ where: { id: input.patientId, chamberId: chamber.id, deletedAt: null } });
    if (!patient) throw AppError.notFound('Patient');

    const draft = await this.prisma.consultation.findFirst({
      where: { patientId: patient.id, doctorId: actor.doctorId, status: 'DRAFT' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (draft) return this.get(actor, draft.id);

    const { start, end } = zonedDayRange(zonedDate(new Date(), chamber.timezone), chamber.timezone);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        ...(input.appointmentId ? { id: input.appointmentId } : { startsAt: { gte: start, lt: end } }),
        chamberId: chamber.id,
        patientId: patient.id,
        doctorId: actor.doctorId,
        status: { in: ['CHECKED_IN', 'WAITING', 'IN_CONSULTATION'] },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, status: true },
    });
    if (input.appointmentId && !appointment) throw AppError.notFound('Appointment');

    if (appointment && appointment.status !== 'IN_CONSULTATION') {
      await this.appointments.act(actor, appointment.id, 'start', {}); // creates the draft in the same transaction
    } else {
      await this.prisma.$transaction((tx) =>
        createDraftConsultation(tx, this.audit, actor, {
          organizationId: chamber.organizationId,
          chamberId: chamber.id,
          patientId: patient.id,
          doctorId: actor.doctorId!,
          appointmentId: appointment?.id ?? null,
        }),
      );
    }
    const created = await this.prisma.consultation.findFirstOrThrow({
      where: { patientId: patient.id, doctorId: actor.doctorId, status: 'DRAFT' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    return this.get(actor, created.id);
  }

  /** Autosave of the whole draft document with optimistic locking. */
  async save(actor: Actor, id: string, input: SaveConsultationInput): Promise<ConsultationDto> {
    const c = await this.loadEditable(actor, id);
    if (c.version !== input.version) throw AppError.staleVersion();
    if (input.prescription) this.authz.assertPermission(actor, PERMISSIONS.PRESCRIPTIONS_CREATE);
    const definitions = await this.prisma.vitalDefinition.findMany({ where: { id: { in: input.vitals.map((v) => v.definitionId) } } });
    const vitals = normalizeVitals(input.vitals, definitions);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.consultation.updateMany({
        where: { id, version: input.version, status: 'DRAFT' },
        data: {
          presentIllness: input.presentIllness,
          pastHistory: input.pastHistory,
          familyHistory: input.familyHistory,
          medicationHistory: input.medicationHistory,
          otherHistory: input.otherHistory,
          examinationNotes: input.examinationNotes,
          followUpDate: input.followUpDate ? toDateOnly(input.followUpDate) : null,
          followUpInstructions: input.followUpInstructions,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.staleVersion();

      await tx.consultationSymptom.deleteMany({ where: { consultationId: id } });
      await tx.consultationSymptom.createMany({
        data: input.complaints.map((s, i) => ({ consultationId: id, complaintId: s.complaintId ?? null, text: s.text, duration: s.duration, note: s.note, sortOrder: i })),
      });
      await tx.consultationDiagnosis.deleteMany({ where: { consultationId: id } });
      await tx.consultationDiagnosis.createMany({
        data: input.diagnoses.map((d, i) => ({
          consultationId: id,
          diagnosisId: d.diagnosisId ?? null,
          name: d.name,
          code: d.code,
          isPrimary: d.isPrimary,
          certainty: d.certainty,
          note: d.note,
          sortOrder: i,
        })),
      });
      await tx.consultationInvestigation.deleteMany({ where: { consultationId: id } });
      await tx.consultationInvestigation.createMany({
        data: input.investigations.map((inv, i) => ({
          consultationId: id,
          investigationId: inv.investigationId ?? null,
          name: inv.name,
          instructions: inv.instructions,
          priority: inv.priority,
          sortOrder: i,
        })),
      });

      // Vitals: keep unchanged rows (and who recorded them), replace changed ones.
      const existing = new Map(c.vitals.map((v) => [v.definitionId, v]));
      const keep = new Set(vitals.filter((v) => existing.get(v.definitionId)?.valueText === v.valueText).map((v) => v.definitionId));
      await tx.consultationVital.deleteMany({ where: { consultationId: id, definitionId: { notIn: [...keep] } } });
      await tx.consultationVital.createMany({
        data: vitals
          .filter((v) => !keep.has(v.definitionId))
          .map((v) => ({ ...v, consultationId: id, recordedById: actor.userId, recordedByName: actor.fullName })),
      });

      await tx.consultationNote.deleteMany({ where: { consultationId: id, type: 'CLINICAL' } });
      if (input.clinicalNotes) {
        await tx.consultationNote.create({ data: { consultationId: id, type: 'CLINICAL', text: input.clinicalNotes, createdById: actor.userId, createdByName: actor.fullName } });
      }

      // The prescription (version-1 draft) is saved together with the consultation.
      if (input.prescription) {
        await upsertConsultationDraft(tx, actor, c, input.prescription);
      }

      const last = this.lastDraftAudit.get(id) ?? 0;
      if (Date.now() - last > DRAFT_AUDIT_WINDOW_MS) {
        this.lastDraftAudit.set(id, Date.now());
        await this.audit.record(actor, { action: 'consultation.draft_saved', resourceType: 'consultation', resourceId: id }, tx);
      }
    });
    return this.dto(actor, await this.load(actor, id));
  }

  /**
   * Finalizes the consultation (spec §45 transaction): validates completeness,
   * locks the record, completes the linked appointment and writes the audit event.
   */
  async finalize(actor: Actor, id: string, version: number): Promise<ConsultationDto> {
    this.authz.assertPermission(actor, PERMISSIONS.CONSULTATIONS_FINALIZE);
    const c = await this.loadEditable(actor, id);
    if (c.version !== version) throw AppError.staleVersion();
    const problems: { path: string; message: string }[] = [];
    if (c.symptoms.length === 0 && c.diagnoses.length === 0) problems.push({ path: 'complaints', message: 'validation.complaint_or_diagnosis' });
    if (c.diagnoses.length > 0 && !c.diagnoses.some((d) => d.isPrimary)) problems.push({ path: 'diagnoses', message: 'validation.primary_required' });
    const chamber = await this.appointments.chamber(actor);
    if (c.followUpDate && c.followUpDate.toISOString().slice(0, 10) <= zonedDate(new Date(), chamber.timezone)) {
      problems.push({ path: 'followUpDate', message: 'validation.follow_up_future' });
    }
    if (problems.length) {
      throw new AppError(ERROR_CODES.CONSULTATION_INCOMPLETE, 'The consultation is not complete yet', HttpStatus.UNPROCESSABLE_ENTITY, problems);
    }

    const now = new Date();
    const rxSettings = await this.prescriptionSettings.get(c.chamberId);
    await this.prisma.$transaction(async (tx) => {
      // Prescription version 1 is finalized in the same transaction (spec §45).
      await finalizeConsultationPrescription(tx, this.audit, actor, c, now, rxSettings.defaultAdvice || null);
      const res = await tx.consultation.updateMany({
        where: { id, version, status: 'DRAFT' },
        data: { status: 'FINALIZED', finalizedAt: now, finalizedById: actor.userId, finalizedByName: actor.fullName, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      if (c.appointmentId) {
        const done = await tx.appointment.updateMany({
          where: { id: c.appointmentId, status: 'IN_CONSULTATION' },
          data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
        });
        if (done.count === 1) {
          await tx.appointmentStatusHistory.create({
            data: {
              appointmentId: c.appointmentId,
              action: 'STATUS_CHANGED',
              fromStatus: 'IN_CONSULTATION',
              toStatus: 'COMPLETED',
              details: { consultationFinalized: id },
              changedById: actor.userId,
              changedByName: actor.fullName,
            },
          });
        }
      }
      await this.audit.record(
        actor,
        {
          action: 'consultation.finalized',
          resourceType: 'consultation',
          resourceId: id,
          newValue: {
            patientId: c.patientId,
            diagnoses: c.diagnoses.map((d) => ({ name: d.name, code: d.code, primary: d.isPrimary })),
            investigations: c.investigations.map((i) => i.name),
            followUpDate: c.followUpDate?.toISOString().slice(0, 10) ?? null,
          },
        },
        tx,
      );
    });
    this.lastDraftAudit.delete(id);
    return this.dto(actor, await this.load(actor, id));
  }

  /** Abandons a draft (never deletes it). The appointment goes back to the waiting queue. */
  async cancel(actor: Actor, id: string, reason: string, version: number): Promise<ConsultationDto> {
    const c = await this.loadEditable(actor, id);
    if (c.version !== version) throw AppError.staleVersion();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.consultation.updateMany({
        where: { id, version, status: 'DRAFT' },
        // Unlink the appointment so the visit can be started again.
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: reason, appointmentId: null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      await cancelConsultationPrescription(tx, id, new Date());
      if (c.appointmentId) {
        const back = await tx.appointment.updateMany({ where: { id: c.appointmentId, status: 'IN_CONSULTATION' }, data: { status: 'WAITING', version: { increment: 1 } } });
        if (back.count === 1) {
          await tx.appointmentStatusHistory.create({
            data: { appointmentId: c.appointmentId, action: 'STATUS_CHANGED', fromStatus: 'IN_CONSULTATION', toStatus: 'WAITING', reason, changedById: actor.userId, changedByName: actor.fullName },
          });
        }
      }
      await this.audit.record(actor, { action: 'consultation.cancelled', resourceType: 'consultation', resourceId: id, reason, oldValue: { appointmentId: c.appointmentId } }, tx);
    });
    return this.dto(actor, await this.load(actor, id));
  }

  /** Addenda are the only change allowed after finalization (append-only, audited). */
  async addAddendum(actor: Actor, id: string, text: string): Promise<ConsultationDto> {
    this.authz.assertPermission(actor, PERMISSIONS.CONSULTATIONS_UPDATE);
    const c = await this.load(actor, id);
    if (c.status !== 'FINALIZED') {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Addenda can only be added to finalized consultations', HttpStatus.CONFLICT);
    }
    if (actor.doctorId !== c.doctorId) throw new AppError(ERROR_CODES.NOT_CONSULTATION_DOCTOR, "Only the consultation's doctor can add an addendum", HttpStatus.FORBIDDEN);
    await this.prisma.$transaction(async (tx) => {
      const note = await tx.consultationNote.create({ data: { consultationId: id, type: 'ADDENDUM', text, createdById: actor.userId, createdByName: actor.fullName } });
      await this.audit.record(actor, { action: 'consultation.addendum_added', resourceType: 'consultation', resourceId: id, newValue: { noteId: note.id, text } }, tx);
    });
    return this.dto(actor, await this.load(actor, id));
  }

  /** Vitals taken before the consultation (e.g. by an assistant at check-in). */
  async recordPreVitals(actor: Actor, appointmentId: string, input: RecordVitalsInput) {
    const appt = await this.appointments.load(actor, appointmentId);
    if (!['CHECKED_IN', 'WAITING', 'IN_CONSULTATION'].includes(appt.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Vitals can be recorded once the patient has checked in', HttpStatus.CONFLICT);
    }
    const consultation = await this.prisma.consultation.findUnique({ where: { appointmentId }, select: { id: true, status: true, doctorId: true } });
    if (consultation && consultation.status !== 'DRAFT') {
      throw new AppError(ERROR_CODES.CONSULTATION_FINALIZED, 'The consultation is already closed', HttpStatus.CONFLICT);
    }
    const definitions = await this.prisma.vitalDefinition.findMany({ where: { id: { in: input.vitals.map((v) => v.definitionId) } } });
    const vitals = normalizeVitals(input.vitals, definitions);
    await this.prisma.$transaction(async (tx) => {
      for (const v of vitals) {
        const owner = consultation ? { consultationId: consultation.id } : { appointmentId, consultationId: null };
        await tx.consultationVital.deleteMany({ where: { ...owner, definitionId: v.definitionId } });
        await tx.consultationVital.create({ data: { ...v, ...owner, appointmentId, recordedById: actor.userId, recordedByName: actor.fullName } });
      }
      if (consultation) await tx.consultation.update({ where: { id: consultation.id }, data: { version: { increment: 1 } } });
      await this.audit.record(actor, { action: 'vitals.recorded', resourceType: 'appointment', resourceId: appointmentId, newValue: { count: vitals.length } }, tx);
    });
    return this.preVitals(actor, appointmentId);
  }

  async preVitals(actor: Actor, appointmentId: string) {
    await this.appointments.load(actor, appointmentId);
    const rows = await this.prisma.consultationVital.findMany({ where: { appointmentId }, include: { definition: true } });
    return rows
      .sort((a, b) => a.definition.sortOrder - b.definition.sortOrder)
      .map((v) => ({ definitionId: v.definitionId, key: v.definition.key, label: v.definition.label, unit: v.definition.unit, value: v.valueText, recordedByName: v.recordedByName, recordedAt: v.recordedAt.toISOString() }));
  }

  // ─────────────────────────── Helpers ───────────────────────────

  private dto(actor: Actor, c: ConsultationRow): ConsultationDto {
    return toConsultationDto(c, {
      canSeeNotes: actor.permissions.has(PERMISSIONS.CLINICAL_NOTES_VIEW),
      canEdit: c.status === 'DRAFT' && actor.doctorId === c.doctorId && actor.permissions.has(PERMISSIONS.CONSULTATIONS_UPDATE),
      canSeePrescription: actor.permissions.has(PERMISSIONS.PRESCRIPTIONS_VIEW),
    });
  }

  private async context(actor: Actor, c: ConsultationRow): Promise<ConsultationContextDto> {
    const canSeeMedical = actor.permissions.has(PERMISSIONS.PATIENTS_VIEW_MEDICAL);
    const [history, allergies, previous] = await Promise.all([
      canSeeMedical ? this.prisma.patientMedicalHistory.findUnique({ where: { patientId: c.patientId } }) : null,
      canSeeMedical ? this.prisma.patientAllergy.findMany({ where: { patientId: c.patientId, deletedAt: null }, orderBy: { createdAt: 'asc' } }) : [],
      this.prisma.consultation.findMany({
        where: { patientId: c.patientId, status: 'FINALIZED', id: { not: c.id } },
        include: consultationSummaryInclude,
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
    ]);
    return {
      allergies: allergies.map((a) => ({ id: a.id, allergen: a.allergen, reaction: a.reaction, severity: a.severity, createdAt: a.createdAt.toISOString() })),
      existingConditions: history?.existingConditions ?? null,
      currentMedications: history?.currentMedications ?? null,
      previousVisits: previous.map(toConsultationSummary),
      medicalHidden: !canSeeMedical,
    };
  }

  async load(actor: Actor, id: string): Promise<ConsultationRow> {
    const c = await this.prisma.consultation.findFirst({ where: { id, ...this.authz.chamberScope(actor) }, include: consultationInclude });
    if (!c) throw AppError.notFound('Consultation');
    return c;
  }

  private async loadEditable(actor: Actor, id: string): Promise<ConsultationRow> {
    this.authz.assertPermission(actor, PERMISSIONS.CONSULTATIONS_UPDATE);
    const c = await this.load(actor, id);
    if (c.doctorId !== actor.doctorId) {
      throw new AppError(ERROR_CODES.NOT_CONSULTATION_DOCTOR, "Only the consultation's doctor can change it", HttpStatus.FORBIDDEN);
    }
    if (c.status !== 'DRAFT') {
      throw new AppError(
        ERROR_CODES.CONSULTATION_FINALIZED,
        c.status === 'FINALIZED' ? 'This consultation is finalized and cannot be modified. Add an addendum instead.' : 'This consultation was cancelled',
        HttpStatus.CONFLICT,
      );
    }
    return c;
  }
}

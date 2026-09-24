import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AllergyInput,
  CreatePatientInput,
  DuplicateCandidateDto,
  DuplicateCheckInput,
  ERROR_CODES,
  PatientDto,
  PatientListQuery,
  PatientSummaryDto,
  PERMISSIONS,
  UpdateMedicalHistoryInput,
  UpdatePatientInput,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageArgs, pageMeta, safeSort } from '../../common/utils/pagination';
import { diff } from '../../common/utils/sanitize';
import {
  patientDetailInclude,
  PatientDetailRow,
  patientSummarySelect,
  toPatientDto,
  toPatientSummary,
} from './patients.mapper';
import { PatientsRepository } from './patients.repository';
import {
  ageFrom,
  estimatedDobFromAge,
  formatDateOnly,
  formatPatientCode,
  normalizePhoneForSearch,
  toDateOnly,
} from './patient.utils';

/** A profile view is written to the audit log at most once per user/patient in this window. */
const VIEW_AUDIT_WINDOW_MS = 10 * 60_000;
const DEMOGRAPHIC_FIELDS = [
  'fullName',
  'gender',
  'dateOfBirth',
  'dobEstimated',
  'bloodGroup',
  'phone',
  'email',
  'address',
  'occupation',
  'nationality',
] as const;

/**
 * Patient management (spec §5, §6). Patients belong to a chamber; every read and
 * write is scoped to the actor's chamber. Demographics and medical information
 * are separately permissioned (`patients.update` vs `patients.update_medical`,
 * `patients.view` vs `patients.view_medical`).
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PatientsRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, query: PatientListQuery): Promise<PageResult<PatientSummaryDto>> {
    const scope = this.authz.chamberScope(actor);
    const sort = query.sort ? safeSort(query.sort, ['createdAt', 'fullName', 'patientCode'] as const, 'createdAt') : undefined;
    const { skip, take } = pageArgs(query);
    const { ids, total } = await this.repo.search({
      chamberId: scope.chamberId ?? null,
      q: query.q,
      gender: query.gender,
      registeredFrom: query.registeredFrom,
      registeredTo: query.registeredTo,
      sort,
      order: query.order,
      skip,
      take,
    });
    return new PageResult(await this.summariesInOrder(ids), pageMeta(query, total));
  }

  /** Lightweight search for the command palette and pickers. */
  async quickSearch(actor: Actor, q: string, limit: number): Promise<PatientSummaryDto[]> {
    const scope = this.authz.chamberScope(actor);
    const { ids } = await this.repo.search({ chamberId: scope.chamberId ?? null, q, order: 'desc', skip: 0, take: limit });
    return this.summariesInOrder(ids);
  }

  async recent(actor: Actor): Promise<PatientSummaryDto[]> {
    const views = await this.prisma.patientRecentView.findMany({
      where: {
        userId: actor.userId,
        ...(actor.chamberId ? { chamberId: actor.chamberId } : {}),
        patient: { deletedAt: null },
      },
      orderBy: { viewedAt: 'desc' },
      take: 8,
      select: { patient: { select: patientSummarySelect } },
    });
    return views.map((v) => toPatientSummary(v.patient));
  }

  async get(actor: Actor, id: string): Promise<PatientDto> {
    const patient = await this.load(actor, id);
    await this.recordView(actor, patient);
    return toPatientDto(patient, actor.permissions.has(PERMISSIONS.PATIENTS_VIEW_MEDICAL));
  }

  async checkDuplicates(actor: Actor, input: DuplicateCheckInput): Promise<DuplicateCandidateDto[]> {
    const chamberId = this.requireChamber(actor);
    return this.duplicates(chamberId, input);
  }

  async create(actor: Actor, input: CreatePatientInput): Promise<PatientDto> {
    const chamberId = this.requireChamber(actor);
    const wantsMedical = !!input.medicalHistory || (input.allergies?.length ?? 0) > 0;
    if (wantsMedical) this.authz.assertPermission(actor, PERMISSIONS.PATIENTS_UPDATE_MEDICAL);

    const { dateOfBirth, dobEstimated } = resolveDob(input.dateOfBirth, input.ageYears);
    if (!input.allowDuplicate) {
      const candidates = await this.duplicates(chamberId, {
        fullName: input.fullName,
        phone: input.phone ?? undefined,
        // Only an exact (non-estimated) date of birth is meaningful for duplicate matching.
        dateOfBirth: input.dateOfBirth ?? undefined,
      });
      const blocking = candidates.filter(
        (c) => (c.matchReasons.includes('phone') && c.matchReasons.includes('name')) || (c.matchReasons.includes('name') && c.matchReasons.includes('dob')),
      );
      if (blocking.length) {
        throw new AppError(
          ERROR_CODES.POSSIBLE_DUPLICATE,
          'A patient with similar details is already registered. Review the matches or confirm to register anyway.',
          HttpStatus.CONFLICT,
          undefined,
          { candidates: blocking },
        );
      }
    }

    const chamber = await this.prisma.chamber.findUniqueOrThrow({ where: { id: chamberId }, select: { code: true, organizationId: true } });
    const id = await this.prisma.$transaction(async (tx) => {
      const sequence = await this.repo.nextSequence(tx, chamberId);
      const patient = await tx.patient.create({
        data: {
          organizationId: chamber.organizationId,
          chamberId,
          patientCode: formatPatientCode(chamber.code, sequence),
          fullName: input.fullName,
          gender: input.gender,
          dateOfBirth,
          dobEstimated,
          bloodGroup: input.bloodGroup ?? null,
          phone: input.phone ?? null,
          phoneSearch: normalizePhoneForSearch(input.phone),
          email: input.email ?? null,
          address: input.address,
          occupation: input.occupation,
          nationality: input.nationality,
          createdById: actor.userId,
          updatedById: actor.userId,
          contacts: {
            create: input.emergencyContacts.map((c, i) => ({ name: c.name, relation: c.relation, phone: c.phone, sortOrder: i })),
          },
          ...(input.medicalHistory
            ? { medicalHistory: { create: { ...input.medicalHistory, updatedById: actor.userId, updatedByName: actor.fullName } } }
            : {}),
          ...(input.allergies?.length
            ? { allergies: { create: input.allergies.map((a) => ({ ...a, createdById: actor.userId })) } }
            : {}),
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'patient.created',
          resourceType: 'patient',
          resourceId: patient.id,
          newValue: {
            patientCode: patient.patientCode,
            fullName: patient.fullName,
            gender: patient.gender,
            dateOfBirth: formatDateOnly(dateOfBirth),
            phone: patient.phone,
            ...(input.allowDuplicate ? { duplicateWarningOverridden: true } : {}),
            ...(wantsMedical ? { medicalInfoCaptured: true } : {}),
          },
        },
        tx,
      );
      return patient.id;
    });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: UpdatePatientInput): Promise<PatientDto> {
    const before = await this.load(actor, id);
    const { dateOfBirth, dobEstimated } = keepEstimatedDob(before, input.dateOfBirth, input.ageYears);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.patient.updateMany({
        where: { id, version: input.version, deletedAt: null },
        data: {
          fullName: input.fullName,
          gender: input.gender,
          dateOfBirth,
          dobEstimated,
          bloodGroup: input.bloodGroup ?? null,
          phone: input.phone ?? null,
          phoneSearch: normalizePhoneForSearch(input.phone),
          email: input.email ?? null,
          address: input.address,
          occupation: input.occupation,
          nationality: input.nationality,
          updatedById: actor.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.staleVersion();

      const contactsBefore = before.contacts.map((c) => ({ name: c.name, relation: c.relation, phone: c.phone }));
      const contactsChanged = JSON.stringify(contactsBefore) !== JSON.stringify(input.emergencyContacts.map((c) => ({ name: c.name, relation: c.relation ?? null, phone: c.phone })));
      if (contactsChanged) {
        await tx.patientContact.deleteMany({ where: { patientId: id } });
        await tx.patientContact.createMany({
          data: input.emergencyContacts.map((c, i) => ({ patientId: id, name: c.name, relation: c.relation, phone: c.phone, sortOrder: i })),
        });
      }

      const after = await tx.patient.findUniqueOrThrow({ where: { id } });
      const d = diff(pickDemographics(before), pickDemographics(after));
      if (contactsChanged) {
        d.oldValue.emergencyContacts = contactsBefore;
        d.newValue.emergencyContacts = input.emergencyContacts;
      }
      await this.audit.record(actor, { action: 'patient.updated', resourceType: 'patient', resourceId: id, ...d }, tx);
    });
    return this.get(actor, id);
  }

  async updateMedicalHistory(actor: Actor, id: string, input: UpdateMedicalHistoryInput): Promise<PatientDto> {
    const patient = await this.load(actor, id);
    const { version, ...fields } = input;
    const before = patient.medicalHistory;

    await this.prisma.$transaction(async (tx) => {
      if (!before) {
        if (version !== 0) throw AppError.staleVersion();
        await tx.patientMedicalHistory.create({
          data: { patientId: id, ...fields, updatedById: actor.userId, updatedByName: actor.fullName },
        });
      } else {
        const res = await tx.patientMedicalHistory.updateMany({
          where: { patientId: id, version },
          data: { ...fields, updatedById: actor.userId, updatedByName: actor.fullName, version: { increment: 1 } },
        });
        if (res.count !== 1) throw AppError.staleVersion();
      }
      const after = await tx.patientMedicalHistory.findUniqueOrThrow({ where: { patientId: id } });
      const d = diff(pickHistory(before), pickHistory(after));
      await this.audit.record(
        actor,
        {
          action: 'patient.medical_history_updated',
          resourceType: 'patient',
          resourceId: id,
          oldValue: d.oldValue,
          newValue: d.newValue,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async addAllergy(actor: Actor, id: string, input: AllergyInput): Promise<PatientDto> {
    const patient = await this.load(actor, id);
    const duplicate = patient.allergies.find((a) => a.allergen.toLowerCase() === input.allergen.toLowerCase());
    if (duplicate) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'This allergy is already recorded', HttpStatus.CONFLICT, [
        { path: 'allergen', message: 'validation.allergy_exists' },
      ]);
    }
    await this.prisma.$transaction(async (tx) => {
      const allergy = await tx.patientAllergy.create({ data: { patientId: id, ...input, createdById: actor.userId } });
      await this.audit.record(
        actor,
        { action: 'patient.allergy_added', resourceType: 'patient', resourceId: id, newValue: { allergyId: allergy.id, ...input } },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async removeAllergy(actor: Actor, id: string, allergyId: string, reason: string): Promise<PatientDto> {
    const patient = await this.load(actor, id);
    const allergy = patient.allergies.find((a) => a.id === allergyId);
    if (!allergy) throw AppError.notFound('Allergy');
    await this.prisma.$transaction(async (tx) => {
      await tx.patientAllergy.update({
        where: { id: allergyId },
        data: { deletedAt: new Date(), deletedById: actor.userId, deletionReason: reason },
      });
      await this.audit.record(
        actor,
        {
          action: 'patient.allergy_removed',
          resourceType: 'patient',
          resourceId: id,
          oldValue: { allergyId, allergen: allergy.allergen, reaction: allergy.reaction, severity: allergy.severity },
          reason,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  /** Soft delete (spec §25, §60). The record is archived, never erased. */
  async remove(actor: Actor, id: string, reason: string): Promise<void> {
    const patient = await this.load(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, deletionReason: reason, version: { increment: 1 } },
      });
      await this.audit.record(
        actor,
        {
          action: 'patient.deleted',
          resourceType: 'patient',
          resourceId: id,
          oldValue: { patientCode: patient.patientCode, fullName: patient.fullName },
          reason,
          chamberId: patient.chamberId,
        },
        tx,
      );
    });
  }

  /** Loads a patient inside the actor's tenant scope; other chambers' patients are "not found". */
  async load(actor: Actor, id: string): Promise<PatientDetailRow> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, deletedAt: null, ...this.authz.chamberScope(actor) },
      include: patientDetailInclude,
    });
    if (!patient) throw AppError.notFound('Patient');
    return patient;
  }

  private requireChamber(actor: Actor): string {
    if (!actor.chamberId) {
      throw AppError.forbidden(
        isSuperAdmin(actor) ? 'Patients are registered inside a chamber. Sign in with a chamber membership.' : undefined,
      );
    }
    return actor.chamberId;
  }

  private async duplicates(chamberId: string, input: DuplicateCheckInput): Promise<DuplicateCandidateDto[]> {
    const rows = await this.repo.findDuplicateCandidates({ chamberId, ...input });
    if (rows.length === 0) return [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const patients = await this.prisma.patient.findMany({ where: { id: { in: [...byId.keys()] } }, select: patientSummarySelect });
    return patients
      .map((p) => {
        const r = byId.get(p.id)!;
        const reasons: DuplicateCandidateDto['matchReasons'] = [];
        if (r.phoneMatch) reasons.push('phone');
        if (Number(r.nameSimilarity) >= 0.5) reasons.push('name');
        if (r.dobMatch) reasons.push('dob');
        return { ...toPatientSummary(p), matchReasons: reasons };
      })
      .sort((a, b) => b.matchReasons.length - a.matchReasons.length);
  }

  private async summariesInOrder(ids: string[]): Promise<PatientSummaryDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.patient.findMany({ where: { id: { in: ids } }, select: patientSummarySelect });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(toPatientSummary);
  }

  /** Access logging (spec §21): profile views are audited and feed "recent patients". */
  private async recordView(actor: Actor, patient: PatientDetailRow) {
    const previous = await this.prisma.patientRecentView.findUnique({
      where: { userId_patientId: { userId: actor.userId, patientId: patient.id } },
    });
    await this.prisma.patientRecentView.upsert({
      where: { userId_patientId: { userId: actor.userId, patientId: patient.id } },
      update: { viewedAt: new Date(), chamberId: patient.chamberId },
      create: { userId: actor.userId, patientId: patient.id, chamberId: patient.chamberId },
    });
    if (!previous || Date.now() - previous.viewedAt.getTime() > VIEW_AUDIT_WINDOW_MS) {
      await this.audit.record(actor, {
        action: 'patient.viewed',
        resourceType: 'patient',
        resourceId: patient.id,
        chamberId: patient.chamberId,
      });
    }
  }
}

function resolveDob(dateOfBirth?: string | null, ageYears?: number | null) {
  if (dateOfBirth) return { dateOfBirth: toDateOnly(dateOfBirth), dobEstimated: false };
  if (ageYears !== null && ageYears !== undefined) return { dateOfBirth: estimatedDobFromAge(ageYears), dobEstimated: true };
  return { dateOfBirth: null, dobEstimated: false };
}

/** Keeps an existing estimated date of birth when the age did not change, so it does not drift on every edit. */
function keepEstimatedDob(before: PatientDetailRow, dateOfBirth?: string | null, ageYears?: number | null) {
  if (!dateOfBirth && before.dobEstimated && ageYears !== null && ageYears !== undefined && ageFrom(before.dateOfBirth) === ageYears) {
    return { dateOfBirth: before.dateOfBirth, dobEstimated: true };
  }
  return resolveDob(dateOfBirth, ageYears);
}

function pickDemographics(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DEMOGRAPHIC_FIELDS) out[k] = p[k] instanceof Date ? formatDateOnly(p[k] as Date) : (p[k] ?? null);
  return out;
}

function pickHistory(h: Prisma.PatientMedicalHistoryGetPayload<object> | null): Record<string, unknown> {
  return {
    existingConditions: h?.existingConditions ?? null,
    previousSurgeries: h?.previousSurgeries ?? null,
    currentMedications: h?.currentMedications ?? null,
    relevantHistory: h?.relevantHistory ?? null,
    familyHistory: h?.familyHistory ?? null,
    lifestyle: h?.lifestyle ?? null,
  };
}

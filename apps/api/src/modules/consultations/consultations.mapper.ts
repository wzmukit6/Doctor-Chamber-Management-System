import { Prisma } from '@prisma/client';
import type { ConsultationDto, ConsultationSummaryDto } from '@chamber/shared';
import { ageFrom, formatDateOnly } from '../patients/patient.utils';

export const consultationInclude = {
  patient: { select: { id: true, patientCode: true, fullName: true, gender: true, dateOfBirth: true, dobEstimated: true, bloodGroup: true, phone: true } },
  doctor: { select: { id: true, specialty: true, qualifications: true, registrationNo: true, user: { select: { fullName: true } } } },
  symptoms: { orderBy: { sortOrder: 'asc' } },
  vitals: { include: { definition: true } },
  diagnoses: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  investigations: { orderBy: { sortOrder: 'asc' } },
  notes: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ConsultationInclude;

export type ConsultationRow = Prisma.ConsultationGetPayload<{ include: typeof consultationInclude }>;

export function toConsultationDto(c: ConsultationRow, opts: { canSeeNotes: boolean; canEdit: boolean }): ConsultationDto {
  const clinical = c.notes.find((n) => n.type === 'CLINICAL');
  return {
    id: c.id,
    chamberId: c.chamberId,
    status: c.status,
    visitNumber: c.visitNumber,
    patient: {
      id: c.patient.id,
      patientCode: c.patient.patientCode,
      fullName: c.patient.fullName,
      gender: c.patient.gender,
      age: ageFrom(c.patient.dateOfBirth),
      dobEstimated: c.patient.dobEstimated,
      bloodGroup: c.patient.bloodGroup,
      phone: c.patient.phone,
    },
    doctor: {
      id: c.doctor.id,
      fullName: c.doctor.user.fullName,
      specialty: c.doctor.specialty,
      qualifications: c.doctor.qualifications,
      registrationNo: c.doctor.registrationNo,
    },
    appointmentId: c.appointmentId,
    complaints: c.symptoms.map((s) => ({ id: s.id, complaintId: s.complaintId, text: s.text, duration: s.duration, note: s.note })),
    presentIllness: c.presentIllness,
    pastHistory: c.pastHistory,
    familyHistory: c.familyHistory,
    medicationHistory: c.medicationHistory,
    otherHistory: c.otherHistory,
    vitals: c.vitals
      .sort((a, b) => a.definition.sortOrder - b.definition.sortOrder)
      .map((v) => ({
        definitionId: v.definitionId,
        key: v.definition.key,
        label: v.definition.label,
        unit: v.definition.unit,
        value: v.valueText,
        recordedByName: v.recordedByName,
        recordedAt: v.recordedAt.toISOString(),
      })),
    examinationNotes: c.examinationNotes,
    diagnoses: c.diagnoses.map((d) => ({ id: d.id, diagnosisId: d.diagnosisId, name: d.name, code: d.code, isPrimary: d.isPrimary, certainty: d.certainty, note: d.note })),
    investigations: c.investigations.map((i) => ({ id: i.id, investigationId: i.investigationId, name: i.name, instructions: i.instructions, priority: i.priority })),
    clinicalNotes: opts.canSeeNotes ? (clinical?.text ?? null) : null,
    clinicalNotesHidden: !opts.canSeeNotes && !!clinical,
    addenda: c.notes
      .filter((n) => n.type === 'ADDENDUM')
      .map((n) => ({ id: n.id, text: n.text, createdByName: n.createdByName, createdAt: n.createdAt.toISOString() })),
    followUpDate: formatDateOnly(c.followUpDate),
    followUpInstructions: c.followUpInstructions,
    startedAt: c.startedAt.toISOString(),
    finalizedAt: c.finalizedAt?.toISOString() ?? null,
    finalizedByName: c.finalizedByName,
    cancelledReason: c.cancelledReason,
    updatedAt: c.updatedAt.toISOString(),
    version: c.version,
    canEdit: opts.canEdit,
  };
}

export const consultationSummaryInclude = {
  patient: { select: { id: true, patientCode: true, fullName: true, gender: true, dateOfBirth: true } },
  doctor: { select: { id: true, user: { select: { fullName: true } } } },
  diagnoses: { select: { name: true, isPrimary: true } },
  symptoms: { select: { text: true }, orderBy: { sortOrder: 'asc' } },
  _count: { select: { investigations: true } },
} satisfies Prisma.ConsultationInclude;

type SummaryRow = Prisma.ConsultationGetPayload<{ include: typeof consultationSummaryInclude }>;

export function toConsultationSummary(c: SummaryRow): ConsultationSummaryDto {
  return {
    id: c.id,
    status: c.status,
    visitNumber: c.visitNumber,
    patient: { id: c.patient.id, patientCode: c.patient.patientCode, fullName: c.patient.fullName, age: ageFrom(c.patient.dateOfBirth), gender: c.patient.gender },
    doctor: { id: c.doctor.id, fullName: c.doctor.user.fullName },
    primaryDiagnosis: c.diagnoses.find((d) => d.isPrimary)?.name ?? c.diagnoses[0]?.name ?? null,
    diagnosisCount: c.diagnoses.length,
    complaints: c.symptoms.map((s) => s.text),
    investigationCount: c._count.investigations,
    followUpDate: formatDateOnly(c.followUpDate),
    startedAt: c.startedAt.toISOString(),
    finalizedAt: c.finalizedAt?.toISOString() ?? null,
  };
}

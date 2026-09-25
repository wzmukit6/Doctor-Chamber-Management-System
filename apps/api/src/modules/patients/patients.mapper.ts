import { Prisma } from '@prisma/client';
import type { AllergyDto, MedicalHistoryDto, PatientDto, PatientSummaryDto } from '@chamber/shared';
import { ageFrom, formatDateOnly } from './patient.utils';

export const patientSummarySelect = {
  id: true,
  patientCode: true,
  fullName: true,
  gender: true,
  dateOfBirth: true,
  dobEstimated: true,
  phone: true,
  bloodGroup: true,
  createdAt: true,
  isDemo: true,
} satisfies Prisma.PatientSelect;

export type PatientSummaryRow = Prisma.PatientGetPayload<{ select: typeof patientSummarySelect }>;

export const patientDetailInclude = {
  contacts: { orderBy: { sortOrder: 'asc' } },
  allergies: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  medicalHistory: true,
  createdBy: { select: { fullName: true } },
} satisfies Prisma.PatientInclude;

export type PatientDetailRow = Prisma.PatientGetPayload<{ include: typeof patientDetailInclude }>;

export function toPatientSummary(p: PatientSummaryRow): PatientSummaryDto {
  return {
    id: p.id,
    patientCode: p.patientCode,
    fullName: p.fullName,
    gender: p.gender,
    dateOfBirth: formatDateOnly(p.dateOfBirth),
    dobEstimated: p.dobEstimated,
    age: ageFrom(p.dateOfBirth),
    phone: p.phone,
    bloodGroup: p.bloodGroup,
    registeredAt: p.createdAt.toISOString(),
    isDemo: p.isDemo,
  };
}

function toAllergy(a: PatientDetailRow['allergies'][number]): AllergyDto {
  return { id: a.id, allergen: a.allergen, reaction: a.reaction, severity: a.severity, createdAt: a.createdAt.toISOString() };
}

function toHistory(h: PatientDetailRow['medicalHistory']): MedicalHistoryDto {
  return {
    existingConditions: h?.existingConditions ?? null,
    previousSurgeries: h?.previousSurgeries ?? null,
    currentMedications: h?.currentMedications ?? null,
    relevantHistory: h?.relevantHistory ?? null,
    familyHistory: h?.familyHistory ?? null,
    lifestyle: h?.lifestyle ?? null,
    version: h?.version ?? 0,
    updatedAt: h?.updatedAt.toISOString() ?? null,
    updatedByName: h?.updatedByName ?? null,
  };
}

/** Full profile. Medical data is only included for viewers with `patients.view_medical`. */
export function toPatientDto(p: PatientDetailRow, includeMedical: boolean): PatientDto {
  return {
    ...toPatientSummary(p),
    chamberId: p.chamberId,
    email: p.email,
    address: p.address,
    occupation: p.occupation,
    nationality: p.nationality,
    emergencyContacts: p.contacts.map((c) => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone })),
    version: p.version,
    registeredByName: p.createdBy?.fullName ?? null,
    updatedAt: p.updatedAt.toISOString(),
    medical: includeMedical ? { history: toHistory(p.medicalHistory), allergies: p.allergies.map(toAllergy) } : null,
  };
}

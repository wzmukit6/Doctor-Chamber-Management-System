import { Prisma } from '@prisma/client';
import type { MedicineDto, PrescriptionDto, PrescriptionItemDto, PrescriptionSummaryDto, PrescriptionVersionDto } from '@chamber/shared';
import { ageFrom } from '../patients/patient.utils';

type ItemLike = {
  id?: string;
  medicineId: string | null;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  durationValue: number | null;
  durationUnit: string | null;
  quantity: number | null;
  mealInstruction: string | null;
  timing: string | null;
  instructions: string | null;
};

export function toItemDto(i: ItemLike): PrescriptionItemDto {
  return {
    ...(i.id ? { id: i.id } : {}),
    medicineId: i.medicineId,
    name: i.name,
    genericName: i.genericName,
    strength: i.strength,
    form: i.form,
    dose: i.dose,
    frequency: i.frequency,
    route: i.route,
    durationValue: i.durationValue,
    durationUnit: i.durationUnit,
    quantity: i.quantity,
    mealInstruction: i.mealInstruction,
    timing: i.timing,
    instructions: i.instructions,
  };
}

export const versionInclude = { items: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.PrescriptionVersionInclude;
type VersionRow = Prisma.PrescriptionVersionGetPayload<{ include: typeof versionInclude }>;

export function toVersionDto(v: VersionRow, opts: { showToken: boolean }): PrescriptionVersionDto {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    advice: v.advice,
    revisionReason: v.revisionReason,
    items: v.items.map(toItemDto),
    createdByName: v.createdByName,
    createdAt: v.createdAt.toISOString(),
    updatedByName: v.updatedByName,
    updatedAt: v.updatedAt.toISOString(),
    finalizedByName: v.finalizedByName,
    finalizedAt: v.finalizedAt?.toISOString() ?? null,
    supersededAt: v.supersededAt?.toISOString() ?? null,
    discardedAt: v.discardedAt?.toISOString() ?? null,
    verificationToken: opts.showToken ? v.verificationToken : null,
    contentHash: v.contentHash,
  };
}

export const prescriptionSummaryInclude = {
  patient: { select: { id: true, patientCode: true, fullName: true, gender: true, dateOfBirth: true } },
  doctor: { select: { id: true, user: { select: { fullName: true } } } },
  consultation: { select: { diagnoses: { select: { name: true, isPrimary: true } } } },
  versions: { select: { versionNumber: true, status: true, _count: { select: { items: true } } } },
} satisfies Prisma.PrescriptionInclude;
type SummaryRow = Prisma.PrescriptionGetPayload<{ include: typeof prescriptionSummaryInclude }>;

export function toPrescriptionSummary(p: SummaryRow): PrescriptionSummaryDto {
  const current = p.versions.find((v) => v.versionNumber === p.currentVersion);
  return {
    id: p.id,
    rxNumber: p.rxNumber,
    status: p.status,
    currentVersion: p.currentVersion,
    hasDraftRevision: p.status !== 'DRAFT' && p.versions.some((v) => v.status === 'DRAFT'),
    patient: { id: p.patient.id, patientCode: p.patient.patientCode, fullName: p.patient.fullName, age: ageFrom(p.patient.dateOfBirth), gender: p.patient.gender },
    doctor: { id: p.doctor.id, fullName: p.doctor.user.fullName },
    consultationId: p.consultationId,
    itemCount: current?._count.items ?? 0,
    primaryDiagnosis: p.consultation.diagnoses.find((d) => d.isPrimary)?.name ?? p.consultation.diagnoses[0]?.name ?? null,
    issuedAt: p.issuedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export const prescriptionInclude = {
  ...prescriptionSummaryInclude,
  versions: { include: versionInclude, orderBy: { versionNumber: 'desc' } },
} satisfies Prisma.PrescriptionInclude;
export type PrescriptionRow = Prisma.PrescriptionGetPayload<{ include: typeof prescriptionInclude }>;

export function toPrescriptionDto(
  p: PrescriptionRow,
  opts: { showDrafts: boolean; showToken: boolean; canRevise: boolean },
): PrescriptionDto {
  const summary = toPrescriptionSummary({
    ...p,
    versions: p.versions.map((v) => ({ versionNumber: v.versionNumber, status: v.status, _count: { items: v.items.length } })),
  });
  return {
    ...summary,
    versions: p.versions
      .filter((v) => opts.showDrafts || v.status === 'FINALIZED' || v.status === 'SUPERSEDED')
      .map((v) => toVersionDto(v, { showToken: opts.showToken && (v.status === 'FINALIZED' || v.status === 'SUPERSEDED') })),
    version: p.version,
    canRevise: opts.canRevise,
  };
}

export type MedicineRow = {
  id: string;
  chamber_id: string | null;
  generic_name: string;
  brand_name: string | null;
  manufacturer: string | null;
  form: string;
  strength: string | null;
  category: string | null;
  route: string | null;
  default_dose: string | null;
  common_frequencies: string[] | null;
  common_durations: string[] | null;
  keywords: string | null;
  is_active: boolean;
  is_favorite?: boolean | null;
  usage_count?: bigint | number | null;
};

export function toMedicineDto(r: MedicineRow): MedicineDto {
  return {
    id: r.id,
    genericName: r.generic_name,
    brandName: r.brand_name,
    manufacturer: r.manufacturer,
    form: r.form,
    strength: r.strength,
    category: r.category,
    route: r.route,
    defaultDose: r.default_dose,
    commonFrequencies: r.common_frequencies ?? [],
    commonDurations: r.common_durations ?? [],
    keywords: r.keywords,
    isActive: r.is_active,
    isGlobal: r.chamber_id === null,
    isFavorite: !!r.is_favorite,
    ...(r.usage_count !== undefined && r.usage_count !== null ? { usageCount: Number(r.usage_count) } : {}),
  };
}

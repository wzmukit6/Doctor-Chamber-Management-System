import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrescriptionContentInput, PrescriptionItemLike } from '@chamber/shared';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from '../../common/request-context';

type Tx = Prisma.TransactionClient;

/**
 * Transactional building blocks for prescriptions, shared by the consultation
 * workflow (version 1 is written and finalized together with the consultation)
 * and the revision workflow. Plain functions so both modules can use them
 * inside their own transactions without a module dependency cycle.
 */

export function itemRows(items: PrescriptionItemLike[]) {
  return items.map((it, i) => ({
    medicineId: it.medicineId ?? null,
    name: it.name,
    genericName: it.genericName ?? null,
    strength: it.strength ?? null,
    form: it.form ?? null,
    dose: it.dose ?? null,
    frequency: it.frequency ?? null,
    route: it.route ?? null,
    durationValue: it.durationValue ?? null,
    durationUnit: it.durationUnit ?? null,
    quantity: it.quantity ?? null,
    mealInstruction: it.mealInstruction ?? null,
    timing: it.timing ?? null,
    instructions: it.instructions ?? null,
    sortOrder: i,
  }));
}

/** Drops medicine references that are not visible to the chamber (global or own). */
export async function sanitizeMedicineRefs<T extends { medicineId?: string | null }>(tx: Tx, chamberId: string, items: T[]): Promise<T[]> {
  const ids = [...new Set(items.map((i) => i.medicineId).filter((v): v is string => !!v))];
  if (!ids.length) return items;
  const visible = await tx.medicine.findMany({ where: { id: { in: ids }, OR: [{ chamberId: null }, { chamberId }] }, select: { id: true } });
  const ok = new Set(visible.map((m) => m.id));
  return items.map((i) => (i.medicineId && !ok.has(i.medicineId) ? { ...i, medicineId: null } : i));
}

/** Replaces the content of a DRAFT version. */
export async function writeDraftContent(tx: Tx, actor: Actor, versionId: string, chamberId: string, content: PrescriptionContentInput) {
  const items = await sanitizeMedicineRefs(tx, chamberId, content.items);
  await tx.prescriptionItem.deleteMany({ where: { versionId } });
  if (items.length) await tx.prescriptionItem.createMany({ data: itemRows(items).map((r) => ({ ...r, versionId })) });
  await tx.prescriptionVersion.update({
    where: { id: versionId },
    data: { advice: content.advice ?? null, updatedById: actor.userId, updatedByName: actor.fullName },
  });
}

/**
 * Creates (on first save) or updates the consultation's version-1 draft.
 * Returns the prescription id.
 */
export async function upsertConsultationDraft(
  tx: Tx,
  actor: Actor,
  consultation: { id: string; organizationId: string; chamberId: string; patientId: string; doctorId: string; isDemo?: boolean },
  content: PrescriptionContentInput,
): Promise<string> {
  let rx = await tx.prescription.findUnique({ where: { consultationId: consultation.id }, select: { id: true } });
  if (!rx) {
    rx = await tx.prescription.create({
      data: {
        organizationId: consultation.organizationId,
        chamberId: consultation.chamberId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        consultationId: consultation.id,
        isDemo: consultation.isDemo ?? false,
        createdById: actor.userId,
        versions: { create: { versionNumber: 1, createdById: actor.userId, createdByName: actor.fullName } },
      },
      select: { id: true },
    });
  }
  const draft = await tx.prescriptionVersion.findFirstOrThrow({ where: { prescriptionId: rx.id, versionNumber: 1, status: 'DRAFT' }, select: { id: true } });
  await writeDraftContent(tx, actor, draft.id, consultation.chamberId, content);
  await tx.prescription.update({ where: { id: rx.id }, data: { version: { increment: 1 } } });
  return rx.id;
}

export async function nextRxNumber(tx: Tx, chamberId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO prescription_sequences (chamber_id, last_value) VALUES (${chamberId}::uuid, 1)
    ON CONFLICT (chamber_id) DO UPDATE SET last_value = prescription_sequences.last_value + 1
    RETURNING last_value`;
  return `RX-${String(rows[0]!.last_value).padStart(6, '0')}`;
}

export function verificationToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Tamper-evidence hash over the clinically relevant content of a version. */
export function contentHash(input: {
  rxNumber: string;
  versionNumber: number;
  patientId: string;
  doctorId: string;
  advice: string | null;
  items: ReturnType<typeof itemRows>;
}): string {
  const canonical = JSON.stringify({
    rx: input.rxNumber,
    v: input.versionNumber,
    patient: input.patientId,
    doctor: input.doctorId,
    advice: input.advice,
    items: input.items.map((i) => [i.name, i.genericName, i.strength, i.form, i.dose, i.frequency, i.route, i.durationValue, i.durationUnit, i.quantity, i.mealInstruction, i.timing, i.instructions]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Marks a DRAFT version FINALIZED with verification token and content hash. */
export async function finalizeVersion(
  tx: Tx,
  actor: Actor,
  rx: { id: string; rxNumber: string; patientId: string; doctorId: string },
  versionId: string,
  now: Date,
) {
  const version = await tx.prescriptionVersion.findUniqueOrThrow({ where: { id: versionId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  const hash = contentHash({
    rxNumber: rx.rxNumber,
    versionNumber: version.versionNumber,
    patientId: rx.patientId,
    doctorId: rx.doctorId,
    advice: version.advice,
    items: itemRows(version.items.map((i) => ({ ...i }))),
  });
  const res = await tx.prescriptionVersion.updateMany({
    where: { id: versionId, status: 'DRAFT' },
    data: {
      status: 'FINALIZED',
      finalizedAt: now,
      finalizedById: actor.userId,
      finalizedByName: actor.fullName,
      verificationToken: verificationToken(),
      contentHash: hash,
    },
  });
  return { finalized: res.count === 1, version, hash };
}

/**
 * Finalizes version 1 as part of consultation finalization (spec §45): creates
 * an (empty) prescription if the doctor wrote none, assigns the Rx number and
 * locks the version.
 */
export async function finalizeConsultationPrescription(
  tx: Tx,
  audit: AuditService,
  actor: Actor,
  consultation: { id: string; organizationId: string; chamberId: string; patientId: string; doctorId: string },
  now: Date,
  defaultAdvice: string | null,
) {
  let rx = await tx.prescription.findUnique({ where: { consultationId: consultation.id } });
  if (!rx) {
    await upsertConsultationDraft(tx, actor, consultation, { items: [], advice: defaultAdvice });
    rx = await tx.prescription.findUniqueOrThrow({ where: { consultationId: consultation.id } });
  }
  if (rx.status !== 'DRAFT') return rx;
  const rxNumber = await nextRxNumber(tx, consultation.chamberId);
  const draft = await tx.prescriptionVersion.findFirstOrThrow({ where: { prescriptionId: rx.id, versionNumber: 1, status: 'DRAFT' }, select: { id: true } });
  const { version } = await finalizeVersion(tx, actor, { id: rx.id, rxNumber, patientId: rx.patientId, doctorId: rx.doctorId }, draft.id, now);
  const updated = await tx.prescription.update({
    where: { id: rx.id },
    data: { rxNumber, status: 'FINALIZED', issuedAt: now, currentVersion: 1, version: { increment: 1 } },
  });
  await audit.record(
    actor,
    {
      action: 'prescription.finalized',
      resourceType: 'prescription',
      resourceId: rx.id,
      newValue: {
        rxNumber,
        versionNumber: 1,
        patientId: rx.patientId,
        consultationId: consultation.id,
        medicines: version.items.map((i) => [i.name, i.strength, i.frequency].filter(Boolean).join(' ')),
      },
    },
    tx,
  );
  return updated;
}

/** Consultation cancelled → its unissued prescription is cancelled and the draft discarded. */
export async function cancelConsultationPrescription(tx: Tx, consultationId: string, now: Date) {
  const rx = await tx.prescription.findUnique({ where: { consultationId }, select: { id: true, status: true } });
  if (!rx || rx.status !== 'DRAFT') return;
  await tx.prescriptionVersion.updateMany({ where: { prescriptionId: rx.id, status: 'DRAFT' }, data: { status: 'DISCARDED', discardedAt: now } });
  await tx.prescription.update({ where: { id: rx.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
}

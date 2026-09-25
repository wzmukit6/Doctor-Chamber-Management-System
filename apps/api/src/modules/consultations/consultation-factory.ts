import { Prisma } from '@prisma/client';
import type { Actor } from '../../common/request-context';
import type { AuditService } from '../audit/audit.service';

/**
 * Creates a DRAFT consultation (spec §9). Used when a doctor starts a
 * consultation from the queue (appointment "start" action) or directly from
 * the patient's profile. Vitals recorded before the consultation for the same
 * appointment (e.g. by an assistant) are adopted.
 */
export async function createDraftConsultation(
  tx: Prisma.TransactionClient,
  audit: AuditService,
  actor: Actor,
  p: { organizationId: string; chamberId: string; patientId: string; doctorId: string; appointmentId: string | null },
): Promise<string> {
  const previous = await tx.consultation.count({ where: { patientId: p.patientId, chamberId: p.chamberId, status: { not: 'CANCELLED' } } });
  const consultation = await tx.consultation.create({
    data: {
      organizationId: p.organizationId,
      chamberId: p.chamberId,
      patientId: p.patientId,
      doctorId: p.doctorId,
      appointmentId: p.appointmentId,
      visitNumber: previous + 1,
      createdById: actor.userId,
    },
  });
  if (p.appointmentId) {
    await tx.consultationVital.updateMany({ where: { appointmentId: p.appointmentId, consultationId: null }, data: { consultationId: consultation.id } });
  }
  await audit.record(
    actor,
    {
      action: 'consultation.started',
      resourceType: 'consultation',
      resourceId: consultation.id,
      newValue: { patientId: p.patientId, appointmentId: p.appointmentId, visitNumber: consultation.visitNumber },
    },
    tx,
  );
  return consultation.id;
}

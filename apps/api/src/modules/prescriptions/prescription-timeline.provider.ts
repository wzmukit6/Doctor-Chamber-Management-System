import { Injectable, OnModuleInit } from '@nestjs/common';
import type { TimelineEventDto } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';

/** Timeline events for issued prescription versions (spec §32): the original and every revision. */
@Injectable()
export class PrescriptionTimelineProvider implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
  ) {}

  onModuleInit() {
    this.timeline.register({
      types: ['prescription'],
      events: async (patient, { before, limit }) => {
        const rows = await this.prisma.prescriptionVersion.findMany({
          where: {
            prescription: { patientId: patient.id },
            status: { in: ['FINALIZED', 'SUPERSEDED'] },
            ...(before ? { finalizedAt: { lt: before } } : {}),
          },
          orderBy: { finalizedAt: 'desc' },
          take: limit,
          include: { items: { orderBy: { sortOrder: 'asc' }, select: { name: true, strength: true } }, prescription: { select: { id: true, rxNumber: true } } },
        });
        return rows.map(
          (v): TimelineEventDto => ({
            id: `prescription:${v.id}`,
            type: 'prescription',
            occurredAt: (v.finalizedAt ?? v.createdAt).toISOString(),
            title: v.versionNumber === 1 ? 'Prescription issued' : 'Prescription revised',
            titleKey: v.versionNumber === 1 ? 'timeline.prescription_issued' : 'timeline.prescription_revised',
            details: {
              rxNumber: v.prescription.rxNumber,
              versionNumber: v.versionNumber,
              prescriptionId: v.prescription.id,
              medicines: v.items.map((i) => (i.strength ? `${i.name} ${i.strength}` : i.name)).join(', ') || null,
              ...(v.revisionReason ? { reason: v.revisionReason } : {}),
              ...(v.status === 'SUPERSEDED' ? { status: 'SUPERSEDED' } : {}),
            },
            actorName: v.finalizedByName,
          }),
        );
      },
    });
  }
}

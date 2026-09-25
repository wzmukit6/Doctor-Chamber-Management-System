import { Injectable, OnModuleInit } from '@nestjs/common';
import type { TimelineEventDto } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';

/**
 * Timeline events for finalized consultations (spec §32): the visit with its
 * primary diagnosis, ordered investigations and the planned follow-up.
 */
@Injectable()
export class ConsultationTimelineProvider implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
  ) {}

  onModuleInit() {
    this.timeline.register({
      types: ['consultation', 'diagnosis', 'investigation', 'follow_up'],
      events: async (patient, { before, limit }) => {
        const rows = await this.prisma.consultation.findMany({
          where: { patientId: patient.id, status: 'FINALIZED', ...(before ? { finalizedAt: { lt: before } } : {}) },
          orderBy: { finalizedAt: 'desc' },
          take: limit,
          include: {
            doctor: { select: { user: { select: { fullName: true } } } },
            diagnoses: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
            investigations: { orderBy: { sortOrder: 'asc' } },
            symptoms: { orderBy: { sortOrder: 'asc' } },
          },
        });
        return rows.flatMap((c): TimelineEventDto[] => {
          const at = (c.finalizedAt ?? c.startedAt).toISOString();
          const doctor = c.doctor.user.fullName;
          const events: TimelineEventDto[] = [
            {
              id: `consultation:${c.id}`,
              type: 'consultation',
              occurredAt: at,
              title: 'Consultation',
              titleKey: 'timeline.consultation',
              details: { doctor, visitNumber: c.visitNumber, complaints: c.symptoms.map((s) => s.text).join(', ') || null, consultationId: c.id },
              actorName: doctor,
            },
          ];
          if (c.diagnoses.length) {
            events.push({
              id: `diagnosis:${c.id}`,
              type: 'diagnosis',
              occurredAt: at,
              title: 'Diagnosis',
              titleKey: 'timeline.diagnosis',
              details: { diagnoses: c.diagnoses.map((d) => (d.code ? `${d.name} (${d.code})` : d.name)).join(', '), consultationId: c.id },
              actorName: doctor,
            });
          }
          if (c.investigations.length) {
            events.push({
              id: `investigation:${c.id}`,
              type: 'investigation',
              occurredAt: at,
              title: 'Investigations',
              titleKey: 'timeline.investigation',
              details: { investigations: c.investigations.map((i) => i.name).join(', '), count: c.investigations.length, consultationId: c.id },
              actorName: doctor,
            });
          }
          if (c.followUpDate) {
            events.push({
              id: `follow_up:${c.id}`,
              type: 'follow_up',
              occurredAt: at,
              title: 'Follow-up',
              titleKey: 'timeline.follow_up',
              details: { date: c.followUpDate.toISOString().slice(0, 10), instructions: c.followUpInstructions },
              actorName: doctor,
            });
          }
          return events;
        });
      },
    });
  }
}

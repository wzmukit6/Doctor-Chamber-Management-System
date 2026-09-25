import { Injectable, OnModuleInit } from '@nestjs/common';
import type { TimelineEventDto } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';

/** Adds appointment events (booked, rescheduled, visits, cancellations) to the patient timeline. */
@Injectable()
export class AppointmentTimelineProvider implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
  ) {}

  onModuleInit() {
    this.timeline.register({
      types: ['appointment'],
      events: async (patient, { before, limit }) => {
        const rows = await this.prisma.appointment.findMany({
          where: { patientId: patient.id, ...(before ? { startsAt: { lt: before } } : {}) },
          orderBy: { startsAt: 'desc' },
          take: limit,
          include: { doctor: { select: { user: { select: { fullName: true } } } } },
        });
        return rows.map(
          (a): TimelineEventDto => ({
            id: `appointment:${a.id}`,
            type: 'appointment',
            occurredAt: a.startsAt.toISOString(),
            title: `Appointment (${a.status})`,
            titleKey: `timeline.appointment_${a.status.toLowerCase()}`,
            details: {
              doctor: a.doctor.user.fullName,
              visitType: a.visitType,
              status: a.status,
              appointmentId: a.id,
              ...(a.cancelledReason ? { reason: a.cancelledReason } : {}),
            },
            actorName: a.createdByName,
          }),
        );
      },
    });
  }
}

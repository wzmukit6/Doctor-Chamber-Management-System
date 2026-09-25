import { Injectable, OnModuleInit } from '@nestjs/common';
import type { TimelineEventDto } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientTimelineService } from '../patients/patient-timeline.service';
import { money } from './billing.mapper';

/** Payment and refund events on the patient timeline (spec §32). */
@Injectable()
export class PaymentTimelineProvider implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: PatientTimelineService,
  ) {}

  onModuleInit() {
    this.timeline.register({
      types: ['payment'],
      events: async (patient, { before, limit }) => {
        const rows = await this.prisma.payment.findMany({
          where: { invoice: { patientId: patient.id }, ...(before ? { receivedAt: { lt: before } } : {}) },
          orderBy: { receivedAt: 'desc' },
          take: limit,
          include: { invoice: { select: { id: true, invoiceNumber: true } } },
        });
        return rows.map(
          (p): TimelineEventDto => ({
            id: `payment:${p.id}`,
            type: 'payment',
            occurredAt: p.receivedAt.toISOString(),
            title: p.kind === 'REFUND' ? 'Refund' : 'Payment received',
            titleKey: p.kind === 'REFUND' ? 'timeline.refund' : 'timeline.payment',
            details: { amount: money(p.amount).toFixed(2), method: p.method, receiptNumber: p.receiptNumber, invoiceNumber: p.invoice.invoiceNumber, invoiceId: p.invoice.id },
            actorName: p.receivedByName,
          }),
        );
      },
    });
  }
}

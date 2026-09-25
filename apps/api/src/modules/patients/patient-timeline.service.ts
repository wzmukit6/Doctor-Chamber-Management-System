import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type TimelineEventDto, type TimelineType } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../../common/request-context';
import type { PatientDetailRow } from './patients.mapper';

/**
 * A source of timeline events. Each module (appointments, consultations,
 * prescriptions, billing …) contributes its own provider as it is delivered,
 * so the timeline grows without changing this service's contract.
 */
export interface TimelineProvider {
  readonly types: TimelineType[];
  events(patient: PatientDetailRow, opts: { before?: Date; limit: number }): Promise<TimelineEventDto[]>;
}

const MEDICAL_TITLE_KEYS = new Set(['timeline.medical_history_updated', 'timeline.allergy_added', 'timeline.allergy_removed']);

/** Clinical event types whose details require `patients.view_medical`. */
const MEDICAL_TYPES = new Set<TimelineType>(['consultation', 'diagnosis', 'investigation', 'follow_up']);

const RECORD_ACTIONS: Record<string, string> = {
  'patient.updated': 'timeline.patient_updated',
  'patient.medical_history_updated': 'timeline.medical_history_updated',
  'patient.allergy_added': 'timeline.allergy_added',
  'patient.allergy_removed': 'timeline.allergy_removed',
};

/**
 * Chronological patient history (spec §5, §32): registration → appointments →
 * consultations → diagnoses → prescriptions → investigations → payments → follow-ups.
 * Phase 2 provides registration and record-change events; later phases add providers.
 */
@Injectable()
export class PatientTimelineService {
  private readonly providers: TimelineProvider[];

  constructor(private readonly prisma: PrismaService) {
    this.providers = [this.registrationProvider(), this.recordChangesProvider()];
  }

  /** Other modules (appointments, consultations, prescriptions, billing) contribute events here. */
  register(provider: TimelineProvider) {
    this.providers.push(provider);
  }

  async timeline(
    actor: Actor,
    patient: PatientDetailRow,
    opts: { types: TimelineType[]; before?: string; limit: number },
  ): Promise<{ events: TimelineEventDto[]; hasMore: boolean }> {
    const before = opts.before ? new Date(opts.before) : undefined;
    const wanted = opts.types.length ? new Set(opts.types) : null;
    const active = this.providers.filter((p) => !wanted || p.types.some((t) => wanted.has(t)));
    const batches = await Promise.all(active.map((p) => p.events(patient, { before, limit: opts.limit + 1 })));
    const events = batches
      .flat()
      .filter((e) => !wanted || wanted.has(e.type))
      .filter((e) => !before || new Date(e.occurredAt) < before)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    // Viewers without medical access see that a medical change happened, but not what changed.
    const canSeeMedical = actor.permissions.has(PERMISSIONS.PATIENTS_VIEW_MEDICAL);
    const visible = events.map((e) =>
      canSeeMedical || (!MEDICAL_TITLE_KEYS.has(e.titleKey) && !MEDICAL_TYPES.has(e.type)) ? e : { ...e, details: e.type === 'follow_up' ? { date: e.details.date ?? null } : {} },
    );
    return { events: visible.slice(0, opts.limit), hasMore: visible.length > opts.limit };
  }

  private registrationProvider(): TimelineProvider {
    return {
      types: ['registration'],
      events: async (patient) => [
        {
          id: `registration:${patient.id}`,
          type: 'registration',
          occurredAt: patient.createdAt.toISOString(),
          title: 'Patient registered',
          titleKey: 'timeline.registered',
          details: { patientCode: patient.patientCode },
          actorName: patient.createdBy?.fullName ?? null,
        },
      ],
    };
  }

  /** Changes to the patient record, derived from the audit trail (values are not exposed here). */
  private recordChangesProvider(): TimelineProvider {
    return {
      types: ['record'],
      events: async (patient, { before, limit }) => {
        const rows = await this.prisma.auditLog.findMany({
          where: {
            resourceType: 'patient',
            resourceId: patient.id,
            action: { in: Object.keys(RECORD_ACTIONS) },
            ...(before ? { createdAt: { lt: before } } : {}),
          },
          orderBy: { seq: 'desc' },
          take: limit,
          select: { id: true, action: true, createdAt: true, userName: true, newValue: true, oldValue: true, reason: true },
        });
        return rows.map((r) => {
          const changed =
            r.action === 'patient.updated' || r.action === 'patient.medical_history_updated'
              ? Object.keys((r.newValue as Record<string, unknown> | null) ?? {}).join(', ')
              : null;
          const allergen =
            r.action === 'patient.allergy_added'
              ? ((r.newValue as { allergen?: string } | null)?.allergen ?? null)
              : r.action === 'patient.allergy_removed'
                ? ((r.oldValue as { allergen?: string } | null)?.allergen ?? null)
                : null;
          return {
            id: `audit:${r.id}`,
            type: 'record' as const,
            occurredAt: r.createdAt.toISOString(),
            title: r.action,
            titleKey: RECORD_ACTIONS[r.action]!,
            details: {
              ...(changed ? { fields: changed } : {}),
              ...(allergen ? { allergen } : {}),
              ...(r.reason ? { reason: r.reason } : {}),
            },
            actorName: r.userName,
          };
        });
      },
    };
  }
}

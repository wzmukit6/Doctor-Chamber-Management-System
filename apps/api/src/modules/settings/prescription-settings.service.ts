import { Injectable } from '@nestjs/common';
import {
  PrescriptionSettings,
  prescriptionSettingsSchema,
  DEFAULT_PRESCRIPTION_SETTINGS,
  UpdatePrescriptionSettingsInput,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';

const KEY = 'prescriptions';

/** Chamber-level prescription print & content settings (spec §34 "Prescription Settings"). */
@Injectable()
export class PrescriptionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(chamberId: string): Promise<PrescriptionSettings & { version: number }> {
    const row = await this.prisma.setting.findUnique({
      where: { scope_scopeId_key: { scope: 'CHAMBER', scopeId: chamberId, key: KEY } },
    });
    if (!row) return { ...DEFAULT_PRESCRIPTION_SETTINGS, version: 0 };
    // Merge with defaults so newly added settings get sensible values.
    const parsed = prescriptionSettingsSchema.safeParse({ ...DEFAULT_PRESCRIPTION_SETTINGS, ...(row.value as object) });
    return { ...(parsed.success ? parsed.data : DEFAULT_PRESCRIPTION_SETTINGS), version: row.version };
  }

  async update(actor: Actor, chamberId: string, input: UpdatePrescriptionSettingsInput) {
    const { version, ...value } = input;
    const before = await this.get(chamberId);
    await this.prisma.$transaction(async (tx) => {
      if (before.version === 0) {
        if (version !== 0) throw AppError.staleVersion();
        await tx.setting.create({ data: { scope: 'CHAMBER', scopeId: chamberId, key: KEY, value, updatedById: actor.userId } });
      } else {
        const res = await tx.setting.updateMany({
          where: { scope: 'CHAMBER', scopeId: chamberId, key: KEY, version },
          data: { value, version: { increment: 1 }, updatedById: actor.userId },
        });
        if (res.count !== 1) throw AppError.staleVersion();
      }
      const { version: _v, ...old } = before;
      await this.audit.record(
        actor,
        { action: 'settings.prescriptions_updated', resourceType: 'settings', resourceId: `${chamberId}:${KEY}`, oldValue: old, newValue: value, chamberId },
        tx,
      );
    });
    return this.get(chamberId);
  }
}

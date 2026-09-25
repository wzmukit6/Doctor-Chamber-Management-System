import { Injectable } from '@nestjs/common';
import { ChamberProfile, chamberProfileSchema, DEFAULT_CHAMBER_PROFILE } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsStore } from './settings-store';

/** Chamber profile extras (spec §34 "Chamber Settings"): logo, tagline, opening hours. */
@Injectable()
export class ChamberProfileService extends SettingsStore<ChamberProfile> {
  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit, 'chamber_profile', 'CHAMBER', chamberProfileSchema as never, DEFAULT_CHAMBER_PROFILE);
  }

  /** The logo is large; audit only whether it changed. */
  auditView(v: ChamberProfile) {
    return { ...v, logoDataUrl: v.logoDataUrl ? `image (${v.logoDataUrl.length} chars)` : null };
  }
}

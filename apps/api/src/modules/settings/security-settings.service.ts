import { Injectable } from '@nestjs/common';
import { SecuritySettings, securitySettingsSchema } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadConfig } from '../../config/config';
import { SettingsStore } from './settings-store';

const CACHE_MS = 30_000;

/**
 * Platform security policy (spec §34 "Security"): password policy, session
 * timeouts and login lockout. Defaults come from the environment; a super
 * admin can change them at runtime. Read on every login/session touch, so cached briefly.
 */
@Injectable()
export class SecuritySettingsService extends SettingsStore<SecuritySettings> {
  private cache: { value: SecuritySettings & { version: number }; at: number } | null = null;

  constructor(prisma: PrismaService, audit: AuditService) {
    const config = loadConfig();
    super(
      prisma,
      audit,
      'security',
      'PLATFORM',
      securitySettingsSchema as never,
      securitySettingsSchema.parse({
        sessionIdleMinutes: config.SESSION_IDLE_MINUTES,
        sessionAbsoluteHours: config.SESSION_ABSOLUTE_HOURS,
        loginMaxFailedAttempts: config.LOGIN_MAX_FAILED_ATTEMPTS,
        loginLockoutMinutes: config.LOGIN_LOCKOUT_MINUTES,
      }),
    );
  }

  async current(): Promise<SecuritySettings & { version: number }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const value = await this.get(null);
    this.cache = { value, at: Date.now() };
    return value;
  }

  protected override onChange() {
    this.cache = null;
  }
}

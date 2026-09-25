import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type SystemStatusDto } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { loadConfig } from '../../config/config';
import { metrics } from '../../common/observability/metrics';

/** Platform health for super administrators (spec §17 "View system health/activity", §64). */
@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.SYSTEM_MANAGE)
  async status(): Promise<SystemStatusDto> {
    const started = Date.now();
    const [[db], [conn], [security], activeSessions, [migration]] = await Promise.all([
      this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
      this.prisma.$queryRaw<{ failed: number; locked: number; blocked: number }[]>`
        SELECT count(*) FILTER (WHERE action = 'auth.login_failed')::int AS failed,
               count(*) FILTER (WHERE action = 'auth.account_locked')::int AS locked,
               count(*) FILTER (WHERE action = 'auth.login_blocked')::int AS blocked
        FROM audit_logs WHERE created_at > now() - interval '24 hours' AND action LIKE 'auth.%'`,
      this.prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } } }),
      this.prisma.$queryRaw<{ name: string; finished_at: Date | null }[]>`
        SELECT migration_name AS name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1`,
    ]);
    const mem = process.memoryUsage();
    return {
      version: loadConfig().APP_VERSION,
      environment: loadConfig().NODE_ENV,
      nodeVersion: process.version,
      uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
      memoryMb: Math.round(mem.rss / 1048576),
      database: {
        latencyMs: Date.now() - started,
        sizeMb: Math.round(Number(db.size) / 1048576),
        connections: conn.n,
        latestMigration: migration?.name ?? null,
      },
      traffic: metrics.summary(),
      security: { failedLogins24h: security.failed, lockouts24h: security.locked, blockedLogins24h: security.blocked, activeSessions },
      generatedAt: new Date().toISOString(),
    };
  }
}

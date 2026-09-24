import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditLogDto, paginationQuerySchema, PERMISSIONS, ROLES } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentActor, RequirePermissions } from '../../common/decorators/auth.decorators';
import { ValidQuery } from '../../common/decorators/validated.decorator';
import type { Actor } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageArgs, pageMeta } from '../../common/utils/pagination';
import { AuditService } from './audit.service';

const auditQuerySchema = paginationQuerySchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.string().uuid().optional(),
  role: z.string().max(40).optional(),
  action: z.string().max(80).optional(),
  resourceType: z.string().max(60).optional(),
  resourceId: z.string().max(64).optional(),
  chamberId: z.string().uuid().optional(),
});
type AuditQuery = z.infer<typeof auditQuerySchema>;

@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Scope (spec §50): super admin → everything; manager → own chamber;
   * doctor → own actions only. No endpoint exists to modify or delete audit rows.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_LOGS_VIEW)
  async list(@CurrentActor() actor: Actor, @ValidQuery(auditQuerySchema) q: AuditQuery): Promise<PageResult<AuditLogDto>> {
    const scope: Prisma.AuditLogWhereInput =
      actor.role === ROLES.SUPER_ADMIN
        ? q.chamberId
          ? { chamberId: q.chamberId }
          : {}
        : actor.role === ROLES.MANAGER
          ? { chamberId: actor.chamberId }
          : { userId: actor.userId, chamberId: actor.chamberId };

    const where: Prisma.AuditLogWhereInput = {
      AND: [
        scope,
        q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {},
        q.userId ? { userId: q.userId } : {},
        q.role ? { role: q.role } : {},
        q.action ? { action: { contains: q.action } } : {},
        q.resourceType ? { resourceType: q.resourceType } : {},
        q.resourceId ? { resourceId: q.resourceId } : {},
        q.q
          ? {
              OR: [
                { userName: { contains: q.q, mode: 'insensitive' } },
                { action: { contains: q.q, mode: 'insensitive' } },
                { reason: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { seq: q.order }, ...pageArgs(q) }),
    ]);
    const showClientMeta = actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.MANAGER;
    return new PageResult(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        userId: r.userId,
        userName: r.userName,
        role: r.role,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        chamberId: r.chamberId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        ipAddress: showClientMeta ? r.ipAddress : null,
        userAgent: showClientMeta ? r.userAgent : null,
      })),
      pageMeta(q, total),
    );
  }

  @Get('verify')
  @RequirePermissions(PERMISSIONS.SYSTEM_MANAGE)
  verify() {
    return this.audit.verifyChain();
  }
}

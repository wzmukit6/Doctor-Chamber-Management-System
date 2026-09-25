import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChamberDto, CreateChamberInput, ERROR_CODES, PaginationQuery, UpdateChamberInput } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageArgs, pageMeta, safeSort } from '../../common/utils/pagination';
import { diff } from '../../common/utils/sanitize';

const include = {
  organization: { select: { name: true } },
  _count: { select: { memberships: { where: { isActive: true, user: { deletedAt: null } } } } },
} as const;
type ChamberRow = Prisma.ChamberGetPayload<{ include: typeof include }>;

function toDto(c: ChamberRow): ChamberDto {
  return {
    id: c.id,
    organizationId: c.organizationId,
    organizationName: c.organization.name,
    name: c.name,
    code: c.code,
    phone: c.phone,
    email: c.email,
    address: c.address,
    timezone: c.timezone,
    isActive: c.isActive,
    isDemo: c.isDemo,
    createdAt: c.createdAt.toISOString(),
    version: c.version,
    staffCount: c._count.memberships,
  };
}

export type ChamberListQuery = PaginationQuery & { organizationId?: string };

@Injectable()
export class ChambersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, query: ChamberListQuery): Promise<PageResult<ChamberDto>> {
    const where: Prisma.ChamberWhereInput = {
      deletedAt: null,
      ...(isSuperAdmin(actor)
        ? query.organizationId
          ? { organizationId: query.organizationId }
          : {}
        : { id: actor.chamberId ?? '00000000-0000-0000-0000-000000000000' }),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { code: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    const sort = safeSort(query.sort, ['createdAt', 'name', 'code'] as const, 'createdAt');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chamber.count({ where }),
      this.prisma.chamber.findMany({ where, include, orderBy: { [sort]: query.order }, ...pageArgs(query) }),
    ]);
    return new PageResult(rows.map(toDto), pageMeta(query, total));
  }

  async get(actor: Actor, id: string): Promise<ChamberDto> {
    this.authz.assertChamberAccess(actor, id);
    const chamber = await this.prisma.chamber.findFirst({ where: { id, deletedAt: null }, include });
    if (!chamber) throw AppError.notFound('Chamber');
    return toDto(chamber);
  }

  async create(actor: Actor, input: CreateChamberInput): Promise<ChamberDto> {
    const org = await this.prisma.organization.findFirst({ where: { id: input.organizationId, deletedAt: null } });
    if (!org) throw AppError.notFound('Organization');
    const chamber = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chamber.create({
        data: {
          organizationId: org.id,
          name: input.name,
          code: input.code,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address,
          timezone: input.timezone,
        },
        include,
      });
      await this.audit.record(
        actor,
        {
          action: 'chamber.created',
          resourceType: 'chamber',
          resourceId: created.id,
          newValue: input,
          chamberId: created.id,
          organizationId: org.id,
        },
        tx,
      );
      return created;
    });
    return toDto(chamber);
  }

  async update(actor: Actor, id: string, input: UpdateChamberInput): Promise<ChamberDto> {
    this.authz.assertChamberAccess(actor, id);
    const before = await this.prisma.chamber.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw AppError.notFound('Chamber');
    const { version, ...changes } = input;
    // Only a platform admin may deactivate a chamber (it locks out all its users).
    if (changes.isActive !== undefined && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only a super admin can activate or deactivate a chamber');
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.chamber.updateMany({ where: { id, version }, data: { ...changes, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.staleVersion();
      const after = await tx.chamber.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'chamber.updated',
          resourceType: 'chamber',
          resourceId: id,
          ...diff(before, after),
          chamberId: id,
          organizationId: before.organizationId,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string, reason: string) {
    const chamber = await this.prisma.chamber.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { memberships: { where: { isActive: true, user: { deletedAt: null } } } } } },
    });
    if (!chamber) throw AppError.notFound('Chamber');
    if (chamber._count.memberships > 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Deactivate or remove all staff of this chamber before deleting it',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.chamber.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, deletionReason: reason, isActive: false },
      });
      await this.audit.record(
        actor,
        {
          action: 'chamber.deleted',
          resourceType: 'chamber',
          resourceId: id,
          reason,
          chamberId: id,
          organizationId: chamber.organizationId,
        },
        tx,
      );
    });
    await this.prisma.session.updateMany({
      where: { membership: { chamberId: id }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'chamber_deleted' },
    });
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateOrganizationInput,
  ERROR_CODES,
  OrganizationDto,
  PaginationQuery,
  UpdateOrganizationInput,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { pageArgs, pageMeta, safeSort } from '../../common/utils/pagination';
import { diff } from '../../common/utils/sanitize';

const include = { _count: { select: { chambers: { where: { deletedAt: null } } } } } as const;
type OrgRow = Prisma.OrganizationGetPayload<{ include: typeof include }>;

function toDto(o: OrgRow): OrganizationDto {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    email: o.email,
    phone: o.phone,
    address: o.address,
    isActive: o.isActive,
    isDemo: o.isDemo,
    createdAt: o.createdAt.toISOString(),
    version: o.version,
    chamberCount: o._count.chambers,
  };
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, query: PaginationQuery): Promise<PageResult<OrganizationDto>> {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(isSuperAdmin(actor) ? {} : { id: actor.organizationId ?? '00000000-0000-0000-0000-000000000000' }),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };
    const sort = safeSort(query.sort, ['createdAt', 'name'] as const, 'createdAt');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({ where, include, orderBy: { [sort]: query.order }, ...pageArgs(query) }),
    ]);
    return new PageResult(rows.map(toDto), pageMeta(query, total));
  }

  async get(actor: Actor, id: string): Promise<OrganizationDto> {
    if (!isSuperAdmin(actor) && actor.organizationId !== id) throw AppError.crossTenant();
    const org = await this.prisma.organization.findFirst({ where: { id, deletedAt: null }, include });
    if (!org) throw AppError.notFound('Organization');
    return toDto(org);
  }

  async create(actor: Actor, input: CreateOrganizationInput): Promise<OrganizationDto> {
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address,
        },
        include,
      });
      await this.audit.record(
        actor,
        {
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: created.id,
          newValue: input,
          organizationId: created.id,
          chamberId: null,
        },
        tx,
      );
      return created;
    });
    return toDto(org);
  }

  async update(actor: Actor, id: string, input: UpdateOrganizationInput): Promise<OrganizationDto> {
    const before = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw AppError.notFound('Organization');
    const { version, ...changes } = input;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.organization.updateMany({
        where: { id, version },
        data: { ...changes, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.staleVersion();
      const after = await tx.organization.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'organization.updated',
          resourceType: 'organization',
          resourceId: id,
          ...diff(before, after),
          organizationId: id,
          chamberId: null,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string, reason: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { chambers: { where: { deletedAt: null } } } } },
    });
    if (!org) throw AppError.notFound('Organization');
    if (org._count.chambers > 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Delete or move all chambers of this organization first',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, deletionReason: reason, isActive: false },
      });
      await this.audit.record(
        actor,
        { action: 'organization.deleted', resourceType: 'organization', resourceId: id, reason, organizationId: id, chamberId: null },
        tx,
      );
    });
  }
}

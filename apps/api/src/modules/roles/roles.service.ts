import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  FORBIDDEN_GRANTS,
  isGrantAllowed,
  Permission,
  RoleDto,
  RoleKey,
  ROLES,
  UpdateRolePermissionsInput,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { memberships: { where: { isActive: true, user: { deletedAt: null } } } } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key as RoleKey,
      name: r.name,
      description: r.description,
      permissions: r.permissions.map((p) => p.permission.key as Permission).sort(),
      forbidden: FORBIDDEN_GRANTS[r.key as RoleKey] ?? [],
      userCount: r._count.memberships,
    }));
  }

  /** Reconfigures a role's permission set (super admin only, always audited with a reason). */
  async updatePermissions(actor: Actor, roleId: string, input: UpdateRolePermissionsInput): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw AppError.notFound('Role');
    const key = role.key as RoleKey;
    if (key === ROLES.SUPER_ADMIN) {
      throw new AppError(ERROR_CODES.GRANT_NOT_ALLOWED, 'The Super Admin role always holds every permission', HttpStatus.FORBIDDEN);
    }
    const requested = [...new Set(input.permissions as Permission[])];
    const disallowed = requested.filter((p) => !isGrantAllowed(key, p));
    if (disallowed.length) {
      throw new AppError(
        ERROR_CODES.GRANT_NOT_ALLOWED,
        `These permissions cannot be granted to ${key}: ${disallowed.join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const before = role.permissions.map((p) => p.permission.key).sort();
    const permissionRows = await this.prisma.permission.findMany({ where: { key: { in: requested } } });

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissionRows.map((p) => ({ roleId, permissionId: p.id })),
      });
      const after = permissionRows.map((p) => p.key).sort();
      await this.audit.record(
        actor,
        {
          action: 'role.permissions_updated',
          resourceType: 'role',
          resourceId: roleId,
          oldValue: { role: key, granted: before.filter((p) => !after.includes(p)) },
          newValue: { role: key, granted: after.filter((p) => !before.includes(p)) },
          reason: input.reason,
          chamberId: null,
          organizationId: null,
        },
        tx,
      );
    });
    this.authz.invalidate(roleId);
    return (await this.list()).find((r) => r.id === roleId)!;
  }
}

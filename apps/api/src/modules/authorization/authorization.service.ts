import { Injectable } from '@nestjs/common';
import { canManageRole, Permission, RoleKey } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';

const CACHE_TTL_MS = 30_000;

/**
 * Central authorization service: resolves role permissions from the database
 * (with a short cache) and provides tenant-scope checks used by services
 * and repositories (spec §3, §22, §23).
 */
@Injectable()
export class AuthorizationService {
  private cache = new Map<string, { permissions: Set<Permission>; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async permissionsForRole(roleId: string): Promise<Set<Permission>> {
    const hit = this.cache.get(roleId);
    if (hit && hit.expiresAt > Date.now()) return hit.permissions;
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
    const permissions = new Set(rows.map((r) => r.permission.key as Permission));
    this.cache.set(roleId, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
    return permissions;
  }

  invalidate(roleId?: string) {
    if (roleId) this.cache.delete(roleId);
    else this.cache.clear();
  }

  assertPermission(actor: Actor, permission: Permission) {
    if (!actor.permissions.has(permission)) throw AppError.forbidden();
  }

  /**
   * Tenant filter for chamber-owned rows. Super admin sees every chamber;
   * everyone else is restricted to their active chamber.
   */
  chamberScope(actor: Actor): { chamberId?: string } {
    if (isSuperAdmin(actor)) return {};
    if (!actor.chamberId) throw AppError.forbidden();
    return { chamberId: actor.chamberId };
  }

  /** Throws (as not-found, to avoid leaking existence) if the chamber is outside the actor's scope. */
  assertChamberAccess(actor: Actor, chamberId: string | null | undefined) {
    if (isSuperAdmin(actor)) return;
    if (!chamberId || chamberId !== actor.chamberId) throw AppError.crossTenant();
  }

  assertCanManageRole(actor: Actor, targetRole: RoleKey) {
    if (!canManageRole(actor.role, targetRole)) {
      throw new AppError('ROLE_NOT_MANAGEABLE', `Your role cannot manage ${targetRole} accounts`, 403);
    }
  }
}

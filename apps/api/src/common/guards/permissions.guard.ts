import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@chamber/shared';
import { AppError } from '../errors/app-error';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators/auth.decorators';
import type { AuthenticatedRequest } from '../request-context';

/** API-level permission check. Service-level checks (scope, ownership, state) run in addition. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    if (required.length === 0) return true;
    const { actor } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!actor || !required.every((p) => actor.permissions.has(p))) throw AppError.forbidden();
    return true;
  }
}

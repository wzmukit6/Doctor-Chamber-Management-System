import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension, ApiForbiddenResponse, ApiOperation, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Permission } from '@chamber/shared';
import type { Actor, AuthenticatedRequest } from '../request-context';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';
export const SKIP_CSRF_KEY = 'auth:skip-csrf';

/** Endpoint does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Endpoint is exempt from CSRF verification (only for unauthenticated bootstrap endpoints). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * Declares the permission(s) an endpoint requires — ALL listed permissions
 * must be held. Enforced server-side by PermissionsGuard and documented in OpenAPI.
 */
export function RequirePermissions(...permissions: Permission[]) {
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiCookieAuth('session'),
    ApiExtension('x-permissions', permissions),
    ApiOperation({ description: `Requires permission(s): ${permissions.map((p) => `\`${p}\``).join(', ')}` }),
    ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' }),
    ApiForbiddenResponse({ description: 'FORBIDDEN' }),
  );
}

/** Injects the authenticated actor (identity + role + scope + permissions). */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.actor;
});

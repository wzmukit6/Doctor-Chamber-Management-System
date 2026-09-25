import type { ReactNode } from 'react';
import type { Permission } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

/** Route-level guard: shows an access-denied page instead of the route when the permission is missing. */
export function RequirePermission({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { can, canAny } = useAuth();
  const allowed = Array.isArray(permission) ? canAny(permission) : can(permission);
  return allowed ? <>{children}</> : <ForbiddenPage />;
}

import type { ReactNode } from 'react';
import type { Permission } from '@chamber/shared';
import { useAuth } from '@/stores/auth';

/** Renders children only when the user holds the permission (UI convenience; the API enforces). */
export function Can({ permission, children, fallback = null }: { permission: Permission | Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, canAny } = useAuth();
  const allowed = Array.isArray(permission) ? canAny(permission) : can(permission);
  return <>{allowed ? children : fallback}</>;
}

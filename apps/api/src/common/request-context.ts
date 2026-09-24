import type { Request } from 'express';
import type { Permission, RoleKey } from '@chamber/shared';

/**
 * The server-resolved identity for the current request. Built from the
 * session stored in the database — never from client-supplied role or
 * permission values (spec §3).
 */
export interface Actor {
  userId: string;
  fullName: string;
  sessionId: string;
  membershipId: string;
  role: RoleKey;
  organizationId: string | null;
  chamberId: string | null;
  doctorId: string | null;
  permissions: ReadonlySet<Permission>;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthenticatedRequest extends Request {
  actor: Actor;
}

export function isSuperAdmin(actor: Actor): boolean {
  return actor.role === 'SUPER_ADMIN';
}

/** Client metadata recorded in audit events. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: (req.ip ?? null)?.slice(0, 64) ?? null,
    userAgent: (req.headers['user-agent'] ?? null)?.slice(0, 300) ?? null,
  };
}

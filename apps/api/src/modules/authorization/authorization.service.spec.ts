import { Permission, RoleKey } from '@chamber/shared';
import type { Actor } from '../../common/request-context';
import { AuthorizationService } from './authorization.service';

function actor(role: RoleKey, chamberId: string | null, permissions: Permission[] = []): Actor {
  return {
    userId: 'u1',
    fullName: 'Test',
    sessionId: 's1',
    membershipId: 'm1',
    role,
    organizationId: 'o1',
    chamberId,
    doctorId: null,
    permissions: new Set(permissions),
    ipAddress: null,
    userAgent: null,
  };
}

describe('AuthorizationService', () => {
  const service = new AuthorizationService({} as never);

  it('scopes chamber users to their own chamber and super admin to everything', () => {
    expect(service.chamberScope(actor('MANAGER', 'A'))).toEqual({ chamberId: 'A' });
    expect(service.chamberScope(actor('SUPER_ADMIN', null))).toEqual({});
    expect(() => service.chamberScope(actor('DOCTOR', null))).toThrow();
  });

  it('reports cross-chamber access as not found', () => {
    expect(() => service.assertChamberAccess(actor('DOCTOR', 'A'), 'B')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
    );
    expect(() => service.assertChamberAccess(actor('DOCTOR', 'A'), 'A')).not.toThrow();
    expect(() => service.assertChamberAccess(actor('SUPER_ADMIN', null), 'B')).not.toThrow();
  });

  it('checks permissions and role manageability', () => {
    expect(() => service.assertPermission(actor('DOCTOR', 'A', ['patients.view']), 'patients.view')).not.toThrow();
    expect(() => service.assertPermission(actor('ASSISTANT', 'A'), 'prescriptions.finalize')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => service.assertCanManageRole(actor('MANAGER', 'A'), 'MANAGER')).toThrow(
      expect.objectContaining({ code: 'ROLE_NOT_MANAGEABLE' }),
    );
  });
});

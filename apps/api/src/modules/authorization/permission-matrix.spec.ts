import {
  ALL_PERMISSIONS,
  canManageRole,
  DEFAULT_ROLE_PERMISSIONS,
  FORBIDDEN_GRANTS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_KEYS,
} from '@chamber/shared';

describe('permission matrix (spec §2, §50)', () => {
  it('every permission belongs to exactly one UI group', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('super admin holds every permission', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it.each(ROLE_KEYS)('default grants for %s never include a forbidden grant', (role) => {
    const forbidden = new Set(FORBIDDEN_GRANTS[role]);
    expect(DEFAULT_ROLE_PERMISSIONS[role].filter((p) => forbidden.has(p))).toEqual([]);
  });

  it('assistant can never modify clinical records or administer the system', () => {
    const f = FORBIDDEN_GRANTS.ASSISTANT;
    for (const p of [
      PERMISSIONS.PRESCRIPTIONS_UPDATE,
      PERMISSIONS.PRESCRIPTIONS_FINALIZE,
      PERMISSIONS.PRESCRIPTIONS_REVISE,
      PERMISSIONS.CONSULTATIONS_UPDATE,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.REPORTS_FINANCIAL,
    ]) {
      expect(f).toContain(p);
    }
  });

  it('manager does not get doctor-only clinical notes by default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).not.toContain(PERMISSIONS.CLINICAL_NOTES_VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).not.toContain(PERMISSIONS.PRESCRIPTIONS_FINALIZE);
  });

  it('doctor has no system administration functions', () => {
    for (const p of [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.USERS_CREATE, PERMISSIONS.SETTINGS_MANAGE]) {
      expect(DEFAULT_ROLE_PERMISSIONS.DOCTOR).not.toContain(p);
    }
  });

  it('role manageability prevents privilege escalation', () => {
    expect(canManageRole('SUPER_ADMIN', 'MANAGER')).toBe(true);
    expect(canManageRole('MANAGER', 'DOCTOR')).toBe(true);
    expect(canManageRole('MANAGER', 'ASSISTANT')).toBe(true);
    expect(canManageRole('MANAGER', 'MANAGER')).toBe(false);
    expect(canManageRole('MANAGER', 'SUPER_ADMIN')).toBe(false);
    expect(canManageRole('DOCTOR', 'ASSISTANT')).toBe(false);
    expect(canManageRole('ASSISTANT', 'ASSISTANT')).toBe(false);
  });
});

import { DEFAULT_ROLE_PERMISSIONS, type Permission } from '@chamber/shared';
import { visibleSections } from './navigation';

const canAnyFor = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => {
  const set = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
  return (ps: Permission[]) => ps.some((p) => set.has(p));
};
const keys = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) =>
  visibleSections(canAnyFor(role)).flatMap((s) => s.items.map((i) => i.key));

describe('navigation visibility by role (spec §28)', () => {
  it('super admin sees every item', () => {
    expect(keys('SUPER_ADMIN')).toEqual(expect.arrayContaining(['users', 'roles', 'organizations', 'audit_logs', 'settings']));
  });

  it('doctor does not see user administration', () => {
    const k = keys('DOCTOR');
    expect(k).toContain('prescriptions');
    expect(k).not.toContain('users');
    expect(k).not.toContain('roles');
    expect(k).not.toContain('organizations');
  });

  it('assistant sees front-desk items but not audit logs or users', () => {
    const k = keys('ASSISTANT');
    expect(k).toEqual(expect.arrayContaining(['patients', 'appointments', 'queue']));
    expect(k).not.toContain('audit_logs');
    expect(k).not.toContain('users');
    expect(k).not.toContain('consultations');
  });

  it('drops sections that end up empty', () => {
    const sections = visibleSections(() => false);
    expect(sections.map((s) => s.key)).toEqual([null]);
  });
});

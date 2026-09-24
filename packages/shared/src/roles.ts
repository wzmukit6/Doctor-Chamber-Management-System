/**
 * System roles. A role is always combined with permissions, a tenant scope
 * (organization / chamber) and resource ownership before an action is allowed.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  MANAGER: 'MANAGER',
  DOCTOR: 'DOCTOR',
  ASSISTANT: 'ASSISTANT',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_KEYS: RoleKey[] = Object.values(ROLES);

/** Roles that are bound to a specific chamber (everything except the platform admin). */
export const CHAMBER_SCOPED_ROLES: RoleKey[] = [ROLES.MANAGER, ROLES.DOCTOR, ROLES.ASSISTANT];

/**
 * Which roles a given role may create / manage as users.
 * Super admin manages managers (and everyone); managers manage chamber staff.
 */
export const MANAGEABLE_ROLES: Record<RoleKey, RoleKey[]> = {
  SUPER_ADMIN: [ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.DOCTOR, ROLES.ASSISTANT],
  MANAGER: [ROLES.DOCTOR, ROLES.ASSISTANT],
  DOCTOR: [],
  ASSISTANT: [],
};

export function canManageRole(actorRole: RoleKey, targetRole: RoleKey): boolean {
  return MANAGEABLE_ROLES[actorRole].includes(targetRole);
}

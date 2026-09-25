import type { MembershipSummary, RoleKey } from '@chamber/shared';

export const membershipInclude = {
  role: { select: { key: true } },
  organization: { select: { id: true, name: true } },
  chamber: { select: { id: true, name: true, code: true, timezone: true, organization: { select: { id: true, name: true } } } },
} as const;

type MembershipRow = {
  id: string;
  role: { key: string };
  organization: { id: string; name: string } | null;
  chamber: { id: string; name: string; code: string; timezone: string; organization: { id: string; name: string } } | null;
};

export function toMembershipSummary(m: MembershipRow): MembershipSummary {
  return {
    id: m.id,
    role: m.role.key as RoleKey,
    organization: m.organization ?? m.chamber?.organization ?? null,
    chamber: m.chamber ? { id: m.chamber.id, name: m.chamber.name, code: m.chamber.code, timezone: m.chamber.timezone } : null,
  };
}

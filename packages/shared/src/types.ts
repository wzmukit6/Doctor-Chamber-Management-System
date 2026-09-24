import type { Permission } from './permissions';
import type { RoleKey } from './roles';

export interface MembershipSummary {
  id: string;
  role: RoleKey;
  organization: { id: string; name: string } | null;
  chamber: { id: string; name: string; code: string } | null;
}

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  preferredLanguage: 'en' | 'bn';
  mustChangePassword: boolean;
  activeMembership: MembershipSummary;
  memberships: MembershipSummary[];
  permissions: Permission[];
  doctorId: string | null;
}

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  preferredLanguage: 'en' | 'bn';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  version: number;
  memberships: MembershipSummary[];
  doctorProfile: {
    id: string;
    qualifications: string | null;
    specialty: string | null;
    registrationNo: string | null;
    consultationFee: number | null;
    followUpFee: number | null;
    bio: string | null;
  } | null;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  version: number;
  chamberCount: number;
}

export interface ChamberDto {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  isActive: boolean;
  isDemo: boolean;
  createdAt: string;
  version: number;
  staffCount: number;
}

export interface RoleDto {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
  permissions: Permission[];
  forbidden: Permission[];
  userCount: number;
}

export interface AuditLogDto {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  chamberId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

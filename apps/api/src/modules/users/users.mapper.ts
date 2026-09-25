import { Prisma } from '@prisma/client';
import type { UserDto } from '@chamber/shared';
import { membershipInclude, toMembershipSummary } from '../auth/membership.mapper';

export const userInclude = {
  memberships: { include: membershipInclude, orderBy: { createdAt: 'asc' } },
  doctorProfiles: true,
} satisfies Prisma.UserInclude;

export type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/**
 * Maps a user to its API shape. For chamber-scoped viewers, memberships and
 * doctor profiles from other chambers are hidden to prevent cross-tenant leakage.
 */
export function toUserDto(user: UserWithRelations, visibleChamberId: string | null): UserDto {
  const memberships = user.memberships.filter((m) => visibleChamberId === null || m.chamberId === visibleChamberId);
  const doctor =
    user.doctorProfiles.find((d) => (visibleChamberId === null ? true : d.chamberId === visibleChamberId)) ?? null;
  const scopedMembershipActive = visibleChamberId === null ? true : memberships.every((m) => m.isActive);
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive && scopedMembershipActive,
    preferredLanguage: user.preferredLanguage === 'bn' ? 'bn' : 'en',
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    version: user.version,
    memberships: memberships.map(toMembershipSummary),
    doctorProfile: doctor
      ? {
          id: doctor.id,
          qualifications: doctor.qualifications,
          specialty: doctor.specialty,
          registrationNo: doctor.registrationNo,
          consultationFee: doctor.consultationFee ? Number(doctor.consultationFee) : null,
          followUpFee: doctor.followUpFee ? Number(doctor.followUpFee) : null,
          bio: doctor.bio,
        }
      : null,
  };
}

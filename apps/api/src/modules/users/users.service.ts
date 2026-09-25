import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdminResetPasswordInput,
  CreateUserInput,
  DoctorProfileInput,
  ERROR_CODES,
  PaginationQuery,
  RoleKey,
  ROLES,
  SetUserStatusInput,
  UpdateUserInput,
  UserDto,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { pageArgs, pageMeta, safeSort } from '../../common/utils/pagination';
import { PageResult } from '../../common/interceptors/response.interceptor';
import { diff } from '../../common/utils/sanitize';
import { toUserDto, userInclude, UserWithRelations } from './users.mapper';

export type UserListQuery = PaginationQuery & {
  role?: string;
  chamberId?: string;
  status: 'active' | 'inactive' | 'all';
};

const SORTABLE = ['createdAt', 'fullName', 'email', 'lastLoginAt'] as const;

/**
 * User management (spec §2, §22). Every method re-validates role
 * manageability and tenant scope server-side; managers only ever see and
 * affect the memberships of their own chamber.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  private visibleChamber(actor: Actor): string | null {
    return isSuperAdmin(actor) ? null : actor.chamberId;
  }

  async list(actor: Actor, query: UserListQuery): Promise<PageResult<UserDto>> {
    const scopeChamber = isSuperAdmin(actor) ? (query.chamberId ?? null) : actor.chamberId;
    if (!isSuperAdmin(actor) && !scopeChamber) throw AppError.forbidden();

    const membershipFilter: Prisma.UserRoleWhereInput = {
      ...(scopeChamber ? { chamberId: scopeChamber } : {}),
      ...(query.role ? { role: { key: query.role } } : {}),
      ...(!isSuperAdmin(actor) && query.status === 'active' ? { isActive: true } : {}),
    };
    const statusFilter: Prisma.UserWhereInput =
      query.status === 'active'
        ? { isActive: true }
        : query.status === 'inactive'
          ? isSuperAdmin(actor)
            ? { isActive: false }
            : { OR: [{ isActive: false }, { memberships: { some: { chamberId: scopeChamber, isActive: false } } }] }
          : {};

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(Object.keys(membershipFilter).length ? { memberships: { some: membershipFilter } } : {}),
      ...statusFilter,
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  { fullName: { contains: query.q, mode: 'insensitive' } },
                  { email: { contains: query.q, mode: 'insensitive' } },
                  { phone: { contains: query.q } },
                ],
              },
            ],
          }
        : {}),
    };
    const sort = safeSort(query.sort, SORTABLE, 'createdAt');
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: { [sort]: query.order },
        ...pageArgs(query),
      }),
    ]);
    return new PageResult(
      users.map((u) => toUserDto(u, this.visibleChamber(actor))),
      pageMeta(query, total),
    );
  }

  async get(actor: Actor, id: string): Promise<UserDto> {
    const { user } = await this.loadTarget(actor, id);
    return toUserDto(user, this.visibleChamber(actor));
  }

  async create(actor: Actor, input: CreateUserInput): Promise<UserDto> {
    const role = input.role as RoleKey;
    this.authz.assertCanManageRole(actor, role);
    await this.passwords.assertStrong(input.password);

    let chamberId: string | null = null;
    let organizationId: string | null = null;
    if (role !== ROLES.SUPER_ADMIN) {
      chamberId = isSuperAdmin(actor) ? (input.chamberId ?? null) : actor.chamberId;
      if (!isSuperAdmin(actor) && input.chamberId && input.chamberId !== actor.chamberId) throw AppError.crossTenant();
      if (!chamberId) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A chamber is required for this role', 422, [
          { path: 'chamberId', message: 'validation.required' },
        ]);
      }
      const chamber = await this.prisma.chamber.findFirst({ where: { id: chamberId, deletedAt: null } });
      if (!chamber) throw AppError.notFound('Chamber');
      if (!chamber.isActive) throw new AppError(ERROR_CODES.CONFLICT, 'Chamber is inactive', HttpStatus.CONFLICT);
      organizationId = chamber.organizationId;
    }

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'An account with this email already exists', HttpStatus.CONFLICT, [
        { path: 'email', message: 'validation.email_taken' },
      ]);
    }

    const passwordHash = await this.passwords.hash(input.password);
    const roleRow = await this.prisma.role.findUniqueOrThrow({ where: { key: role } });

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          passwordHash,
          preferredLanguage: input.preferredLanguage,
          mustChangePassword: true,
        },
      });
      await tx.userRole.create({
        data: { userId: user.id, roleId: roleRow.id, chamberId, organizationId, createdById: actor.userId },
      });
      if (role === ROLES.DOCTOR && chamberId) {
        await tx.doctor.create({ data: { userId: user.id, chamberId, ...doctorData(input.doctorProfile) } });
      }
      await this.audit.record(
        actor,
        {
          action: 'user.created',
          resourceType: 'user',
          resourceId: user.id,
          newValue: { fullName: user.fullName, email: user.email, phone: user.phone, role, chamberId },
          chamberId,
          organizationId,
        },
        tx,
      );
      return user.id;
    });
    return this.get(actor, userId);
  }

  async update(actor: Actor, id: string, input: UpdateUserInput): Promise<UserDto> {
    const { user, targetRole, scopedChamberId } = await this.loadTarget(actor, id);
    this.authz.assertCanManageRole(actor, targetRole);

    const data: Prisma.UserUpdateManyMutationInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phone !== undefined) data.phone = input.phone ?? null;
    if (input.preferredLanguage !== undefined) data.preferredLanguage = input.preferredLanguage;

    const doctor = input.doctorProfile
      ? user.doctorProfiles.find((d) => d.chamberId === scopedChamberId)
      : undefined;
    if (input.doctorProfile && !doctor) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'This user has no doctor profile in this chamber', 422);
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id, version: input.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw AppError.staleVersion();

      let doctorDiff: ReturnType<typeof diff> | null = null;
      if (doctor && input.doctorProfile) {
        const after = await tx.doctor.update({
          where: { id: doctor.id },
          data: { ...doctorData(input.doctorProfile), version: { increment: 1 } },
        });
        doctorDiff = diff(doctor, after);
      }
      const after = await tx.user.findUniqueOrThrow({ where: { id } });
      const userDiff = diff(user as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
      await this.audit.record(
        actor,
        {
          action: 'user.updated',
          resourceType: 'user',
          resourceId: id,
          oldValue: { ...userDiff.oldValue, ...(doctorDiff ? { doctorProfile: doctorDiff.oldValue } : {}) },
          newValue: { ...userDiff.newValue, ...(doctorDiff ? { doctorProfile: doctorDiff.newValue } : {}) },
          chamberId: scopedChamberId,
        },
        tx,
      );
    });
    return this.get(actor, id);
  }

  async setStatus(actor: Actor, id: string, input: SetUserStatusInput): Promise<UserDto> {
    if (id === actor.userId) {
      throw new AppError(ERROR_CODES.CANNOT_MODIFY_SELF, 'You cannot change the status of your own account', 403);
    }
    const { user, targetRole, scopedChamberId, scopedMembershipId } = await this.loadTarget(actor, id);
    this.authz.assertCanManageRole(actor, targetRole);

    await this.prisma.$transaction(async (tx) => {
      if (isSuperAdmin(actor)) {
        await tx.user.update({ where: { id }, data: { isActive: input.isActive, version: { increment: 1 } } });
      } else {
        // Managers only toggle access to their own chamber, never the global identity.
        await tx.userRole.update({ where: { id: scopedMembershipId! }, data: { isActive: input.isActive } });
      }
      await this.audit.record(
        actor,
        {
          action: input.isActive ? 'user.activated' : 'user.deactivated',
          resourceType: 'user',
          resourceId: id,
          oldValue: { isActive: !input.isActive },
          newValue: { isActive: input.isActive, scope: isSuperAdmin(actor) ? 'platform' : 'chamber' },
          reason: input.reason,
          chamberId: scopedChamberId,
        },
        tx,
      );
    });
    if (!input.isActive) {
      if (isSuperAdmin(actor)) await this.sessions.revokeAllForUser(user.id, 'deactivated');
      else await this.sessions.revokeAllForMembership(scopedMembershipId!, 'deactivated');
    }
    return this.get(actor, id);
  }

  async resetPassword(actor: Actor, id: string, input: AdminResetPasswordInput): Promise<void> {
    if (id === actor.userId) {
      throw new AppError(ERROR_CODES.CANNOT_MODIFY_SELF, 'Use "Change password" for your own account', 403);
    }
    const { user, targetRole, scopedChamberId } = await this.loadTarget(actor, id);
    this.authz.assertCanManageRole(actor, targetRole);
    this.assertIdentityWithinScope(actor, user);
    await this.passwords.assertStrong(input.newPassword);
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        actor,
        { action: 'user.password_reset', resourceType: 'user', resourceId: id, reason: input.reason, chamberId: scopedChamberId },
        tx,
      );
    });
    await this.sessions.revokeAllForUser(id, 'password_reset_by_admin');
  }

  async unlock(actor: Actor, id: string): Promise<UserDto> {
    const { targetRole, scopedChamberId } = await this.loadTarget(actor, id);
    this.authz.assertCanManageRole(actor, targetRole);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
      await this.audit.record(actor, { action: 'user.unlocked', resourceType: 'user', resourceId: id, chamberId: scopedChamberId }, tx);
    });
    return this.get(actor, id);
  }

  /** Soft delete (spec §25). Managers remove chamber access; only a super admin retires a global identity. */
  async remove(actor: Actor, id: string, reason: string): Promise<void> {
    if (id === actor.userId) {
      throw new AppError(ERROR_CODES.CANNOT_MODIFY_SELF, 'You cannot delete your own account', 403);
    }
    const { user, targetRole, scopedChamberId, scopedMembershipId } = await this.loadTarget(actor, id);
    this.authz.assertCanManageRole(actor, targetRole);
    const globalDelete = isSuperAdmin(actor) || user.memberships.every((m) => m.chamberId === actor.chamberId);

    await this.prisma.$transaction(async (tx) => {
      if (globalDelete) {
        await tx.user.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedById: actor.userId,
            deletionReason: reason,
            isActive: false,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.userRole.update({ where: { id: scopedMembershipId! }, data: { isActive: false } });
      }
      await this.audit.record(
        actor,
        {
          action: globalDelete ? 'user.deleted' : 'user.membership_removed',
          resourceType: 'user',
          resourceId: id,
          oldValue: { fullName: user.fullName, email: user.email },
          reason,
          chamberId: scopedChamberId,
        },
        tx,
      );
    });
    await this.sessions.revokeAllForUser(id, 'deleted');
  }

  /**
   * Loads a user and resolves the membership relevant to the actor. For
   * chamber-scoped actors, users outside the chamber are reported as not found.
   */
  private async loadTarget(actor: Actor, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
    if (!user) throw AppError.notFound('User');

    if (isSuperAdmin(actor)) {
      const platform = user.memberships.find((m) => m.chamberId === null);
      const first = platform ?? user.memberships[0];
      return {
        user,
        targetRole: (first?.role.key ?? ROLES.ASSISTANT) as RoleKey,
        scopedChamberId: first?.chamberId ?? null,
        scopedMembershipId: first?.id ?? null,
      };
    }

    const scoped = user.memberships.find((m) => m.chamberId === actor.chamberId);
    if (!scoped) throw AppError.crossTenant();
    return {
      user,
      targetRole: scoped.role.key as RoleKey,
      scopedChamberId: scoped.chamberId,
      scopedMembershipId: scoped.id,
    };
  }

  /** Changing a global credential requires authority over every chamber the user belongs to. */
  private assertIdentityWithinScope(actor: Actor, user: UserWithRelations) {
    if (isSuperAdmin(actor)) return;
    if (user.memberships.some((m) => m.chamberId !== actor.chamberId)) {
      throw AppError.forbidden('This user belongs to other chambers; ask a super admin to reset the password');
    }
  }
}

function doctorData(profile: DoctorProfileInput | undefined) {
  if (!profile) return {};
  return {
    qualifications: profile.qualifications ?? null,
    specialty: profile.specialty ?? null,
    registrationNo: profile.registrationNo ?? null,
    consultationFee: profile.consultationFee ?? null,
    followUpFee: profile.followUpFee ?? null,
    bio: profile.bio ?? null,
  };
}

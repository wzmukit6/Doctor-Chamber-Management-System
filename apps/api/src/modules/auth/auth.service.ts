import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ChangePasswordInput,
  CurrentUser,
  ERROR_CODES,
  ForgotPasswordInput,
  LoginInput,
  Permission,
  ResetPasswordInput,
  UpdateProfileInput,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor, RequestMeta } from '../../common/request-context';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { diff } from '../../common/utils/sanitize';
import { loadConfig } from '../../config/config';
import { SecuritySettingsService } from '../settings/security-settings.service';
import { PasswordService } from './password.service';
import { IssuedSession, SessionService } from './session.service';
import { membershipInclude, toMembershipSummary } from './membership.mapper';

const activeMembershipWhere = {
  isActive: true,
  OR: [
    { chamberId: null },
    {
      chamber: {
        isActive: true,
        deletedAt: null,
        organization: { isActive: true, deletedAt: null },
      },
    },
  ],
};

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly security: SecuritySettingsService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });
    const invalid = new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password', HttpStatus.UNAUTHORIZED);

    if (!user) {
      await this.passwords.verifyAgainstDummy(input.password);
      await this.audit.recordAnonymous(
        { userId: null, userName: null, role: null, meta },
        { action: 'auth.login_failed', resourceType: 'user', newValue: { email: input.email, reason: 'unknown_user' } },
      );
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.recordAnonymous(
        { userId: user.id, userName: user.fullName, role: null, meta },
        { action: 'auth.login_blocked', resourceType: 'user', resourceId: user.id, newValue: { reason: 'locked' } },
      );
      throw new AppError(
        ERROR_CODES.ACCOUNT_LOCKED,
        'Account temporarily locked due to repeated failed sign-in attempts. Try again later or contact your administrator.',
        HttpStatus.LOCKED,
      );
    }

    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      const failed = user.failedLoginCount + 1;
      const policy = await this.security.current();
      const lock = failed >= policy.loginMaxFailedAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + policy.loginLockoutMinutes * 60_000) }
          : { failedLoginCount: failed },
      });
      await this.audit.recordAnonymous(
        { userId: user.id, userName: user.fullName, role: null, meta },
        {
          action: lock ? 'auth.account_locked' : 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          newValue: { reason: 'bad_password', failedAttempts: failed },
        },
      );
      throw invalid;
    }

    if (!user.isActive) {
      throw new AppError(ERROR_CODES.ACCOUNT_INACTIVE, 'This account has been deactivated', HttpStatus.FORBIDDEN);
    }

    const memberships = await this.prisma.userRole.findMany({
      where: { userId: user.id, ...activeMembershipWhere },
      orderBy: { createdAt: 'asc' },
      include: { role: { select: { key: true } } },
    });
    if (memberships.length === 0) {
      throw new AppError(ERROR_CODES.ACCOUNT_INACTIVE, 'This account has no active chamber access', HttpStatus.FORBIDDEN);
    }
    const membership = memberships.find((m) => m.role.key === 'SUPER_ADMIN') ?? memberships[0];

    // A fresh token on every login prevents session fixation.
    const session = await this.sessions.create(user.id, membership.id, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.recordAnonymous(
      { userId: user.id, userName: user.fullName, role: membership.role.key, meta },
      {
        action: 'auth.login',
        resourceType: 'session',
        resourceId: session.sessionId,
        chamberId: membership.chamberId,
        organizationId: membership.organizationId,
      },
    );
    return session;
  }

  async logout(actor: Actor) {
    await this.sessions.revoke(actor.sessionId, 'logout');
    await this.audit.record(actor, { action: 'auth.logout', resourceType: 'session', resourceId: actor.sessionId });
  }

  async currentUser(actor: Actor): Promise<CurrentUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: {
        memberships: { where: activeMembershipWhere, include: membershipInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    const memberships = user.memberships.map(toMembershipSummary);
    const active = memberships.find((m) => m.id === actor.membershipId);
    if (!active) throw AppError.unauthenticated();
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      preferredLanguage: user.preferredLanguage === 'bn' ? 'bn' : 'en',
      mustChangePassword: user.mustChangePassword,
      activeMembership: active,
      memberships,
      permissions: [...actor.permissions].sort() as Permission[],
      doctorId: actor.doctorId,
    };
  }

  /** Switches the active chamber by rotating to a new session bound to another membership. */
  async switchMembership(actor: Actor, membershipId: string, meta: RequestMeta): Promise<IssuedSession> {
    const membership = await this.prisma.userRole.findFirst({
      where: { id: membershipId, userId: actor.userId, ...activeMembershipWhere },
    });
    if (!membership) throw AppError.notFound('Membership');
    const session = await this.sessions.create(actor.userId, membership.id, meta);
    await this.sessions.revoke(actor.sessionId, 'switched_chamber');
    await this.audit.record(actor, {
      action: 'auth.switch_chamber',
      resourceType: 'session',
      resourceId: session.sessionId,
      newValue: { membershipId, chamberId: membership.chamberId },
    });
    return session;
  }

  async changePassword(actor: Actor, input: ChangePasswordInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Current password is incorrect', HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'currentPassword', message: 'validation.password.incorrect' },
      ]);
    }
    await this.passwords.assertStrong(input.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(input.newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        version: { increment: 1 },
      },
    });
    // Sign out every other device.
    await this.sessions.revokeAllForUser(user.id, 'password_changed', actor.sessionId);
    await this.audit.record(actor, { action: 'auth.password_changed', resourceType: 'user', resourceId: user.id });
  }

  /** Always succeeds from the caller's perspective to avoid account enumeration. */
  async forgotPassword(input: ForgotPasswordInput, meta: RequestMeta) {
    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null, isActive: true } });
    if (!user) return;

    // Invalidate older outstanding tokens.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.config.PASSWORD_RESET_MINUTES * 60_000),
        requestIp: meta.ipAddress,
      },
    });
    const link = `${this.config.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.notifications.send({
      type: 'PASSWORD_RESET',
      channel: 'email',
      to: user.email,
      subject: 'Reset your Chamber Assistant password',
      body: `Hello ${user.fullName},\n\nUse the link below to reset your password. It expires in ${this.config.PASSWORD_RESET_MINUTES} minutes.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
      data: { link },
    });
    await this.audit.recordAnonymous(
      { userId: user.id, userName: user.fullName, role: null, meta },
      { action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id },
    );
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date() || !record.user.isActive || record.user.deletedAt) {
      throw new AppError(ERROR_CODES.INVALID_TOKEN, 'This reset link is invalid or has expired', HttpStatus.BAD_REQUEST);
    }
    await this.passwords.assertStrong(input.newPassword);
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Conditional update guards against the same token being used twice concurrently.
      const used = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw new AppError(ERROR_CODES.INVALID_TOKEN, 'This reset link has already been used', 400);
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          version: { increment: 1 },
        },
      });
      await this.audit.recordAnonymous(
        { userId: record.userId, userName: record.user.fullName, role: null, meta },
        { action: 'auth.password_reset', resourceType: 'user', resourceId: record.userId },
        tx,
      );
    });
    await this.sessions.revokeAllForUser(record.userId, 'password_reset');
  }

  /** Self-service profile update (no permission needed; only non-privileged fields). */
  async updateProfile(actor: Actor, input: UpdateProfileInput): Promise<CurrentUser> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const after = await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.preferredLanguage !== undefined ? { preferredLanguage: input.preferredLanguage } : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.record(actor, {
      action: 'user.profile_updated',
      resourceType: 'user',
      resourceId: actor.userId,
      ...diff(before, after),
    });
    return this.currentUser(actor);
  }

  async listSessions(actor: Actor) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === actor.sessionId }));
  }

  async revokeSession(actor: Actor, sessionId: string) {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId: actor.userId } });
    if (!session) throw AppError.notFound('Session');
    await this.sessions.revoke(session.id, 'revoked_by_user');
    await this.audit.record(actor, { action: 'auth.session_revoked', resourceType: 'session', resourceId: session.id });
  }
}

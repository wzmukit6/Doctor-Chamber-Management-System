import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Permission, RoleKey } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { SecuritySettingsService } from '../settings/security-settings.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor, RequestMeta } from '../../common/request-context';
import { generateToken, safeEqualHex, sha256 } from '../../common/utils/crypto';
import { CSRF_COOKIE, loadConfig, SESSION_COOKIE } from '../../config/config';

/** Only refresh `last_seen_at` / idle expiry at most once a minute to limit writes. */
const TOUCH_INTERVAL_MS = 60_000;

export interface IssuedSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Server-side opaque sessions. The browser holds a random token in an
 * HttpOnly cookie; the database stores only its SHA-256 hash, so sessions
 * can be revoked instantly (logout, password change, deactivation).
 */
@Injectable()
export class SessionService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly security: SecuritySettingsService,
  ) {}

  async create(userId: string, membershipId: string, meta: RequestMeta): Promise<IssuedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const now = Date.now();
    const policy = await this.security.current();
    const expiresAt = new Date(now + policy.sessionAbsoluteHours * 3_600_000);
    const session = await this.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        csrfHash: sha256(csrfToken),
        userId,
        membershipId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        idleExpiresAt: new Date(Math.min(now + policy.sessionIdleMinutes * 60_000, expiresAt.getTime())),
        expiresAt,
      },
    });
    return { sessionId: session.id, token, csrfToken, expiresAt };
  }

  /** Resolves a session token into an Actor, or throws UNAUTHENTICATED / SESSION_EXPIRED. */
  async resolve(token: string, meta: RequestMeta): Promise<{ actor: Actor; csrfHash: string }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: { select: { id: true, fullName: true, isActive: true, deletedAt: true } },
        membership: {
          include: {
            role: { select: { id: true, key: true } },
            chamber: { select: { id: true, isActive: true, deletedAt: true, organizationId: true } },
            organization: { select: { id: true, isActive: true, deletedAt: true } },
          },
        },
      },
    });
    if (!session || session.revokedAt) throw AppError.unauthenticated();

    const now = new Date();
    if (session.expiresAt <= now || session.idleExpiresAt <= now) {
      await this.revoke(session.id, 'expired');
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
    }

    const { user, membership } = session;
    const chamberOk = !membership.chamber || (membership.chamber.isActive && !membership.chamber.deletedAt);
    const orgOk = !membership.organization || (membership.organization.isActive && !membership.organization.deletedAt);
    if (!user.isActive || user.deletedAt || !membership.isActive || !chamberOk || !orgOk) {
      await this.revoke(session.id, 'access_revoked');
      throw AppError.unauthenticated('Your account access has been revoked');
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idleMinutes = (await this.security.current()).sessionIdleMinutes;
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          idleExpiresAt: new Date(
            Math.min(now.getTime() + idleMinutes * 60_000, session.expiresAt.getTime()),
          ),
        },
      });
    }

    const permissions = await this.authz.permissionsForRole(membership.role.id);
    const doctor = membership.chamberId
      ? await this.prisma.doctor.findUnique({
          where: { userId_chamberId: { userId: user.id, chamberId: membership.chamberId } },
          select: { id: true, isActive: true },
        })
      : null;

    const actor: Actor = {
      userId: user.id,
      fullName: user.fullName,
      sessionId: session.id,
      membershipId: membership.id,
      role: membership.role.key as RoleKey,
      organizationId: membership.organizationId ?? membership.chamber?.organizationId ?? null,
      chamberId: membership.chamberId,
      doctorId: doctor?.isActive ? doctor.id : null,
      permissions: permissions as ReadonlySet<Permission>,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    };
    return { actor, csrfHash: session.csrfHash };
  }

  verifyCsrf(csrfHash: string, headerValue: string | undefined): boolean {
    if (!headerValue || headerValue.length > 200) return false;
    return safeEqualHex(csrfHash, sha256(headerValue));
  }

  async revoke(sessionId: string, reason: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForMembership(membershipId: string, reason: string) {
    await this.prisma.session.updateMany({
      where: { membershipId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  setCookies(res: Response, session: IssuedSession) {
    const common = {
      secure: this.config.COOKIE_SECURE,
      // Strict: the SPA and API are same-site; cookies are never needed on cross-site navigations.
      sameSite: 'strict' as const,
      expires: session.expiresAt,
    };
    res.cookie(SESSION_COOKIE, session.token, { ...common, httpOnly: true, path: '/api' });
    // Readable by the SPA so it can echo it back in the X-CSRF-Token header (double submit).
    res.cookie(CSRF_COOKIE, session.csrfToken, { ...common, httpOnly: false, path: '/' });
  }

  clearCookies(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/api' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}

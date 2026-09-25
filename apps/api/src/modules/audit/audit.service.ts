import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { logEvent } from '../../common/observability/log-event';
import type { Actor, RequestMeta } from '../../common/request-context';
import { sanitizeForAudit } from '../../common/utils/sanitize';

type Tx = Prisma.TransactionClient;

export interface AuditEvent {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  /** Overrides the actor's tenant scope (e.g. super admin acting on chamber X). */
  chamberId?: string | null;
  organizationId?: string | null;
}

/** Identity for events without an authenticated actor (failed logins, password resets). */
export interface AnonymousActor {
  userId: string | null;
  userName: string | null;
  role: string | null;
  meta: RequestMeta;
}

/** Advisory-lock key serializing hash-chain appends. */
const AUDIT_CHAIN_LOCK = 734_921_001;

/** Audit actions that are also emitted to the application log for security monitoring (spec §64). */
const SECURITY_EVENTS = new Set([
  'auth.login_failed',
  'auth.login_blocked',
  'auth.account_locked',
  'auth.password_reset_requested',
  'auth.password_reset',
  'auth.password_changed',
  'auth.session_revoked',
  'role.permissions_updated',
  'settings.security_updated',
  'user.deactivated',
  'user.password_reset',
  'user.unlocked',
  'user.deleted',
  'report.exported',
  'audit.chain_verified',
]);

/**
 * Append-only, hash-chained audit trail (spec §20). Each record stores the
 * hash of the previous record; any tampering with historic rows breaks the
 * chain, which `verifyChain` detects. UPDATE/DELETE are also blocked by a DB trigger.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Security');

  constructor(private readonly prisma: PrismaService) {}

  /** Record an event performed by an authenticated actor. Pass `tx` to make the audit part of the business transaction. */
  async record(actor: Actor, event: AuditEvent, tx?: Tx): Promise<void> {
    await this.write(
      {
        userId: actor.userId,
        userName: actor.fullName,
        role: actor.role,
        sessionId: actor.sessionId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        chamberId: event.chamberId !== undefined ? event.chamberId : actor.chamberId,
        organizationId: event.organizationId !== undefined ? event.organizationId : actor.organizationId,
      },
      event,
      tx,
    );
  }

  async recordAnonymous(who: AnonymousActor, event: AuditEvent, tx?: Tx): Promise<void> {
    await this.write(
      {
        userId: who.userId,
        userName: who.userName,
        role: who.role,
        sessionId: null,
        ipAddress: who.meta.ipAddress,
        userAgent: who.meta.userAgent,
        chamberId: event.chamberId ?? null,
        organizationId: event.organizationId ?? null,
      },
      event,
      tx,
    );
  }

  private async write(
    who: {
      userId: string | null;
      userName: string | null;
      role: string | null;
      sessionId: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      chamberId: string | null;
      organizationId: string | null;
    },
    event: AuditEvent,
    tx?: Tx,
  ): Promise<void> {
    if (SECURITY_EVENTS.has(event.action) && process.env.NODE_ENV !== 'test') {
      // Identifiers only — no names, emails or clinical values.
      logEvent(this.logger, 'warn', { event: `security.${event.action}`, userId: who.userId, role: who.role, chamberId: who.chamberId, resourceType: event.resourceType, resourceId: event.resourceId ?? null, ip: who.ipAddress });
    }
    const run = async (client: Tx) => {
      await client.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
      const last = await client.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const createdAt = new Date();
      const data = {
        organizationId: who.organizationId,
        chamberId: who.chamberId,
        userId: who.userId,
        userName: who.userName,
        role: who.role,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        oldValue: toJson(event.oldValue),
        newValue: toJson(event.newValue),
        reason: event.reason ?? null,
        ipAddress: who.ipAddress,
        userAgent: who.userAgent,
        sessionId: who.sessionId,
        prevHash: last?.hash ?? null,
        createdAt,
      };
      await client.auditLog.create({ data: { ...data, hash: hashRecord(data) } });
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }

  /** Walks the chain and reports the first broken link, if any. */
  async verifyChain(): Promise<{ valid: boolean; checked: number; brokenAtSeq: string | null }> {
    let prevHash: string | null = null;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const rows: Awaited<ReturnType<typeof this.prisma.auditLog.findMany>> = await this.prisma.auditLog.findMany({
        orderBy: { seq: 'asc' },
        take: 500,
        ...(cursor !== undefined ? { where: { seq: { gt: cursor } } } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const { id: _id, seq, hash, ...rest } = row;
        const expected = hashRecord({
          ...rest,
          oldValue: rest.oldValue ?? Prisma.DbNull,
          newValue: rest.newValue ?? Prisma.DbNull,
        });
        if (row.prevHash !== prevHash || hash !== expected) {
          return { valid: false, checked, brokenAtSeq: seq.toString() };
        }
        prevHash = hash;
        checked++;
        cursor = seq;
      }
    }
    return { valid: true, checked, brokenAtSeq: null };
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return sanitizeForAudit(value) as Prisma.InputJsonValue;
}

function hashRecord(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    [
      data.prevHash ?? null,
      data.organizationId ?? null,
      data.chamberId ?? null,
      data.userId ?? null,
      data.role ?? null,
      data.action,
      data.resourceType,
      data.resourceId ?? null,
      normalizeJson(data.oldValue),
      normalizeJson(data.newValue),
      data.reason ?? null,
      (data.createdAt as Date).toISOString(),
    ],
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/** Stable JSON representation (sorted keys) so re-hashing values read back from JSONB matches. */
function normalizeJson(value: unknown): unknown {
  if (value === Prisma.DbNull || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, normalizeJson((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

import { SettingScope } from '@prisma/client';
import type { ZodType } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';

/**
 * A versioned JSON settings document (one row in `settings`) with defaults,
 * optimistic locking and audited updates. Chamber- or platform-scoped.
 */
export abstract class SettingsStore<T extends object> {
  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
    private readonly key: string,
    private readonly scope: SettingScope,
    private readonly schema: ZodType<T>,
    private readonly defaults: T,
  ) {}

  private where(scopeId: string | null) {
    return { scope: this.scope, scopeId, key: this.key };
  }

  async get(scopeId: string | null): Promise<T & { version: number }> {
    const row = await this.prisma.setting.findFirst({ where: this.where(scopeId) });
    if (!row) return { ...this.defaults, version: 0 };
    const parsed = this.schema.safeParse({ ...this.defaults, ...(row.value as object) });
    return { ...(parsed.success ? parsed.data : this.defaults), version: row.version };
  }

  async update(actor: Actor, scopeId: string | null, input: T & { version: number }, auditValue?: (v: T) => unknown): Promise<T & { version: number }> {
    const { version, ...value } = input;
    const before = await this.get(scopeId);
    await this.prisma.$transaction(async (tx) => {
      if (before.version === 0) {
        if (version !== 0) throw AppError.staleVersion();
        await tx.setting.create({ data: { ...this.where(scopeId), value: value as object, updatedById: actor.userId } });
      } else {
        const res = await tx.setting.updateMany({
          where: { ...this.where(scopeId), version },
          data: { value: value as object, version: { increment: 1 }, updatedById: actor.userId },
        });
        if (res.count !== 1) throw AppError.staleVersion();
      }
      const { version: _v, ...old } = before;
      const show = auditValue ?? ((v: T) => v);
      await this.audit.record(
        actor,
        {
          action: `settings.${this.key}_updated`,
          resourceType: 'settings',
          resourceId: `${scopeId ?? 'platform'}:${this.key}`,
          oldValue: show(old as unknown as T),
          newValue: show(value as unknown as T),
          ...(this.scope === 'CHAMBER' ? { chamberId: scopeId } : {}),
        },
        tx,
      );
    });
    this.onChange();
    return this.get(scopeId);
  }

  protected onChange(): void {}
}

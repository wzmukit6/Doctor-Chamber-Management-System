import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, PERMISSIONS, VitalDefinitionDto, VitalDefinitionInput } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';

type Row = Prisma.VitalDefinitionGetPayload<object>;

export function toVitalDefinitionDto(r: Row): VitalDefinitionDto {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    unit: r.unit,
    type: r.type,
    minValue: r.minValue !== null ? Number(r.minValue) : null,
    maxValue: r.maxValue !== null ? Number(r.maxValue) : null,
    decimals: r.decimals,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    isGlobal: r.chamberId === null,
  };
}

/**
 * Configurable examination fields (spec §9). Global defaults (BP, pulse,
 * temperature, weight, height, SpO2, respiratory rate…) plus chamber-specific
 * fields. A chamber field with the same key overrides the global one.
 */
@Injectable()
export class VitalDefinitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, includeInactive = false): Promise<VitalDefinitionDto[]> {
    const rows = await this.prisma.vitalDefinition.findMany({
      where: {
        OR: [{ chamberId: null }, ...(actor.chamberId ? [{ chamberId: actor.chamberId }] : [])],
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    const byKey = new Map<string, Row>();
    for (const r of rows) {
      const existing = byKey.get(r.key);
      if (!existing || (existing.chamberId === null && r.chamberId !== null)) byKey.set(r.key, r);
    }
    return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder).map(toVitalDefinitionDto);
  }

  async create(actor: Actor, input: VitalDefinitionInput & { global?: boolean }): Promise<VitalDefinitionDto> {
    const global = !!input.global || !actor.chamberId;
    if (global && !actor.permissions.has(PERMISSIONS.SYSTEM_MANAGE)) throw AppError.forbidden();
    const { global: _g, ...data } = input;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vitalDefinition.create({ data: { ...data, chamberId: global ? null : actor.chamberId } });
        await this.audit.record(actor, { action: 'vital_definition.created', resourceType: 'vital_definition', resourceId: created.id, newValue: data }, tx);
        return created;
      });
      return toVitalDefinitionDto(row);
    } catch (err) {
      if (/scope_key_unique|P2002/.test((err as Error).message)) {
        throw new AppError(ERROR_CODES.DUPLICATE, 'A field with this key already exists', HttpStatus.CONFLICT, [{ path: 'key', message: 'validation.duplicate_item' }]);
      }
      throw err;
    }
  }

  async update(actor: Actor, id: string, input: Partial<VitalDefinitionInput> & { isActive?: boolean }): Promise<VitalDefinitionDto> {
    const row = await this.prisma.vitalDefinition.findUnique({ where: { id } });
    if (!row) throw AppError.notFound();
    if (row.chamberId === null ? !actor.permissions.has(PERMISSIONS.SYSTEM_MANAGE) : !isSuperAdmin(actor) && row.chamberId !== actor.chamberId) {
      throw row.chamberId === null ? AppError.forbidden('Only a platform administrator can change global fields') : AppError.crossTenant();
    }
    const { key: _key, ...data } = input; // the key is immutable: recorded values refer to it
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.vitalDefinition.update({ where: { id }, data });
      await this.audit.record(actor, { action: 'vital_definition.updated', resourceType: 'vital_definition', resourceId: id, oldValue: toVitalDefinitionDto(row), newValue: data }, tx);
      return u;
    });
    return toVitalDefinitionDto(updated);
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, FeeItemDto, FeeItemInput, toCents } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { Actor } from '../../common/request-context';
import { dec, toFeeItemDto } from './billing.mapper';

/** Chamber fee schedule: investigation, procedure and other charges used when billing. */
@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private chamber(actor: Actor): string {
    if (!actor.chamberId) throw AppError.forbidden('Fees are managed inside a chamber');
    return actor.chamberId;
  }

  async list(actor: Actor, includeInactive = false): Promise<FeeItemDto[]> {
    const rows = await this.prisma.feeItem.findMany({
      where: { chamberId: this.chamber(actor), ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toFeeItemDto);
  }

  async create(actor: Actor, input: FeeItemInput): Promise<FeeItemDto> {
    const chamberId = this.chamber(actor);
    await this.assertInvestigation(input.investigationId);
    const row = await this.prisma
      .$transaction(async (tx) => {
        const f = await tx.feeItem.create({
          data: { chamberId, kind: input.kind, name: input.name, amount: dec(toCents(input.amount)), investigationId: input.investigationId ?? null, createdById: actor.userId },
        });
        await this.audit.record(actor, { action: 'fee_item.created', resourceType: 'fee_item', resourceId: f.id, newValue: input }, tx);
        return f;
      })
      .catch(FeesService.duplicateGuard);
    return toFeeItemDto(row);
  }

  async update(actor: Actor, id: string, input: FeeItemInput): Promise<FeeItemDto> {
    const before = await this.load(actor, id);
    await this.assertInvestigation(input.investigationId);
    const row = await this.prisma
      .$transaction(async (tx) => {
        const f = await tx.feeItem.update({
          where: { id },
          data: { kind: input.kind, name: input.name, amount: dec(toCents(input.amount)), investigationId: input.investigationId ?? null },
        });
        await this.audit.record(actor, { action: 'fee_item.updated', resourceType: 'fee_item', resourceId: id, oldValue: toFeeItemDto(before), newValue: input }, tx);
        return f;
      })
      .catch(FeesService.duplicateGuard);
    return toFeeItemDto(row);
  }

  async setStatus(actor: Actor, id: string, isActive: boolean): Promise<FeeItemDto> {
    await this.load(actor, id);
    const row = await this.prisma.$transaction(async (tx) => {
      const f = await tx.feeItem.update({ where: { id }, data: { isActive } });
      await this.audit.record(actor, { action: isActive ? 'fee_item.activated' : 'fee_item.deactivated', resourceType: 'fee_item', resourceId: id }, tx);
      return f;
    });
    return toFeeItemDto(row);
  }

  private async load(actor: Actor, id: string) {
    const row = await this.prisma.feeItem.findFirst({ where: { id, chamberId: this.chamber(actor) } });
    if (!row) throw AppError.notFound('Fee');
    return row;
  }

  private async assertInvestigation(id?: string | null) {
    if (id && !(await this.prisma.investigationCatalog.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound('Investigation');
  }

  static duplicateGuard(err: unknown): never {
    const text = err instanceof Error ? err.message : String(err);
    if (/fee_items_chamber_(name|investigation)_unique|P2002/.test(text)) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'A fee with this name or investigation already exists', HttpStatus.CONFLICT, [{ path: 'name', message: 'validation.duplicate_item' }]);
    }
    throw err;
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, PERMISSIONS, PrescriptionTemplateDto, PrescriptionTemplateInput } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor } from '../../common/request-context';
import { itemRows, sanitizeMedicineRefs } from './prescription-writer';
import { toItemDto } from './prescriptions.mapper';

const include = {
  items: { orderBy: { sortOrder: 'asc' } },
  doctor: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.PrescriptionTemplateInclude;
type Row = Prisma.PrescriptionTemplateGetPayload<{ include: typeof include }>;

/**
 * Reusable prescription templates (spec §11): personal templates belong to a
 * doctor; shared templates are visible to everyone in the chamber. Applying a
 * template only pre-fills the consultation — every value stays editable.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private chamber(actor: Actor): string {
    if (!actor.chamberId) throw AppError.forbidden('Templates are managed inside a chamber');
    return actor.chamberId;
  }

  async list(actor: Actor): Promise<PrescriptionTemplateDto[]> {
    const chamberId = this.chamber(actor);
    const rows = await this.prisma.prescriptionTemplate.findMany({
      where: { chamberId, OR: [{ doctorId: null }, ...(actor.doctorId ? [{ doctorId: actor.doctorId }] : [])] },
      include,
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((r) => this.dto(actor, r));
  }

  async get(actor: Actor, id: string): Promise<PrescriptionTemplateDto> {
    return this.dto(actor, await this.load(actor, id));
  }

  async create(actor: Actor, input: PrescriptionTemplateInput): Promise<PrescriptionTemplateDto> {
    const chamberId = this.chamber(actor);
    // Non-doctors (e.g. managers) can only create chamber-wide templates.
    const doctorId = input.shared || !actor.doctorId ? null : actor.doctorId;
    const items = await sanitizeMedicineRefs(this.prisma, chamberId, input.items);
    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.prescriptionTemplate.create({
          data: {
            chamberId,
            doctorId,
            name: input.name,
            description: input.description,
            diagnoses: input.diagnoses as Prisma.InputJsonValue,
            investigations: input.investigations as Prisma.InputJsonValue,
            advice: input.advice,
            followUpInstructions: input.followUpInstructions,
            createdById: actor.userId,
            createdByName: actor.fullName,
            items: { create: itemRows(items) },
          },
        });
        await this.audit.record(actor, { action: 'template.created', resourceType: 'prescription_template', resourceId: row.id, newValue: { name: input.name, shared: doctorId === null, items: items.length } }, tx);
        return row;
      })
      .catch(TemplatesService.duplicateGuard);
    return this.get(actor, created.id);
  }

  async update(actor: Actor, id: string, input: PrescriptionTemplateInput & { version: number }): Promise<PrescriptionTemplateDto> {
    const before = await this.loadEditable(actor, id);
    if (before.version !== input.version) throw AppError.staleVersion();
    const doctorId = input.shared || !actor.doctorId ? null : (before.doctorId ?? actor.doctorId);
    const items = await sanitizeMedicineRefs(this.prisma, before.chamberId, input.items);
    await this.prisma
      .$transaction(async (tx) => {
        const res = await tx.prescriptionTemplate.updateMany({
          where: { id, version: input.version },
          data: {
            doctorId,
            name: input.name,
            description: input.description,
            diagnoses: input.diagnoses as Prisma.InputJsonValue,
            investigations: input.investigations as Prisma.InputJsonValue,
            advice: input.advice,
            followUpInstructions: input.followUpInstructions,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw AppError.staleVersion();
        await tx.prescriptionTemplateItem.deleteMany({ where: { templateId: id } });
        if (items.length) await tx.prescriptionTemplateItem.createMany({ data: itemRows(items).map((r) => ({ ...r, templateId: id })) });
        await this.audit.record(
          actor,
          { action: 'template.updated', resourceType: 'prescription_template', resourceId: id, oldValue: { name: before.name, shared: before.doctorId === null }, newValue: { name: input.name, shared: doctorId === null, items: items.length } },
          tx,
        );
      })
      .catch(TemplatesService.duplicateGuard);
    return this.get(actor, id);
  }

  /** Templates are not clinical records, so they can be removed (the removal is audited). */
  async remove(actor: Actor, id: string) {
    const before = await this.loadEditable(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.prescriptionTemplate.delete({ where: { id } });
      await this.audit.record(actor, { action: 'template.deleted', resourceType: 'prescription_template', resourceId: id, oldValue: { name: before.name, shared: before.doctorId === null } }, tx);
    });
    return { deleted: true };
  }

  private dto(actor: Actor, r: Row): PrescriptionTemplateDto {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      shared: r.doctorId === null,
      ownerName: r.doctor?.user.fullName ?? r.createdByName,
      isOwn: !!actor.doctorId && r.doctorId === actor.doctorId,
      canEdit: this.canEdit(actor, r),
      diagnoses: (r.diagnoses as PrescriptionTemplateDto['diagnoses']) ?? [],
      investigations: (r.investigations as PrescriptionTemplateDto['investigations']) ?? [],
      items: r.items.map(toItemDto),
      advice: r.advice,
      followUpInstructions: r.followUpInstructions,
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  private canEdit(actor: Actor, r: { doctorId: string | null }) {
    if (!actor.permissions.has(PERMISSIONS.TEMPLATES_MANAGE)) return false;
    return r.doctorId === null || r.doctorId === actor.doctorId;
  }

  private async load(actor: Actor, id: string): Promise<Row> {
    const chamberId = this.chamber(actor);
    const row = await this.prisma.prescriptionTemplate.findFirst({ where: { id, chamberId }, include });
    // Other doctors' personal templates are private.
    if (!row || (row.doctorId !== null && row.doctorId !== actor.doctorId)) throw AppError.notFound('Template');
    return row;
  }

  private async loadEditable(actor: Actor, id: string): Promise<Row> {
    const row = await this.load(actor, id);
    if (!this.canEdit(actor, row)) throw AppError.forbidden();
    return row;
  }

  static duplicateGuard(err: unknown): never {
    const text = err instanceof Error ? err.message : String(err);
    if (/owner_name_unique|P2002/.test(text)) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'A template with this name already exists', HttpStatus.CONFLICT, [{ path: 'name', message: 'validation.duplicate_item' }]);
    }
    throw err;
  }
}

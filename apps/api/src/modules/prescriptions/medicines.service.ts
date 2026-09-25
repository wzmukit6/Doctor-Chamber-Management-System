import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, MedicineDto, MedicineInput, MedicineQuery, MedicineSuggestionsDto, PERMISSIONS } from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { escapeLike } from '../patients/patient.utils';
import { MedicineRow, toMedicineDto } from './prescriptions.mapper';

const NO_DOCTOR = '00000000-0000-0000-0000-000000000000';

/**
 * Medicine master (spec §15): global entries (platform administrators with
 * `medicines.manage_global`) plus chamber-specific entries. Medicines are
 * deactivated, never deleted — prescriptions reference them.
 */
@Injectable()
export class MedicinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private visible(actor: Actor) {
    return actor.chamberId ? Prisma.sql`(m.chamber_id IS NULL OR m.chamber_id = ${actor.chamberId}::uuid)` : Prisma.sql`m.chamber_id IS NULL`;
  }

  private favoriteJoin(actor: Actor) {
    return Prisma.sql`LEFT JOIN doctor_medicine_favorites f ON f.medicine_id = m.id AND f.doctor_id = ${actor.doctorId ?? NO_DOCTOR}::uuid`;
  }

  /** Ranked search: exact/prefix brand or generic first, then trigram (typo-tolerant) similarity. */
  async search(actor: Actor, q: MedicineQuery): Promise<MedicineDto[]> {
    const term = q.q?.trim().toLowerCase() ?? '';
    const like = `%${escapeLike(term)}%`;
    const prefix = `${escapeLike(term)}%`;
    const scope =
      q.scope === 'global'
        ? Prisma.sql`m.chamber_id IS NULL`
        : q.scope === 'chamber'
          ? Prisma.sql`m.chamber_id = ${actor.chamberId ?? NO_DOCTOR}::uuid`
          : q.scope === 'favorites'
            ? Prisma.sql`${this.visible(actor)} AND f.doctor_id IS NOT NULL`
            : this.visible(actor);
    const active = q.includeInactive ? Prisma.empty : Prisma.sql`AND m.is_active`;
    const form = q.form ? Prisma.sql`AND m.form = ${q.form}::"MedicineForm"` : Prisma.empty;
    const brand = Prisma.sql`lower(coalesce(m.brand_name, ''))`;
    const generic = Prisma.sql`lower(m.generic_name)`;
    const match = term
      ? Prisma.sql`AND (${generic} LIKE ${like} OR ${brand} LIKE ${like} OR ${generic} % ${term} OR ${term} <% ${generic} OR ${term} <% ${brand} OR lower(coalesce(m.keywords, '')) LIKE ${like})`
      : Prisma.empty;
    const score = term
      ? Prisma.sql`(CASE WHEN ${brand} = ${term} OR ${generic} = ${term} THEN 100 WHEN ${brand} LIKE ${prefix} OR ${generic} LIKE ${prefix} THEN 50 ELSE 0 END
          + greatest(similarity(${generic}, ${term}), similarity(${brand}, ${term})) * 30
          + greatest(word_similarity(${term}, ${generic}), word_similarity(${term}, ${brand})) * 20
          + CASE WHEN f.doctor_id IS NOT NULL THEN 15 ELSE 0 END)`
      : Prisma.sql`CASE WHEN f.doctor_id IS NOT NULL THEN 1 ELSE 0 END`;
    const rows = await this.prisma.$queryRaw<MedicineRow[]>`
      SELECT m.*, (f.doctor_id IS NOT NULL) AS is_favorite, ${score} AS score
      FROM medicines m ${this.favoriteJoin(actor)}
      WHERE ${scope} ${active} ${form} ${match}
      ORDER BY score DESC, lower(coalesce(m.brand_name, m.generic_name)), lower(m.generic_name), m.strength
      LIMIT ${q.limit}`;
    return rows.map(toMedicineDto);
  }

  /** One-click picks for the prescription builder (spec §10): favourites, frequent and recent. */
  async suggestions(actor: Actor): Promise<MedicineSuggestionsDto> {
    if (!actor.chamberId) return { favorites: [], frequent: [], recent: [] };
    const byDoctor = actor.doctorId ? Prisma.sql`AND p.doctor_id = ${actor.doctorId}::uuid` : Prisma.empty;
    const [favorites, frequent, recent] = await Promise.all([
      actor.doctorId
        ? this.prisma.$queryRaw<MedicineRow[]>`
            SELECT m.*, true AS is_favorite FROM doctor_medicine_favorites f JOIN medicines m ON m.id = f.medicine_id
            WHERE f.doctor_id = ${actor.doctorId}::uuid AND m.is_active AND ${this.visible(actor)}
            ORDER BY lower(coalesce(m.brand_name, m.generic_name)) LIMIT 30`
        : Promise.resolve([] as MedicineRow[]),
      this.prisma.$queryRaw<MedicineRow[]>`
        SELECT m.*, (f.doctor_id IS NOT NULL) AS is_favorite, count(*)::bigint AS usage_count
        FROM prescription_items i
        JOIN prescription_versions v ON v.id = i.version_id AND v.status IN ('FINALIZED', 'SUPERSEDED')
        JOIN prescriptions p ON p.id = v.prescription_id
        JOIN medicines m ON m.id = i.medicine_id
        ${this.favoriteJoin(actor)}
        WHERE p.chamber_id = ${actor.chamberId}::uuid AND v.finalized_at > now() - interval '180 days' AND m.is_active ${byDoctor}
        GROUP BY m.id, f.doctor_id
        ORDER BY usage_count DESC, lower(m.generic_name) LIMIT 12`,
      this.prisma.$queryRaw<MedicineRow[]>`
        SELECT * FROM (
          SELECT DISTINCT ON (m.id) m.*, (f.doctor_id IS NOT NULL) AS is_favorite, v.created_at AS used_at
          FROM prescription_items i
          JOIN prescription_versions v ON v.id = i.version_id AND v.status <> 'DISCARDED'
          JOIN prescriptions p ON p.id = v.prescription_id
          JOIN medicines m ON m.id = i.medicine_id
          ${this.favoriteJoin(actor)}
          WHERE p.chamber_id = ${actor.chamberId}::uuid AND m.is_active ${byDoctor}
          ORDER BY m.id, v.created_at DESC
        ) r ORDER BY used_at DESC LIMIT 10`,
    ]);
    return { favorites: favorites.map(toMedicineDto), frequent: frequent.map(toMedicineDto), recent: recent.map(toMedicineDto) };
  }

  async get(actor: Actor, id: string): Promise<MedicineDto> {
    const rows = await this.prisma.$queryRaw<MedicineRow[]>`
      SELECT m.*, (f.doctor_id IS NOT NULL) AS is_favorite FROM medicines m ${this.favoriteJoin(actor)}
      WHERE m.id = ${id}::uuid AND (${this.visible(actor)} OR ${isSuperAdmin(actor)})`;
    if (!rows[0]) throw AppError.notFound('Medicine');
    return toMedicineDto(rows[0]);
  }

  async create(actor: Actor, input: MedicineInput): Promise<MedicineDto> {
    const chamberId = this.targetScope(actor, input.global);
    const { global: _g, ...data } = input;
    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.medicine.create({ data: { ...data, route: data.route ?? null, chamberId, createdById: actor.userId } });
        await this.audit.record(actor, { action: 'medicine.created', resourceType: 'medicine', resourceId: row.id, newValue: { ...data, global: chamberId === null } }, tx);
        return row;
      })
      .catch(MedicinesService.duplicateGuard);
    return this.get(actor, created.id);
  }

  async update(actor: Actor, id: string, input: MedicineInput): Promise<MedicineDto> {
    const before = await this.loadEditable(actor, id);
    const { global: _g, ...data } = input;
    await this.prisma
      .$transaction(async (tx) => {
        await tx.medicine.update({ where: { id }, data: { ...data, route: data.route ?? null } });
        await this.audit.record(actor, { action: 'medicine.updated', resourceType: 'medicine', resourceId: id, oldValue: before, newValue: data }, tx);
      })
      .catch(MedicinesService.duplicateGuard);
    return this.get(actor, id);
  }

  async setStatus(actor: Actor, id: string, isActive: boolean): Promise<MedicineDto> {
    if (!isActive && !actor.permissions.has(PERMISSIONS.MEDICINES_DELETE)) throw AppError.forbidden();
    await this.loadEditable(actor, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.medicine.update({ where: { id }, data: { isActive } });
      await this.audit.record(actor, { action: isActive ? 'medicine.activated' : 'medicine.deactivated', resourceType: 'medicine', resourceId: id }, tx);
    });
    return this.get(actor, id);
  }

  async setFavorite(actor: Actor, id: string, favorite: boolean): Promise<MedicineDto> {
    if (!actor.doctorId) throw AppError.forbidden('Only doctors keep favourite medicines');
    await this.get(actor, id);
    if (favorite) {
      await this.prisma.doctorMedicineFavorite.upsert({
        where: { doctorId_medicineId: { doctorId: actor.doctorId, medicineId: id } },
        create: { doctorId: actor.doctorId, medicineId: id },
        update: {},
      });
    } else {
      await this.prisma.doctorMedicineFavorite.deleteMany({ where: { doctorId: actor.doctorId, medicineId: id } });
    }
    return this.get(actor, id);
  }

  /** Global entries need `medicines.manage_global`; chamber entries belong to that chamber only. */
  private async loadEditable(actor: Actor, id: string): Promise<MedicineDto> {
    const row = await this.prisma.medicine.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Medicine');
    if (row.chamberId === null) {
      if (!actor.permissions.has(PERMISSIONS.MEDICINES_MANAGE_GLOBAL)) throw AppError.forbidden('Only a platform administrator can change the global medicine master');
    } else if (!isSuperAdmin(actor) && row.chamberId !== actor.chamberId) {
      throw AppError.crossTenant();
    }
    return this.get(actor, id);
  }

  private targetScope(actor: Actor, global: boolean): string | null {
    if (global || !actor.chamberId) {
      if (!actor.permissions.has(PERMISSIONS.MEDICINES_MANAGE_GLOBAL)) throw AppError.forbidden('Only a platform administrator can add global medicines');
      return null;
    }
    return actor.chamberId;
  }

  static duplicateGuard(err: unknown): never {
    const text = err instanceof Error ? err.message : String(err);
    if (/medicines_scope_unique|P2002/.test(text)) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'This medicine (name, form and strength) already exists', HttpStatus.CONFLICT, [{ path: 'genericName', message: 'validation.duplicate_item' }]);
    }
    throw err;
  }
}

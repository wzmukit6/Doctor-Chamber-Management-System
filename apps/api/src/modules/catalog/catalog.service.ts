import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CatalogItemDto,
  CatalogQuery,
  ComplaintCatalogInput,
  DiagnosisCatalogInput,
  ERROR_CODES,
  InvestigationCatalogInput,
  PERMISSIONS,
} from '@chamber/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { Actor, isSuperAdmin } from '../../common/request-context';
import { escapeLike } from '../patients/patient.utils';

export type CatalogKind = 'diagnoses' | 'investigations' | 'complaints';

/** Per-catalogue configuration: table, searchable text, usage table. */
const KINDS: Record<CatalogKind, { table: Prisma.Sql; usageTable: Prisma.Sql; usageFk: Prisma.Sql; resource: string }> = {
  diagnoses: {
    table: Prisma.sql`diagnoses`,
    usageTable: Prisma.sql`consultation_diagnoses`,
    usageFk: Prisma.sql`diagnosis_id`,
    resource: 'diagnosis',
  },
  investigations: {
    table: Prisma.sql`investigations`,
    usageTable: Prisma.sql`consultation_investigations`,
    usageFk: Prisma.sql`investigation_id`,
    resource: 'investigation',
  },
  complaints: {
    table: Prisma.sql`complaints`,
    usageTable: Prisma.sql`consultation_symptoms`,
    usageFk: Prisma.sql`complaint_id`,
    resource: 'complaint',
  },
};

type Row = {
  id: string;
  chamber_id: string | null;
  name: string;
  is_active: boolean;
  category?: string | null;
  code?: string | null;
  code_system?: string | null;
  description?: string | null;
  keywords?: string | null;
  short_name?: string | null;
  sample_type?: string | null;
  instructions?: string | null;
  usage_count?: bigint | number | null;
};

function toDto(r: Row): CatalogItemDto {
  return {
    id: r.id,
    name: r.name,
    code: r.code ?? null,
    codeSystem: r.code_system ?? null,
    shortName: r.short_name ?? null,
    category: r.category ?? null,
    description: r.description ?? null,
    sampleType: r.sample_type ?? null,
    instructions: r.instructions ?? null,
    keywords: r.keywords ?? null,
    isActive: r.is_active,
    isGlobal: r.chamber_id === null,
    ...(r.usage_count !== undefined && r.usage_count !== null ? { usageCount: Number(r.usage_count) } : {}),
  };
}

/**
 * Clinical master data (spec §15–§17): platform-wide (global) entries managed by
 * super admins plus chamber-specific entries managed by the chamber. Entries are
 * deactivated, never deleted, because consultations reference them.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Ranked search: exact/prefix name and code first, then trigram (typo-tolerant) similarity. */
  async search(actor: Actor, kind: CatalogKind, q: CatalogQuery): Promise<CatalogItemDto[]> {
    const k = KINDS[kind];
    const term = q.q?.trim().toLowerCase() ?? '';
    const like = `%${escapeLike(term)}%`;
    const scope =
      q.scope === 'global'
        ? Prisma.sql`c.chamber_id IS NULL`
        : q.scope === 'chamber'
          ? Prisma.sql`c.chamber_id = ${actor.chamberId}::uuid`
          : actor.chamberId
            ? Prisma.sql`(c.chamber_id IS NULL OR c.chamber_id = ${actor.chamberId}::uuid)`
            : Prisma.sql`c.chamber_id IS NULL`;
    const active = q.includeInactive ? Prisma.empty : Prisma.sql`AND c.is_active`;
    const extraClauses =
      kind === 'diagnoses'
        ? Prisma.sql`OR lower(coalesce(c.code, '')) LIKE ${like} OR lower(coalesce(c.keywords, '')) LIKE ${like}`
        : kind === 'investigations'
          ? Prisma.sql`OR lower(coalesce(c.short_name, '')) LIKE ${like}`
          : Prisma.empty;
    const match = term
      ? Prisma.sql`AND (lower(c.name) LIKE ${like} OR lower(c.name) % ${term} OR ${term} <% lower(c.name) ${extraClauses})`
      : Prisma.empty;
    const codeRank = kind === 'diagnoses' ? Prisma.sql`+ CASE WHEN lower(coalesce(c.code, '')) = ${term} THEN 90 WHEN lower(coalesce(c.code, '')) LIKE ${`${escapeLike(term)}%`} THEN 40 ELSE 0 END` : Prisma.empty;
    const score = term
      ? Prisma.sql`(CASE WHEN lower(c.name) = ${term} THEN 100 WHEN lower(c.name) LIKE ${`${escapeLike(term)}%`} THEN 50 ELSE 0 END ${codeRank} + similarity(lower(c.name), ${term}) * 30 + word_similarity(${term}, lower(c.name)) * 20)`
      : Prisma.sql`0`;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT c.*, ${score} AS score
      FROM ${k.table} c
      WHERE ${scope} ${active} ${match}
      ORDER BY score DESC, lower(c.name) ASC
      LIMIT ${q.limit}`;
    return rows.map(toDto);
  }

  /** Items the doctor (or chamber) used most in the last 180 days — one-click picks. */
  async frequent(actor: Actor, kind: CatalogKind, limit = 12): Promise<CatalogItemDto[]> {
    const k = KINDS[kind];
    if (!actor.chamberId) return [];
    const byDoctor = actor.doctorId ? Prisma.sql`AND con.doctor_id = ${actor.doctorId}::uuid` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT c.*, count(*)::bigint AS usage_count
      FROM ${k.usageTable} u
      JOIN consultations con ON con.id = u.consultation_id
      JOIN ${k.table} c ON c.id = u.${k.usageFk}
      WHERE con.chamber_id = ${actor.chamberId}::uuid
        AND con.status <> 'CANCELLED'
        AND con.started_at > now() - interval '180 days'
        AND c.is_active
        ${byDoctor}
      GROUP BY c.id
      ORDER BY usage_count DESC, lower(c.name)
      LIMIT ${limit}`;
    return rows.map(toDto);
  }

  async create(actor: Actor, kind: CatalogKind, input: DiagnosisCatalogInput | InvestigationCatalogInput | ComplaintCatalogInput): Promise<CatalogItemDto> {
    const chamberId = this.targetScope(actor, input.global);
    const { global: _g, ...data } = input as DiagnosisCatalogInput;
    const created = await this.prisma
      .$transaction(async (tx) => {
      const row = await this.delegate(tx, kind).create({ data: { ...data, chamberId, createdById: actor.userId } });
      await this.audit.record(actor, { action: `${KINDS[kind].resource}.created`, resourceType: KINDS[kind].resource, resourceId: row.id, newValue: { ...data, global: chamberId === null } }, tx);
      return row;
    })
      .catch(CatalogService.duplicateGuard);
    return this.get(kind, created.id);
  }

  async update(actor: Actor, kind: CatalogKind, id: string, input: DiagnosisCatalogInput | InvestigationCatalogInput | ComplaintCatalogInput): Promise<CatalogItemDto> {
    const before = await this.loadEditable(actor, kind, id);
    const { global: _g, ...data } = input as DiagnosisCatalogInput;
    await this.prisma
      .$transaction(async (tx) => {
        await this.delegate(tx, kind).update({ where: { id }, data });
        await this.audit.record(actor, { action: `${KINDS[kind].resource}.updated`, resourceType: KINDS[kind].resource, resourceId: id, oldValue: before, newValue: data }, tx);
      })
      .catch(CatalogService.duplicateGuard);
    return this.get(kind, id);
  }

  async setStatus(actor: Actor, kind: CatalogKind, id: string, isActive: boolean): Promise<CatalogItemDto> {
    await this.loadEditable(actor, kind, id);
    await this.prisma.$transaction(async (tx) => {
      await this.delegate(tx, kind).update({ where: { id }, data: { isActive } });
      await this.audit.record(
        actor,
        { action: `${KINDS[kind].resource}.${isActive ? 'activated' : 'deactivated'}`, resourceType: KINDS[kind].resource, resourceId: id },
        tx,
      );
    });
    return this.get(kind, id);
  }

  private async get(kind: CatalogKind, id: string): Promise<CatalogItemDto> {
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM ${KINDS[kind].table} WHERE id = ${id}::uuid`;
    if (!rows[0]) throw AppError.notFound();
    return toDto(rows[0]);
  }

  /** Global entries: super admin (system.manage). Chamber entries: that chamber only. */
  private async loadEditable(actor: Actor, kind: CatalogKind, id: string) {
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM ${KINDS[kind].table} WHERE id = ${id}::uuid`;
    const row = rows[0];
    if (!row) throw AppError.notFound();
    if (row.chamber_id === null) {
      if (!actor.permissions.has(PERMISSIONS.SYSTEM_MANAGE)) throw AppError.forbidden('Only a platform administrator can change global master data');
    } else if (!isSuperAdmin(actor) && row.chamber_id !== actor.chamberId) {
      throw AppError.crossTenant();
    }
    return toDto(row);
  }

  private targetScope(actor: Actor, global: boolean): string | null {
    if (global || !actor.chamberId) {
      if (!actor.permissions.has(PERMISSIONS.SYSTEM_MANAGE)) throw AppError.forbidden('Only a platform administrator can add global master data');
      return null;
    }
    return actor.chamberId;
  }

  private delegate(tx: Prisma.TransactionClient, kind: CatalogKind) {
    // The three delegates share the create/update shape used here.
    const map = { diagnoses: tx.diagnosisCatalog, investigations: tx.investigationCatalog, complaints: tx.complaintCatalog };
    return map[kind] as unknown as {
      create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
    };
  }

  /** Maps unique-index violations to a friendly duplicate error. */
  static duplicateGuard(err: unknown): never {
    const text = err instanceof Error ? err.message : String(err);
    if (/scope_(name|code)_unique|P2002/.test(text)) {
      throw new AppError(ERROR_CODES.DUPLICATE, 'An entry with this name or code already exists', HttpStatus.CONFLICT, [{ path: 'name', message: 'validation.duplicate_item' }]);
    }
    throw err;
  }
}

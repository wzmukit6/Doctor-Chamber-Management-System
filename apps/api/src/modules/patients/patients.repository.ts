import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dateFromQuery, escapeLike, normalizePhoneForSearch, phoneDigitsFromQuery, toDateOnly } from './patient.utils';

export interface PatientSearchParams {
  /** null = all chambers (platform admin). */
  chamberId: string | null;
  q?: string;
  gender?: string;
  registeredFrom?: string;
  registeredTo?: string;
  sort?: 'createdAt' | 'fullName' | 'patientCode';
  order: 'asc' | 'desc';
  skip: number;
  take: number;
}

const SORT_COLUMNS = {
  createdAt: Prisma.sql`p.created_at`,
  fullName: Prisma.sql`lower(p.full_name)`,
  patientCode: Prisma.sql`p.patient_code`,
} as const;

/**
 * Patient search (spec §6): patient code, name (partial + trigram fuzzy
 * matching), phone (any format, partial), email and date of birth, ranked by
 * relevance. All user input is passed as bound parameters.
 */
@Injectable()
export class PatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: PatientSearchParams): Promise<{ ids: string[]; total: number }> {
    const where = this.whereClause(params);
    const q = params.q?.trim();
    const score = q ? this.scoreExpression(q) : Prisma.sql`0`;
    const direction = params.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy =
      q && !params.sort
        ? Prisma.sql`score DESC, p.created_at DESC`
        : Prisma.sql`${SORT_COLUMNS[params.sort ?? 'createdAt']} ${direction}, p.id`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id, ${score} AS score
        FROM patients p
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${params.take} OFFSET ${params.skip}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM patients p WHERE ${where}`,
    ]);
    return { ids: rows.map((r) => r.id), total: Number(countRows[0]?.count ?? 0) };
  }

  private whereClause(params: PatientSearchParams): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`];
    if (params.chamberId) conditions.push(Prisma.sql`p.chamber_id = ${params.chamberId}::uuid`);
    if (params.gender) conditions.push(Prisma.sql`p.gender = ${params.gender}::"Gender"`);
    if (params.registeredFrom) conditions.push(Prisma.sql`p.created_at >= ${toDateOnly(params.registeredFrom)}`);
    if (params.registeredTo) {
      const end = toDateOnly(params.registeredTo);
      end.setUTCDate(end.getUTCDate() + 1);
      conditions.push(Prisma.sql`p.created_at < ${end}`);
    }

    const q = params.q?.trim();
    if (q) {
      const like = `%${escapeLike(q.toLowerCase())}%`;
      const matches: Prisma.Sql[] = [
        Prisma.sql`lower(p.patient_code) LIKE ${like}`,
        Prisma.sql`lower(p.full_name) LIKE ${like}`,
        // Trigram matching tolerates typos ("rahmn" → "Rahman") and word order.
        Prisma.sql`lower(p.full_name) % ${q.toLowerCase()}`,
        Prisma.sql`${q.toLowerCase()} <% lower(p.full_name)`,
        Prisma.sql`p.email LIKE ${like}`,
      ];
      const digits = phoneDigitsFromQuery(q);
      if (digits) matches.push(Prisma.sql`p.phone_search LIKE ${`%${escapeLike(digits)}%`}`);
      const date = dateFromQuery(q);
      if (date) matches.push(Prisma.sql`p.date_of_birth = ${toDateOnly(date)}::date`);
      conditions.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
    }
    return Prisma.join(conditions, ' AND ');
  }

  private scoreExpression(q: string): Prisma.Sql {
    const lower = q.toLowerCase();
    const digits = phoneDigitsFromQuery(q);
    return Prisma.sql`(
      CASE WHEN lower(p.patient_code) = ${lower} THEN 100 ELSE 0 END
      + CASE WHEN lower(p.patient_code) LIKE ${`${escapeLike(lower)}%`} THEN 20 ELSE 0 END
      + CASE WHEN ${digits ?? ''} <> '' AND p.phone_search = ${digits ?? ''} THEN 80 ELSE 0 END
      + CASE WHEN lower(p.full_name) = ${lower} THEN 60 ELSE 0 END
      + CASE WHEN lower(p.full_name) LIKE ${`${escapeLike(lower)}%`} THEN 25 ELSE 0 END
      + similarity(lower(p.full_name), ${lower}) * 40
      + word_similarity(${lower}, lower(p.full_name)) * 20
    )`;
  }

  /**
   * Possible duplicates for registration: same phone, or a similar name with the
   * same date of birth. Returns similarity so callers can decide what blocks.
   */
  async findDuplicateCandidates(input: {
    chamberId: string;
    fullName?: string;
    phone?: string | null;
    dateOfBirth?: string | null;
    excludeId?: string;
  }): Promise<{ id: string; nameSimilarity: number; phoneMatch: boolean; dobMatch: boolean }[]> {
    const phone = normalizePhoneForSearch(input.phone);
    const name = input.fullName?.trim().toLowerCase() ?? '';
    const dob = input.dateOfBirth ? toDateOnly(input.dateOfBirth) : null;
    if (!phone && !(name && dob)) return [];

    const clauses: Prisma.Sql[] = [];
    if (phone) clauses.push(Prisma.sql`p.phone_search = ${phone}`);
    // Estimated birth dates (derived from an age) are too coarse to indicate a duplicate.
    if (name && dob) {
      clauses.push(Prisma.sql`(p.date_of_birth = ${dob}::date AND NOT p.dob_estimated AND similarity(lower(p.full_name), ${name}) >= 0.5)`);
    }

    return this.prisma.$queryRaw<{ id: string; nameSimilarity: number; phoneMatch: boolean; dobMatch: boolean }[]>`
      SELECT p.id,
        ${name ? Prisma.sql`similarity(lower(p.full_name), ${name})` : Prisma.sql`0`}::float AS "nameSimilarity",
        ${phone ? Prisma.sql`(p.phone_search = ${phone})` : Prisma.sql`false`} AS "phoneMatch",
        ${dob ? Prisma.sql`(p.date_of_birth = ${dob}::date AND NOT p.dob_estimated)` : Prisma.sql`false`} AS "dobMatch"
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.chamber_id = ${input.chamberId}::uuid
        ${input.excludeId ? Prisma.sql`AND p.id <> ${input.excludeId}::uuid` : Prisma.empty}
        AND (${Prisma.join(clauses, ' OR ')})
      ORDER BY "nameSimilarity" DESC
      LIMIT 10`;
  }

  /** Atomically issues the next patient number for a chamber (safe under concurrency). */
  async nextSequence(tx: Prisma.TransactionClient, chamberId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO patient_code_sequences (chamber_id, last_value) VALUES (${chamberId}::uuid, 1)
      ON CONFLICT (chamber_id) DO UPDATE SET last_value = patient_code_sequences.last_value + 1
      RETURNING last_value`;
    return rows[0]!.last_value;
  }
}

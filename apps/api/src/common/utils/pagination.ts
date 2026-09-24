import type { PageMeta, PaginationQuery } from '@chamber/shared';

export function pageArgs(q: Pick<PaginationQuery, 'page' | 'pageSize'>) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function pageMeta(q: Pick<PaginationQuery, 'page' | 'pageSize'>, total: number): PageMeta {
  return { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/** Returns `sort` if it is in the allow-list, otherwise the fallback (prevents sorting on arbitrary columns). */
export function safeSort<T extends string>(sort: string | undefined, allowed: readonly T[], fallback: T): T {
  return sort && (allowed as readonly string[]).includes(sort) ? (sort as T) : fallback;
}

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { PageMeta } from '@chamber/shared';
import { Button } from './Button';
import { EmptyState, ErrorState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens to keep tables readable on mobile. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: ReactNode;
  meta?: PageMeta;
  onPageChange?: (page: number) => void;
  caption?: string;
}

/** Reusable table with skeleton loading, empty/error states and pagination (spec §28, §42). */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, meta, onPageChange, caption }: DataTableProps<T>) {
  const { t } = useTranslation();
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx(c.className, c.hideOnMobile && 'hidden md:table-cell')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={clsx(c.hideOnMobile && 'hidden md:table-cell')}>
                      <Skeleton className="h-4 w-full max-w-[12rem]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              !error &&
              rows?.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key} className={clsx(c.className, c.hideOnMobile && 'hidden md:table-cell')}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && error && <ErrorState message={error} onRetry={onRetry} />}
      {!loading && !error && rows?.length === 0 && (empty ?? <EmptyState title={t('common.none')} />)}
      {meta && meta.totalPages > 1 && onPageChange && (
        <nav className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-ink-muted" aria-label="Pagination">
          <span>
            {t('common.results', { count: meta.total })} · {t('common.page_of', { page: meta.page, total: meta.totalPages })}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
              {t('common.previous')}
            </Button>
            <Button size="sm" variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

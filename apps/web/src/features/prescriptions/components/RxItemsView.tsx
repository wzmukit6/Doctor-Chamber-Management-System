import { useTranslation } from 'react-i18next';
import type { PrescriptionItemDto } from '@chamber/shared';
import { formatDirections, itemTitle } from '../format';

/** Read-only list of prescribed medicines. */
export function RxItemsView({ items, advice }: { items: PrescriptionItemDto[]; advice: string | null }) {
  const { t } = useTranslation();
  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t('rx.no_medicines_short')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((i, n) => (
            <li key={i.id ?? `${i.name}-${n}`} className="text-sm">
              <p className="font-medium text-ink">
                {n + 1}. {itemTitle(i)} {i.strength && <span className="font-normal text-ink-muted">{i.strength}</span>}
                {i.form && <span className="ml-2 text-2xs uppercase tracking-wide text-ink-subtle">{t(`medicineForm.${i.form}`)}</span>}
              </p>
              <p className="pl-4 text-ink-muted">
                {formatDirections(t, i) || '—'}
                {i.quantity ? <span className="text-ink-subtle"> · {t('rx.qty', { count: i.quantity })}</span> : null}
              </p>
              {i.instructions && <p className="pl-4 text-xs italic text-ink-muted">{i.instructions}</p>}
            </li>
          ))}
        </ol>
      )}
      {advice && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-ink-subtle">{t('rx.advice')}</p>
          <p className="whitespace-pre-line text-sm text-ink">{advice}</p>
        </div>
      )}
    </div>
  );
}

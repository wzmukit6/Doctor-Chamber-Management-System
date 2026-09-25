import { forwardRef, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Clock, Plus, Search, Star, TrendingUp } from 'lucide-react';
import type { MedicineDto } from '@chamber/shared';
import { Input } from '@/components/ui';
import { medicinesApi } from '@/services/endpoints';
import { useDebounce } from '@/hooks/useDebounce';

export function medicineLabel(m: Pick<MedicineDto, 'brandName' | 'genericName' | 'strength'>) {
  return [m.brandName ? `${m.brandName} (${m.genericName})` : m.genericName, m.strength].filter(Boolean).join(' ');
}

/**
 * Medicine autocomplete (spec §10): typo-tolerant search over brand and
 * generic names, keyboard selection, free text for unlisted medicines and
 * one-click favourites / frequent / recent medicines.
 */
export const MedicinePicker = forwardRef<HTMLInputElement, { onPick: (m: MedicineDto | string) => void; disabled?: boolean }>(function MedicinePicker({ onPick, disabled }, ref) {
  const { t } = useTranslation();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebounce(q.trim(), 150);
  const results = useQuery({ queryKey: ['medicines', 'search', term], queryFn: () => medicinesApi.search({ q: term, limit: 10 }), enabled: term.length >= 1, staleTime: 60_000 });
  const suggestions = useQuery({ queryKey: ['medicines', 'suggestions'], queryFn: medicinesApi.suggestions, staleTime: 2 * 60_000, enabled: !disabled });

  // Until the results for what was typed have arrived, Enter must not add free text by accident.
  const settled = term === q.trim() && results.isSuccess && !results.isFetching;
  const items: (MedicineDto | { custom: string })[] = [...(results.data ?? [])];
  if (term && settled) items.push({ custom: term });

  const pick = (item: MedicineDto | { custom: string }) => {
    onPick('custom' in item ? item.custom : item);
    setQ('');
    setActive(0);
  };

  const groups = [
    { key: 'favorites', icon: <Star className="h-3 w-3" aria-hidden />, items: suggestions.data?.favorites ?? [] },
    { key: 'frequent', icon: <TrendingUp className="h-3 w-3" aria-hidden />, items: suggestions.data?.frequent ?? [] },
    { key: 'recent', icon: <Clock className="h-3 w-3" aria-hidden />, items: suggestions.data?.recent ?? [] },
  ].filter((g) => g.items.length);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
        <Input
          ref={ref}
          role="combobox"
          aria-label={t('rx.search_medicine')}
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          className="pl-9"
          disabled={disabled}
          placeholder={t('rx.search_placeholder')}
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            else if (e.key === 'Enter' && items[active]) (e.preventDefault(), pick(items[active]!));
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && q.trim() && !settled && items.length === 0 && (
          <p role="status" className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-subtle shadow-overlay">
            {t('common.searching')}
          </p>
        )}
        {open && term && items.length > 0 && (
          <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-overlay">
            {items.map((item, i) => (
              <li
                key={'custom' in item ? 'custom' : item.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), pick(item))}
                className={clsx('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm', i === active && 'bg-primary-50')}
              >
                {'custom' in item ? (
                  <>
                    <Plus className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                    <span className="text-ink-muted">{t('rx.add_free_text', { text: item.custom })}</span>
                  </>
                ) : (
                  <>
                    {item.isFavorite && <Star className="h-3.5 w-3.5 fill-current text-warning" aria-label={t('rx.favorite')} />}
                    <span className="min-w-0 flex-1 truncate text-ink">{medicineLabel(item)}</span>
                    <span className="text-2xs uppercase tracking-wide text-ink-subtle">{t(`medicineForm.${item.form}`)}</span>
                    {!item.isGlobal && <span className="rounded bg-primary-50 px-1 text-2xs text-primary-800">{t('catalog.chamber')}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!disabled && groups.length > 0 && (
        <div className="mt-2 space-y-1">
          {groups.map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex w-20 shrink-0 items-center gap-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                {g.icon} {t(`rx.${g.key}`)}
              </span>
              {g.items.slice(0, 8).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pick(m)}
                  className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-primary-500 hover:bg-primary-50 hover:text-primary-800"
                >
                  + {m.brandName ?? m.genericName}
                  {m.strength && <span className="text-ink-subtle"> {m.strength}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus, Search } from 'lucide-react';
import type { CatalogItemDto } from '@chamber/shared';
import { Input } from '@/components/ui';
import { catalogApi, type CatalogKind } from '@/services/endpoints';
import { useDebounce } from '@/hooks/useDebounce';

/**
 * Fast clinical entry (spec §9, §10): type to search the catalogue (typo
 * tolerant, codes, keywords), pick with the keyboard, add free text when the
 * item is not in the catalogue, or one-click a frequently used item.
 */
export function CatalogPicker({
  kind,
  placeholder,
  onPick,
  exclude = [],
  disabled,
  showFrequent = true,
}: {
  kind: CatalogKind;
  placeholder: string;
  onPick: (item: { id: string | null; name: string; code?: string | null }) => void;
  exclude?: string[];
  disabled?: boolean;
  showFrequent?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebounce(q.trim(), 150);
  const excluded = new Set(exclude.map((e) => e.toLowerCase()));
  const results = useQuery({ queryKey: ['catalog', kind, 'search', term], queryFn: () => catalogApi.search(kind, { q: term, limit: 8 }), enabled: term.length >= 1, staleTime: 60_000 });
  const frequent = useQuery({ queryKey: ['catalog', kind, 'frequent'], queryFn: () => catalogApi.frequent(kind), staleTime: 5 * 60_000, enabled: showFrequent && !disabled });

  const items: (CatalogItemDto | { id: null; name: string; custom: true })[] = [
    ...(results.data ?? []).filter((i) => !excluded.has(i.name.toLowerCase())),
  ];
  const exact = items.some((i) => i.name.toLowerCase() === term.toLowerCase());
  if (term && !exact) items.push({ id: null, name: term, custom: true });

  const pick = (item: (typeof items)[number] | CatalogItemDto) => {
    onPick({ id: item.id, name: item.name, code: 'code' in item ? item.code : null });
    setQ('');
    setActive(0);
  };

  const freq = (frequent.data ?? []).filter((f) => !excluded.has(f.name.toLowerCase())).slice(0, 8);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
        <Input
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          className="pl-9"
          disabled={disabled}
          placeholder={placeholder}
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
        {open && term && items.length > 0 && (
          <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-overlay">
            {items.map((item, i) => (
              <li
                key={`${item.id ?? 'custom'}-${item.name}`}
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
                    <span className="text-ink-muted">{t('consultation.add_custom', { text: item.name })}</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-ink">{item.name}</span>
                    {item.code && <span className="font-mono text-2xs text-ink-subtle">{item.code}</span>}
                    {item.shortName && <span className="text-2xs text-ink-subtle">{item.shortName}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {showFrequent && !disabled && freq.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{t('consultation.frequent')}:</span>
          {freq.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => pick(f)}
              className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-primary-500 hover:bg-primary-50 hover:text-primary-800"
            >
              + {f.shortName ?? f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

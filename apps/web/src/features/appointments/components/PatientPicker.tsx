import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import type { PatientSummaryDto } from '@chamber/shared';
import { Input } from '@/components/ui';
import { patientsApi } from '@/services/endpoints';
import { useDebounce } from '@/hooks/useDebounce';
import { PatientLine } from '@/features/patients/components/PatientBits';

/** Searchable patient combobox (name, ID, phone) with keyboard navigation. */
export function PatientPicker({ value, onChange, error, id }: { value: PatientSummaryDto | null; onChange: (p: PatientSummaryDto | null) => void; error?: boolean; id?: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebounce(q.trim(), 200);
  const results = useQuery({ queryKey: ['patients', 'picker', term], queryFn: () => patientsApi.search(term, 6), enabled: term.length >= 2 });
  useEffect(() => setActive(0), [results.data]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-border bg-canvas/50 px-2 py-1">
        <PatientLine patient={value} />
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-ink-subtle hover:bg-canvas hover:text-ink" aria-label={t('appointments.change')}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  const items = results.data ?? [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
      <Input
        id={id}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls="patient-picker-list"
        aria-invalid={error || undefined}
        className="pl-9"
        placeholder={t('appointments.search_patient')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === 'Enter' && items[active]) (e.preventDefault(), onChange(items[active]!));
        }}
      />
      {items.length > 0 && (
        <ul id="patient-picker-list" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-overlay">
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => (e.preventDefault(), onChange(p))}
              className={clsx('cursor-pointer px-2 py-1', i === active && 'bg-primary-50')}
            >
              <PatientLine patient={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

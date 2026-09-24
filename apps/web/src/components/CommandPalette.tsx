import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, CornerDownLeft } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/stores/auth';
import { visibleSections } from '@/permissions/navigation';

interface Command {
  id: string;
  label: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/**
 * Global command/search palette (spec §30), opened with Ctrl/⌘+K.
 * Phase 1 indexes navigation; patients, appointments and prescriptions are
 * added as those modules are delivered.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canAny } = useAuth();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav = visibleSections(canAny)
      .flatMap((s) => s.items)
      .filter((i) => i.available)
      .map((i) => ({
        id: `nav:${i.key}`,
        label: t(`nav.${i.key}`),
        group: t('command.go_to'),
        icon: i.icon,
        run: () => navigate(i.to),
      }));
    return [...nav, { id: 'nav:profile', label: t('nav.profile'), group: t('command.go_to'), run: () => navigate('/profile') }];
  }, [canAny, navigate, t]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-ink/40" aria-hidden onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('command.placeholder')} className="relative w-full max-w-lg overflow-hidden rounded-xl bg-surface shadow-overlay">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-ink-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `cmd-${results[active]!.id}` : undefined}
            placeholder={t('command.placeholder')}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-2xs text-ink-subtle">Esc</kbd>
        </div>
        <ul id="command-results" role="listbox" className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">{t('command.no_results')}</li>}
          {results.map((c, idx) => {
            const Icon = c.icon;
            return (
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(c)}
                className={clsx('mx-2 flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm', idx === active ? 'bg-primary-50 text-primary-800' : 'text-ink')}
              >
                {Icon && <Icon className="h-4 w-4 opacity-70" />}
                <span className="flex-1">{c.label}</span>
                <span className="text-2xs text-ink-subtle">{c.group}</span>
                {idx === active && <CornerDownLeft className="h-3.5 w-3.5 opacity-60" aria-hidden />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, CornerDownLeft, ListOrdered, Loader2, Search, UserPlus, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { PERMISSIONS } from '@chamber/shared';
import { useAuth } from '@/stores/auth';
import { visibleSections } from '@/permissions/navigation';
import { patientsApi } from '@/services/endpoints';
import { useDebounce } from '@/hooks/useDebounce';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/**
 * Global command/search palette (spec §30), opened with Ctrl/⌘+K from anywhere.
 * Searches patients (name, ID, phone, DOB) so a doctor reaches a patient in one
 * step, plus navigation and quick actions. Appointments, prescriptions and
 * medicines join as those modules are delivered.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can, canAny } = useAuth();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounce(query.trim(), 200);

  const patientSearch = useQuery({
    queryKey: ['patients', 'palette', q],
    queryFn: () => patientsApi.search(q, 6),
    enabled: open && q.length >= 2 && can(PERMISSIONS.PATIENTS_VIEW),
    staleTime: 15_000,
  });

  const commands = useMemo<Command[]>(() => {
    const lower = query.trim().toLowerCase();
    const patients: Command[] = (q.length >= 2 ? (patientSearch.data ?? []) : []).map((p) => ({
      id: `patient:${p.id}`,
      label: p.fullName,
      hint: [p.patientCode, p.age !== null ? t('patients.age_value', { count: p.age }) : null, p.phone].filter(Boolean).join(' · '),
      group: t('command.patients'),
      icon: UserRound,
      run: () => navigate(`/patients/${p.id}`),
    }));
    const actions: Command[] = [
      ...(can(PERMISSIONS.PATIENTS_CREATE)
        ? [{ id: 'action:new-patient', label: t('command.new_patient'), group: t('command.actions'), icon: UserPlus, run: () => navigate('/patients/new') }]
        : []),
      ...(can(PERMISSIONS.APPOINTMENTS_CREATE)
        ? [{ id: 'action:new-appointment', label: t('command.new_appointment'), group: t('command.actions'), icon: CalendarPlus, run: () => navigate('/appointments?new=1') }]
        : []),
      ...(can(PERMISSIONS.QUEUE_VIEW)
        ? [{ id: 'action:queue', label: t('command.open_queue'), group: t('command.actions'), icon: ListOrdered, run: () => navigate('/queue') }]
        : []),
    ];
    const nav: Command[] = [
      ...visibleSections(canAny)
        .flatMap((s) => s.items)
        .filter((i) => i.available)
        .map((i) => ({ id: `nav:${i.key}`, label: t(`nav.${i.key}`), group: t('command.go_to'), icon: i.icon, run: () => navigate(i.to) })),
      { id: 'nav:profile', label: t('nav.profile'), group: t('command.go_to'), run: () => navigate('/profile') },
    ];
    const match = (c: Command) => !lower || c.label.toLowerCase().includes(lower);
    return [...patients, ...actions.filter(match), ...nav.filter(match)];
  }, [q, query, patientSearch.data, can, canAny, navigate, t]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setActive(0), [query, patientSearch.data]);

  if (!open) return null;

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-ink/40" aria-hidden onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('command.placeholder')} className="relative w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-overlay">
        <div className="flex items-center gap-2 border-b border-border px-4">
          {patientSearch.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-ink-subtle" aria-hidden /> : <Search className="h-4 w-4 text-ink-subtle" aria-hidden />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, commands.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(commands[active]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={commands[active] ? `cmd-${commands[active]!.id}` : undefined}
            placeholder={can(PERMISSIONS.PATIENTS_VIEW) ? t('patients.search_placeholder') : t('command.placeholder')}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-2xs text-ink-subtle">Esc</kbd>
        </div>
        <ul id="command-results" role="listbox" className="max-h-[22rem] overflow-y-auto py-2">
          {commands.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-muted">{patientSearch.isFetching ? t('command.searching') : t('command.no_results')}</li>
          )}
          {commands.map((c, idx) => {
            const Icon = c.icon;
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <p className="px-5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{header}</p>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => choose(c)}
                  className={clsx('mx-2 flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm', idx === active ? 'bg-primary-50 text-primary-800' : 'text-ink')}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.label}</span>
                    {c.hint && <span className="block truncate text-2xs text-ink-subtle">{c.hint}</span>}
                  </span>
                  {idx === active && <CornerDownLeft className="h-3.5 w-3.5 opacity-60" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        {can(PERMISSIONS.PATIENTS_VIEW) && query.trim().length < 2 && (
          <p className="border-t border-border px-4 py-2 text-2xs text-ink-subtle">{t('command.type_to_search')}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

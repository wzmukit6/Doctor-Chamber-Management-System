import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  hidden?: boolean;
  icon?: ReactNode;
}

/** Small accessible actions menu (keyboard: Enter/Space opens, arrows move, Escape closes). */
export function ActionMenu({ items, label, trigger, align = 'right' }: { items: MenuItem[]; label: string; trigger?: ReactNode; align?: 'left' | 'right' }) {
  const visible = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (visible.length === 0) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      setOpen(false);
      ref.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(idx + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(idx - 1 + els.length) % els.length]?.focus();
    }
  };

  return (
    <div className="relative inline-block text-left" ref={ref} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={trigger ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        className={
          trigger
            ? 'inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-canvas'
            : 'rounded p-1.5 text-ink-subtle hover:bg-canvas hover:text-ink'
        }
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open && (
        <div id={menuId} role="menu" className={clsx('absolute z-30 mt-1 max-h-80 min-w-[11rem] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-overlay', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map((item) => (
            <button
              key={`${item.label}-${visible.indexOf(item)}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas focus:bg-canvas focus:outline-none',
                item.tone === 'danger' ? 'text-danger' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

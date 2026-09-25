import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Star, X } from 'lucide-react';
import {
  DOSE_PATTERNS,
  DURATION_UNITS,
  MEAL_INSTRUCTIONS,
  MEDICINE_ROUTES,
  PERMISSIONS,
  sameGenericWarnings,
  type DurationUnit,
  type MealInstruction,
  type MedicineDto,
  type MedicineRoute,
} from '@chamber/shared';
import { Badge, Input, Select, Textarea, useToast } from '@/components/ui';
import { medicinesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { translateMessage } from '@/utils/errors';
import { rowFromMedicine, rowFromText, rowKeyOf, withQuantity, type RxDraft, type RxRow } from '../rx';
import { MedicinePicker } from './MedicinePicker';

/**
 * Smart prescription builder (spec §9, §10): pick a medicine, one-click dose
 * pattern, meal timing, duration, automatic quantity, instructions; reorder by
 * drag and drop or keyboard. Every generated value stays editable.
 */
export function PrescriptionBuilder({
  value,
  onChange,
  errors = {},
  errorPrefix = 'prescription.',
  toolbar,
}: {
  value: RxDraft;
  onChange: (next: RxDraft) => void;
  /** Server validation messages keyed by path (e.g. "prescription.items.1.name"). */
  errors?: Record<string, string>;
  errorPrefix?: string;
  toolbar?: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const warnings = new Set(sameGenericWarnings(value.items));

  // Alt+M jumps to the medicine search (spec §10 keyboard shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        pickerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setItems = (items: RxRow[]) => onChange({ ...value, items });
  const update = (i: number, patch: Partial<RxRow>) => setItems(value.items.map((r, j) => (j === i ? withQuantity({ ...r, ...patch }) : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.items.length || from === to) return;
    const next = [...value.items];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    setItems(next);
  };

  const add = (m: MedicineDto | string) => {
    const row = typeof m === 'string' ? rowFromText(m) : rowFromMedicine(m);
    if (value.items.some((r) => rowKeyOf(r) === rowKeyOf(row))) {
      toast.warning(t('rx.already_added', { name: row.name }));
      return;
    }
    setItems([...value.items, row]);
    setFocusKey(row.key);
  };

  return (
    <div>
      {toolbar && <div className="mb-3 flex flex-wrap items-center gap-2">{toolbar}</div>}
      <MedicinePicker ref={pickerRef} onPick={add} />
      {errors[`${errorPrefix}items`] && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {translateMessage(errors[`${errorPrefix}items`]!)}
        </p>
      )}
      {value.items.length > 0 ? (
        <ol className="mt-3 space-y-2" aria-label={t('rx.medicines')}>
          {value.items.map((r, i) => (
            <li
              key={r.key}
              onDragOver={(e) => dragIndex !== null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
              }}
              className={clsx('rounded-lg border bg-surface p-3', dragIndex === i ? 'border-primary-500 opacity-60' : 'border-border')}
            >
              <RxRowEditor
                row={r}
                index={i}
                count={value.items.length}
                warning={warnings.has(i)}
                errors={errors}
                errorPath={`${errorPrefix}items.${i}`}
                autoFocus={focusKey === r.key}
                onChange={(patch) => update(i, patch)}
                onRemove={() => setItems(value.items.filter((_, j) => j !== i))}
                onMove={(to) => move(i, to)}
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => setDragIndex(null)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-subtle">{t('rx.no_medicines')}</p>
      )}
      <label className="mt-4 block">
        <span className="label">{t('rx.advice')}</span>
        <Textarea rows={3} value={value.advice} maxLength={2000} placeholder={t('rx.advice_placeholder')} onChange={(e) => onChange({ ...value, advice: e.target.value })} />
      </label>
      <p className="mt-2 text-2xs text-ink-subtle">{t('rx.shortcut_hint')}</p>
    </div>
  );
}

function RxRowEditor({
  row: r,
  index,
  count,
  warning,
  errors,
  errorPath,
  autoFocus,
  onChange,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  row: RxRow;
  index: number;
  count: number;
  warning: boolean;
  errors: Record<string, string>;
  errorPath: string;
  autoFocus: boolean;
  onChange: (patch: Partial<RxRow>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const [override, setOverride] = useState<boolean | null>(null);
  const suggestions = useQuery({ queryKey: ['medicines', 'suggestions'], queryFn: medicinesApi.suggestions, staleTime: 2 * 60_000, enabled: !!r.medicineId });
  const favorite = override ?? !!suggestions.data?.favorites.some((m) => m.id === r.medicineId);
  const freqRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) freqRef.current?.focus();
  }, [autoFocus]);
  const err = (field: string) => errors[`${errorPath}.${field}`];
  const chips = [...new Set([...(r.suggestions ?? []), ...DOSE_PATTERNS])].slice(0, 9);
  const canFavorite = !!r.medicineId && !!user?.doctorId && can(PERMISSIONS.PRESCRIPTIONS_CREATE);
  const toggleFavorite = async () => {
    const next = !favorite;
    setOverride(next);
    try {
      await medicinesApi.favorite(r.medicineId!, next);
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
    } catch {
      setOverride(!next);
    }
  };
  const label = `${index + 1}. ${r.name}`;

  return (
    <div>
      <div className="flex items-start gap-2">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className="mt-0.5 cursor-grab text-ink-subtle hover:text-ink"
          title={t('rx.drag')}
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {index + 1}. {r.name}
            {r.strength && <span className="ml-1 font-normal text-ink-muted">{r.strength}</span>}
            {r.form && <span className="ml-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{t(`medicineForm.${r.form}`)}</span>}
          </p>
          {r.genericName && r.genericName.toLowerCase() !== r.name.toLowerCase() && <p className="text-xs text-ink-subtle">{r.genericName}</p>}
          {err('name') && <p className="text-xs text-danger">{translateMessage(err('name')!)}</p>}
          {warning && (
            <Badge tone="warning" className="mt-1">
              <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
              {t('rx.same_generic')}
            </Badge>
          )}
        </div>
        <div className="flex items-center">
          {canFavorite && (
            <button type="button" onClick={() => void toggleFavorite()} aria-pressed={favorite} aria-label={t('rx.favorite')} title={t('rx.favorite')} className="rounded p-1 text-ink-subtle hover:text-warning">
              <Star className={clsx('h-4 w-4', favorite && 'fill-current text-warning')} />
            </button>
          )}
          <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={t('rx.move_up', { name: r.name })} className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={t('rx.move_down', { name: r.name })} className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={t('rx.remove', { name: r.name })} className="rounded p-1 text-ink-subtle hover:bg-canvas hover:text-danger">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-[minmax(5rem,7rem)_minmax(6rem,1fr)_10rem_10rem_5.5rem]">
        <label>
          <span className="label">{t('rx.dose')}</span>
          <Input value={r.dose} maxLength={60} placeholder={t('rx.dose_placeholder')} aria-label={`${label} — ${t('rx.dose')}`} onChange={(e) => onChange({ dose: e.target.value })} />
        </label>
        <label>
          <span className="label">{t('rx.frequency')}</span>
          <Input ref={freqRef} value={r.frequency} maxLength={60} placeholder="1+0+1" aria-label={`${label} — ${t('rx.frequency')}`} onChange={(e) => onChange({ frequency: e.target.value })} />
        </label>
        <label>
          <span className="label">{t('rx.meal')}</span>
          <Select value={r.mealInstruction ?? ''} aria-label={`${label} — ${t('rx.meal')}`} onChange={(e) => onChange({ mealInstruction: (e.target.value || null) as MealInstruction | null })}>
            <option value="">—</option>
            {MEAL_INSTRUCTIONS.map((m) => (
              <option key={m} value={m}>
                {t(`meal.${m}`)}
              </option>
            ))}
          </Select>
        </label>
        <div>
          <span className="label">{t('rx.duration')}</span>
          <div className="flex gap-1">
            <Input
              type="number"
              min={1}
              max={365}
              className="!w-16 shrink-0 !px-2"
              value={r.durationUnit === 'CONTINUE' ? '' : r.durationValue}
              disabled={r.durationUnit === 'CONTINUE'}
              aria-label={`${label} — ${t('rx.duration')}`}
              aria-invalid={err('durationValue') ? true : undefined}
              onChange={(e) => onChange({ durationValue: e.target.value, durationUnit: r.durationUnit ?? 'DAYS' })}
            />
            <Select
              className="!px-1.5"
              value={r.durationUnit ?? ''}
              aria-label={`${label} — ${t('rx.duration_unit')}`}
              aria-invalid={err('durationUnit') ? true : undefined}
              onChange={(e) => onChange({ durationUnit: (e.target.value || null) as DurationUnit | null, ...(e.target.value === 'CONTINUE' ? { durationValue: '' } : {}) })}
            >
              <option value="">—</option>
              {DURATION_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`durationUnit.${u}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label>
          <span className="label">
            {t('rx.quantity')} {r.quantityAuto && r.quantity && <span className="font-normal text-ink-subtle">({t('rx.auto')})</span>}
          </span>
          <Input
            type="number"
            min={1}
            max={9999}
            value={r.quantity}
            aria-label={`${label} — ${t('rx.quantity')}`}
            onChange={(e) => onChange({ quantity: e.target.value, quantityAuto: e.target.value === '' })}
          />
        </label>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`${label} — ${t('rx.patterns')}`}>
        {chips.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange({ frequency: p })}
            aria-pressed={r.frequency === p}
            className={clsx(
              'rounded-full border px-2 py-0.5 font-mono text-2xs',
              r.frequency === p ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-border text-ink-muted hover:border-primary-500 hover:text-primary-800',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[10rem_12rem_1fr]">
        <Select value={r.route ?? ''} aria-label={`${label} — ${t('rx.route')}`} onChange={(e) => onChange({ route: (e.target.value || null) as MedicineRoute | null })}>
          <option value="">{t('rx.route')}</option>
          {MEDICINE_ROUTES.map((x) => (
            <option key={x} value={x}>
              {t(`route.${x}`)}
            </option>
          ))}
        </Select>
        <Input value={r.timing} maxLength={100} placeholder={t('rx.timing_placeholder')} aria-label={`${label} — ${t('rx.timing')}`} onChange={(e) => onChange({ timing: e.target.value })} />
        <Input value={r.instructions} maxLength={300} placeholder={t('rx.instructions_placeholder')} aria-label={`${label} — ${t('rx.instructions')}`} onChange={(e) => onChange({ instructions: e.target.value })} />
      </div>
      {(err('durationValue') || err('durationUnit')) && <p className="mt-1 text-xs text-danger">{translateMessage((err('durationValue') ?? err('durationUnit'))!)}</p>}
    </div>
  );
}

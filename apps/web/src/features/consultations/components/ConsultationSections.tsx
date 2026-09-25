import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { GripVertical, Star, X } from 'lucide-react';
import {
  computeBmi,
  DIAGNOSIS_CERTAINTIES,
  INVESTIGATION_PRIORITIES,
  type DiagnosisCertainty,
  type InvestigationPriority,
  type VitalDefinitionDto,
} from '@chamber/shared';
import { Badge, Input, Select, Textarea } from '@/components/ui';
import { translateMessage } from '@/utils/errors';
import { CatalogPicker } from './CatalogPicker';

export interface ComplaintRow { complaintId: string | null; text: string; duration: string; note: string }
export interface DiagnosisRow { diagnosisId: string | null; name: string; code: string | null; isPrimary: boolean; certainty: DiagnosisCertainty; note: string }
export interface InvestigationRow { investigationId: string | null; name: string; instructions: string; priority: InvestigationPriority }

export function Section({ id, title, children, error, aside }: { id: string; title: string; children: ReactNode; error?: string; aside?: ReactNode }) {
  return (
    <section id={id} className={clsx('card scroll-mt-20 p-4 sm:p-5', error && 'border-danger/40')} aria-labelledby={`${id}-title`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {error && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {translateMessage(error)}
        </p>
      )}
      {children}
    </section>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="rounded p-1 text-ink-subtle hover:bg-canvas hover:text-danger">
      <X className="h-4 w-4" />
    </button>
  );
}

export function ComplaintsSection({ rows, onChange, error }: { rows: ComplaintRow[]; onChange: (rows: ComplaintRow[]) => void; error?: string }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<ComplaintRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Section id="sec-complaints" title={t('consultation.complaints')} error={error}>
      <CatalogPicker
        kind="complaints"
        placeholder={t('consultation.complaint_placeholder')}
        exclude={rows.map((r) => r.text)}
        onPick={(item) => onChange([...rows, { complaintId: item.id, text: item.name, duration: '', note: '' }])}
      />
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.text}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/40 px-3 py-2">
              <span className="min-w-[8rem] flex-1 text-sm font-medium text-ink">{r.text}</span>
              <Input
                aria-label={`${r.text} — ${t('consultation.duration')}`}
                className="!w-40"
                placeholder={t('consultation.duration_placeholder')}
                value={r.duration}
                maxLength={60}
                onChange={(e) => set(i, { duration: e.target.value })}
              />
              <RemoveButton label={t('consultation.remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function HistorySection({ values, onChange }: { values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  const { t } = useTranslation();
  const fields = [
    ['presentIllness', 'present_illness', 3],
    ['pastHistory', 'past_history', 2],
    ['familyHistory', 'family_history', 2],
    ['medicationHistory', 'medication_history', 2],
    ['otherHistory', 'other_history', 2],
  ] as const;
  return (
    <Section id="sec-history" title={t('consultation.history')}>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map(([key, label, rows]) => (
          <label key={key} className={key === 'presentIllness' ? 'md:col-span-2' : undefined}>
            <span className="label">{t(`consultation.${label}`)}</span>
            <Textarea rows={rows} value={values[key] ?? ''} maxLength={key === 'presentIllness' || key === 'pastHistory' ? 4000 : 2000} onChange={(e) => onChange(key, e.target.value)} />
          </label>
        ))}
      </div>
    </Section>
  );
}

export function ExaminationSection({
  definitions,
  values,
  recordedBy,
  onChange,
  notes,
  onNotes,
  errors,
}: {
  definitions: VitalDefinitionDto[];
  values: Record<string, string>;
  recordedBy: Record<string, string | null>;
  onChange: (definitionId: string, value: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const byKey = Object.fromEntries(definitions.map((d) => [d.key, d]));
  const bmi = byKey.weight && byKey.height ? computeBmi(Number(values[byKey.weight.id]), Number(values[byKey.height.id])) : null;
  return (
    <Section id="sec-exam" title={t('consultation.examination')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {definitions.map((d) => {
          const error = errors[d.id];
          return (
            <label key={d.id} className="block">
              <span className="label">
                {d.label}
                {d.unit && <span className="font-normal text-ink-subtle"> ({d.unit})</span>}
              </span>
              <Input
                inputMode={d.type === 'TEXT' ? 'text' : 'decimal'}
                placeholder={d.type === 'BLOOD_PRESSURE' ? '120/80' : d.minValue !== null && d.maxValue !== null ? `${d.minValue}–${d.maxValue}` : ''}
                value={values[d.id] ?? ''}
                aria-invalid={error ? true : undefined}
                title={recordedBy[d.id] ? t('consultation.recorded_by', { name: recordedBy[d.id] }) : undefined}
                onChange={(e) => onChange(d.id, e.target.value)}
              />
              {error && <span className="mt-0.5 block text-2xs text-danger">{translateMessage(error)}</span>}
            </label>
          );
        })}
        {bmi !== null && (
          <div>
            <span className="label">{t('consultation.bmi')}</span>
            <p className="flex h-9 items-center rounded border border-dashed border-border px-3 text-sm font-medium text-ink">
              {bmi} <span className="ml-1 text-2xs text-ink-subtle">kg/m²</span>
            </p>
          </div>
        )}
      </div>
      <label className="mt-4 block">
        <span className="label">{t('consultation.exam_notes')}</span>
        <Textarea rows={3} value={notes} maxLength={4000} onChange={(e) => onNotes(e.target.value)} />
      </label>
    </Section>
  );
}

export function DiagnosisSection({ rows, onChange, error }: { rows: DiagnosisRow[]; onChange: (rows: DiagnosisRow[]) => void; error?: string }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<DiagnosisRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const makePrimary = (i: number) => onChange(rows.map((r, j) => ({ ...r, isPrimary: j === i })));
  return (
    <Section id="sec-diagnosis" title={t('consultation.diagnosis')} error={error}>
      <CatalogPicker
        kind="diagnoses"
        placeholder={t('consultation.diagnosis_placeholder')}
        exclude={rows.map((r) => r.name)}
        // The first diagnosis is pre-marked as primary for convenience; the doctor can change it.
        onPick={(item) => onChange([...rows, { diagnosisId: item.id, name: item.name, code: item.code ?? null, isPrimary: rows.length === 0, certainty: 'CONFIRMED', note: '' }])}
      />
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={clsx('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2', r.isPrimary ? 'border-primary-200 bg-primary-50/60' : 'border-border bg-canvas/40')}>
              <button
                type="button"
                onClick={() => makePrimary(i)}
                aria-pressed={r.isPrimary}
                aria-label={t('consultation.make_primary')}
                title={t('consultation.make_primary')}
                className={clsx('rounded p-1', r.isPrimary ? 'text-primary-700' : 'text-ink-subtle hover:text-primary-700')}
              >
                <Star className={clsx('h-4 w-4', r.isPrimary && 'fill-current')} />
              </button>
              <span className="min-w-[10rem] flex-1 text-sm font-medium text-ink">
                {r.name} {r.code && <span className="font-mono text-2xs text-ink-subtle">{r.code}</span>}
              </span>
              <Badge tone={r.isPrimary ? 'primary' : 'neutral'}>{r.isPrimary ? t('consultation.primary') : t('consultation.secondary')}</Badge>
              <Select aria-label={t('consultation.certainty')} className="!w-36" value={r.certainty} onChange={(e) => set(i, { certainty: e.target.value as DiagnosisCertainty })}>
                {DIAGNOSIS_CERTAINTIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`certainty.${c}`)}
                  </option>
                ))}
              </Select>
              <RemoveButton
                label={t('consultation.remove')}
                onClick={() => {
                  const next = rows.filter((_, j) => j !== i);
                  onChange(next);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function InvestigationsSection({ rows, onChange }: { rows: InvestigationRow[]; onChange: (rows: InvestigationRow[]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<InvestigationRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <Section id="sec-investigations" title={t('consultation.investigations')}>
      <CatalogPicker
        kind="investigations"
        placeholder={t('consultation.investigation_placeholder')}
        exclude={rows.map((r) => r.name)}
        onPick={(item) => onChange([...rows, { investigationId: item.id, name: item.name, instructions: '', priority: 'ROUTINE' }])}
      />
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li
              key={`${r.name}-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/40 px-3 py-2"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => move(Number(e.dataTransfer.getData('text/plain')), i)}
            >
              <GripVertical className="h-4 w-4 cursor-grab text-ink-subtle" aria-hidden />
              <span className="min-w-[10rem] flex-1 text-sm font-medium text-ink">{r.name}</span>
              <Input aria-label={`${r.name} — ${t('consultation.instructions')}`} className="!w-48" placeholder={t('consultation.instructions')} value={r.instructions} maxLength={300} onChange={(e) => set(i, { instructions: e.target.value })} />
              <Select aria-label={t('consultation.priority')} className="!w-32" value={r.priority} onChange={(e) => set(i, { priority: e.target.value as InvestigationPriority })}>
                {INVESTIGATION_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </Select>
              <RemoveButton label={t('consultation.remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function FollowUpSection({
  date,
  instructions,
  onDate,
  onInstructions,
  today,
  addDays,
  error,
}: {
  date: string;
  instructions: string;
  onDate: (d: string) => void;
  onInstructions: (v: string) => void;
  today: string;
  addDays: (d: string, n: number) => string;
  error?: string;
}) {
  const { t } = useTranslation();
  const presets: [number, string][] = [
    [3, t('consultation.days', { count: 3 })],
    [7, t('consultation.days', { count: 7 })],
    [14, t('consultation.weeks', { count: 2 })],
    [30, t('consultation.days', { count: 30 })],
  ];
  return (
    <Section id="sec-followup" title={t('consultation.follow_up')} error={error}>
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2 text-xs text-ink-muted">{t('consultation.follow_up_after')}:</span>
        {presets.map(([days, label]) => {
          const d = addDays(today, days);
          return (
            <button
              key={days}
              type="button"
              aria-pressed={date === d}
              onClick={() => onDate(d)}
              className={clsx('rounded-full border px-3 py-1 text-xs font-medium', date === d ? 'border-primary-700 bg-primary-700 text-white' : 'border-border text-ink-muted hover:bg-canvas')}
            >
              {label}
            </button>
          );
        })}
        <label className="ml-auto">
          <span className="label">{t('consultation.follow_up_date')}</span>
          <Input type="date" min={addDays(today, 1)} className="!w-44" value={date} onChange={(e) => onDate(e.target.value)} />
        </label>
        {date && (
          <button type="button" className="pb-2 text-xs text-ink-muted hover:text-danger" onClick={() => onDate('')}>
            {t('consultation.no_follow_up')}
          </button>
        )}
      </div>
      <label className="mt-3 block">
        <span className="label">{t('consultation.follow_up_instructions')}</span>
        <Input value={instructions} maxLength={500} onChange={(e) => onInstructions(e.target.value)} />
      </label>
    </Section>
  );
}

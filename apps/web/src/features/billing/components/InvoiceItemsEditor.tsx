import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { computeInvoiceTotals, discountFromPercent, INVOICE_ITEM_TYPES, type DoctorDto, type InvoiceItemType } from '@chamber/shared';
import { Input, Select } from '@/components/ui';
import { feeItemsApi } from '@/services/endpoints';
import { translateMessage } from '@/utils/errors';
import { useMoney } from '../money';

export interface ItemDraft {
  key: string;
  type: InvoiceItemType;
  description: string;
  quantity: string;
  unitPrice: string;
  feeItemId: string | null;
}

export interface BillDraft {
  items: ItemDraft[];
  discountMode: 'amount' | 'percent';
  discountValue: string;
  discountReason: string;
  notes: string;
}

let seq = 0;
export const itemKey = () => `it-${++seq}`;
export const itemDraft = (i: { type: string; description: string; quantity?: number; unitPrice: number; feeItemId?: string | null }): ItemDraft => ({
  key: itemKey(),
  type: i.type as InvoiceItemType,
  description: i.description,
  quantity: String(i.quantity ?? 1),
  unitPrice: String(i.unitPrice),
  feeItemId: i.feeItemId ?? null,
});

/** Totals and API fields for a bill draft (discount entered as amount or percentage). */
export function billTotals(d: BillDraft) {
  const items = d.items.map((i) => ({ quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0 }));
  const { subtotal } = computeInvoiceTotals(items, 0);
  const v = Number(d.discountValue) || 0;
  const discountAmount = d.discountMode === 'percent' ? discountFromPercent(subtotal, Math.min(v, 100)) : v;
  const totals = computeInvoiceTotals(items, discountAmount);
  return { ...totals, discountAmount, discountPercent: d.discountMode === 'percent' && v > 0 ? Math.min(v, 100) : null };
}

export function billPayload(d: BillDraft) {
  const t = billTotals(d);
  return {
    items: d.items.map((i) => ({ type: i.type, description: i.description.trim(), quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0, feeItemId: i.feeItemId })),
    discountAmount: t.discount,
    discountPercent: t.discountPercent,
    discountReason: t.discount > 0 ? d.discountReason.trim() || null : null,
    notes: d.notes.trim() || null,
  };
}

/**
 * Bill lines with one-click fees (doctor fees and the chamber fee schedule),
 * discount as amount or percentage and live totals (spec §18).
 */
export function InvoiceItemsEditor({
  value,
  onChange,
  doctor,
  canDiscount,
  errors = {},
}: {
  value: BillDraft;
  onChange: (d: BillDraft) => void;
  doctor?: DoctorDto | null;
  canDiscount: boolean;
  errors?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const fees = useQuery({ queryKey: ['fee-items'], queryFn: () => feeItemsApi.list(), staleTime: 5 * 60_000 });
  const totals = billTotals(value);
  const set = (i: number, patch: Partial<ItemDraft>) => onChange({ ...value, items: value.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const add = (item: Omit<ItemDraft, 'key'>) => {
    if (item.feeItemId && value.items.some((r) => r.feeItemId === item.feeItemId)) return;
    onChange({ ...value, items: [...value.items, { ...item, key: itemKey() }] });
  };
  const doctorFees = doctor
    ? ([
        ['CONSULTATION', t('billing.fee_consultation', { name: doctor.fullName }), doctor.consultationFee],
        ['FOLLOW_UP', t('billing.fee_follow_up', { name: doctor.fullName }), doctor.followUpFee],
        ['CONSULTATION', t('billing.fee_report_review', { name: doctor.fullName }), doctor.reportReviewFee],
      ] as const).filter(([, , amount]) => amount !== null)
    : [];
  const err = (k: string) => (errors[k] ? translateMessage(errors[k]) : undefined);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{t('billing.quick_add')}:</span>
        {doctorFees.map(([type, description, amount]) => (
          <Chip key={description} label={`${description} · ${money(amount)}`} onClick={() => add({ type, description, quantity: '1', unitPrice: String(amount), feeItemId: null })} />
        ))}
        {(fees.data ?? []).map((f) => (
          <Chip
            key={f.id}
            label={`${f.name} · ${money(f.amount)}`}
            onClick={() => add({ type: f.kind as InvoiceItemType, description: f.name, quantity: '1', unitPrice: String(f.amount), feeItemId: f.id })}
          />
        ))}
        <Chip label={t('billing.custom_line')} icon onClick={() => add({ type: 'OTHER', description: '', quantity: '1', unitPrice: '', feeItemId: null })} />
      </div>
      {err('items') && <p className="mt-2 text-xs text-danger">{err('items')}</p>}

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-44">{t('billing.type')}</th>
              <th>{t('billing.description')}</th>
              <th className="w-20 text-right">{t('billing.qty')}</th>
              <th className="w-32 text-right">{t('billing.unit_price')}</th>
              <th className="w-28 text-right">{t('billing.line_total')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {value.items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-ink-subtle">
                  {t('billing.no_items')}
                </td>
              </tr>
            )}
            {value.items.map((r, i) => (
              <tr key={r.key}>
                <td className="!py-2">
                  <Select aria-label={t('billing.type')} value={r.type} onChange={(e) => set(i, { type: e.target.value as InvoiceItemType })}>
                    {INVOICE_ITEM_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`invoiceItemType.${x}`)}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="!py-2">
                  <Input aria-label={t('billing.description')} value={r.description} maxLength={200} aria-invalid={err(`items.${i}.description`) ? true : undefined} onChange={(e) => set(i, { description: e.target.value })} />
                </td>
                <td className="!py-2">
                  <Input aria-label={t('billing.qty')} type="number" min={1} max={100} className="text-right" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
                </td>
                <td className="!py-2">
                  <Input
                    aria-label={`${r.description || t('billing.line')} — ${t('billing.unit_price')}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="text-right"
                    value={r.unitPrice}
                    aria-invalid={err(`items.${i}.unitPrice`) ? true : undefined}
                    onChange={(e) => set(i, { unitPrice: e.target.value })}
                  />
                </td>
                <td className="!py-2 text-right font-medium tabular-nums">{money((Number(r.unitPrice) || 0) * (Number(r.quantity) || 0))}</td>
                <td className="!py-2">
                  <button type="button" onClick={() => onChange({ ...value, items: value.items.filter((_, j) => j !== i) })} aria-label={t('billing.remove_line', { name: r.description })} className="rounded p-1 text-ink-subtle hover:text-danger">
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          {canDiscount ? (
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div>
                <span className="label">{t('billing.discount')}</span>
                <div className="flex gap-1">
                  <Input
                    aria-label={t('billing.discount')}
                    type="number"
                    min={0}
                    step="0.01"
                    value={value.discountValue}
                    aria-invalid={err('discountAmount') ? true : undefined}
                    onChange={(e) => onChange({ ...value, discountValue: e.target.value })}
                  />
                  <Select aria-label={t('billing.discount_mode')} className="!w-20" value={value.discountMode} onChange={(e) => onChange({ ...value, discountMode: e.target.value as BillDraft['discountMode'] })}>
                    <option value="amount">{t('billing.amount_short')}</option>
                    <option value="percent">%</option>
                  </Select>
                </div>
                {err('discountAmount') && <p className="mt-0.5 text-2xs text-danger">{err('discountAmount')}</p>}
              </div>
              <label>
                <span className="label">{t('billing.discount_reason')}</span>
                <Input value={value.discountReason} maxLength={300} disabled={!totals.discount} aria-invalid={err('discountReason') ? true : undefined} placeholder={t('billing.discount_reason_placeholder')} onChange={(e) => onChange({ ...value, discountReason: e.target.value })} />
                {err('discountReason') && <span className="mt-0.5 block text-2xs text-danger">{err('discountReason')}</span>}
              </label>
            </div>
          ) : (
            <p className="text-xs text-ink-subtle">{t('billing.discount_manager_only')}</p>
          )}
          <label className="block">
            <span className="label">{t('billing.notes')}</span>
            <Input value={value.notes} maxLength={500} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
          </label>
        </div>
        <dl className="space-y-1 rounded-lg bg-canvas p-4 text-sm" aria-live="polite">
          <Row label={t('billing.subtotal')} value={money(totals.subtotal)} />
          {totals.discount > 0 && <Row label={t('billing.discount')} value={`− ${money(totals.discount)}`} />}
          <div className="border-t border-border pt-1">
            <Row label={t('billing.total')} value={money(totals.total)} strong />
          </div>
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</dt>
      <dd className={strong ? 'text-base font-semibold tabular-nums text-ink' : 'tabular-nums text-ink'}>{value}</dd>
    </div>
  );
}

function Chip({ label, onClick, icon }: { label: string; onClick: () => void; icon?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-ink-muted hover:border-primary-500 hover:bg-primary-50 hover:text-primary-800">
      {icon ? <Plus className="h-3 w-3" aria-hidden /> : '+'} {label}
    </button>
  );
}

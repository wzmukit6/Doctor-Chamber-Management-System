import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, Ban, Banknote, Pencil, Printer, Undo2 } from 'lucide-react';
import { PERMISSIONS, type InvoiceDto } from '@chamber/shared';
import { Button, ConfirmDialog, ErrorState, Field, Input, Modal, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { invoicesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors } from '@/hooks/useChamber';
import { errorMessage, translateMessage } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { InvoiceStatusBadge } from './components/InvoiceStatusBadge';
import { billPayload, InvoiceItemsEditor, itemDraft, type BillDraft } from './components/InvoiceItemsEditor';
import { emptyPayment, PaymentFields, paymentPayload, type PaymentDraft } from './components/PaymentFields';
import { useMoney } from './money';

/** Bill with its payment ledger (spec §18). Payments/refunds are separate entries; bills are voided, never deleted. */
export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const money = useMoney();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['invoices', id], queryFn: () => invoicesApi.get(id!) });
  const [dialog, setDialog] = useState<'pay' | 'refund' | 'edit' | 'void' | null>(null);
  const [busy, setBusy] = useState(false);
  const inv = q.data;

  const done = (data: InvoiceDto, message: string) => {
    queryClient.setQueryData(['invoices', id], data);
    void queryClient.invalidateQueries({ queryKey: ['invoices', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices', 'summary'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    toast.success(message);
    setDialog(null);
  };

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  if (q.isError || !inv) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const open = inv.status !== 'VOID';

  const voidBill = async (reason: string) => {
    setBusy(true);
    try {
      done(await invoicesApi.void(inv.id, reason, inv.version), t('billing.voided'));
    } catch (err) {
      toast.error(errorMessage(err));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <Link to="/billing" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('nav.billing')}
      </Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">
          {t('billing.invoice')} <span className="font-mono">{inv.invoiceNumber}</span>
        </h1>
        <InvoiceStatusBadge status={inv.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {open && can(PERMISSIONS.BILLING_UPDATE) && (
            <>
              <Button size="sm" variant="ghost" className="text-danger" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog('void')}>
                {t('billing.void')}
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog('edit')}>
                {t('common.edit')}
              </Button>
            </>
          )}
          {open && inv.paid > 0 && can(PERMISSIONS.BILLING_REFUND) && (
            <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog('refund')}>
              {t('billing.refund')}
            </Button>
          )}
          <Link to={`/billing/invoices/${inv.id}/print`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-canvas">
            <Printer className="h-4 w-4" aria-hidden /> {t('billing.print_receipt')}
          </Link>
          {open && inv.due > 0 && can(PERMISSIONS.BILLING_CREATE) && (
            <Button size="sm" icon={<Banknote className="h-4 w-4" />} onClick={() => setDialog('pay')}>
              {t('billing.collect', { amount: money(inv.due) })}
            </Button>
          )}
        </div>
      </div>

      {inv.status === 'VOID' && (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-canvas px-4 py-2 text-sm text-ink-muted">
          {t('billing.void_banner', { time: formatDateTime(inv.voidedAt), reason: inv.voidReason })}
        </p>
      )}

      <div className="card mb-4 grid gap-3 p-4 text-sm sm:grid-cols-4">
        <Info label={t('appointments.patient')}>
          {can(PERMISSIONS.PATIENTS_VIEW) ? (
            <Link to={`/patients/${inv.patient.id}`} className="font-medium hover:underline">
              {inv.patient.fullName}
            </Link>
          ) : (
            inv.patient.fullName
          )}
          <span className="block font-mono text-2xs text-ink-subtle">{inv.patient.patientCode}</span>
        </Info>
        <Info label={t('appointments.doctor')}>{inv.doctor?.fullName ?? '—'}</Info>
        <Info label={t('billing.issued')}>
          {formatDateTime(inv.issuedAt)}
          <span className="block text-2xs text-ink-subtle">{inv.createdByName}</span>
        </Info>
        <div className="grid grid-cols-3 gap-2 text-center sm:text-right">
          <Amount label={t('billing.total')} value={money(inv.total)} />
          <Amount label={t('billing.paid')} value={money(inv.paid)} tone="success" />
          <Amount label={t('billing.due')} value={money(inv.due)} tone={inv.due > 0 ? 'danger' : undefined} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="card overflow-hidden" aria-labelledby="items-title">
          <h2 id="items-title" className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
            {t('billing.items')}
          </h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('billing.description')}</th>
                <th className="text-right">{t('billing.qty')}</th>
                <th className="text-right">{t('billing.unit_price')}</th>
                <th className="text-right">{t('billing.line_total')}</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.description}
                    <span className="block text-2xs text-ink-subtle">{t(`invoiceItemType.${i.type}`)}</span>
                  </td>
                  <td className="text-right tabular-nums">{i.quantity}</td>
                  <td className="text-right tabular-nums">{money(i.unitPrice)}</td>
                  <td className="text-right font-medium tabular-nums">{money(i.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <TotalRow label={t('billing.subtotal')} value={money(inv.subtotal)} />
              {inv.discountAmount > 0 && (
                <TotalRow
                  label={`${t('billing.discount')}${inv.discountPercent ? ` (${inv.discountPercent}%)` : ''}${inv.discountReason ? ` — ${inv.discountReason}` : ''}`}
                  value={`− ${money(inv.discountAmount)}`}
                />
              )}
              <TotalRow label={t('billing.total')} value={money(inv.total)} strong />
            </tfoot>
          </table>
          {inv.notes && <p className="border-t border-border px-4 py-3 text-xs text-ink-muted">{inv.notes}</p>}
        </section>

        <section className="card p-4" aria-labelledby="ledger-title">
          <h2 id="ledger-title" className="mb-3 text-sm font-semibold text-ink">
            {t('billing.payments')}
          </h2>
          {inv.payments.length === 0 ? (
            <p className="text-sm text-ink-subtle">{t('billing.no_payments')}</p>
          ) : (
            <ol className="space-y-2">
              {inv.payments.map((p) => (
                <li key={p.id} className={clsx('rounded-lg border px-3 py-2', p.kind === 'REFUND' ? 'border-danger/20 bg-danger-soft/40' : 'border-border')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-ink-muted">{p.receiptNumber}</span>
                    <span className={clsx('font-semibold tabular-nums', p.kind === 'REFUND' ? 'text-danger' : 'text-success')}>
                      {p.kind === 'REFUND' ? '− ' : '+ '}
                      {money(p.amount)}
                    </span>
                  </div>
                  <p className="text-xs text-ink">
                    {p.kind === 'REFUND' ? t('billing.refund') : t(`paymentMethod.${p.method}`)}
                    {p.kind === 'REFUND' && ` · ${t(`paymentMethod.${p.method}`)}`}
                    {p.provider && ` · ${p.provider}`}
                    {p.reference && <span className="text-ink-subtle"> · {p.reference}</span>}
                  </p>
                  <p className="text-2xs text-ink-subtle">
                    {formatDateTime(p.receivedAt)} · {p.receivedByName}
                  </p>
                  {(p.reason || p.note) && <p className="mt-0.5 text-2xs italic text-ink-muted">{p.reason ?? p.note}</p>}
                </li>
              ))}
            </ol>
          )}
          {inv.refunded > 0 && <p className="mt-3 text-xs text-ink-muted">{t('billing.refunded_total', { amount: money(inv.refunded) })}</p>}
        </section>
      </div>

      <PaymentModal inv={inv} open={dialog === 'pay'} onClose={() => setDialog(null)} onDone={(d) => done(d, t('billing.payment_recorded'))} />
      <RefundModal inv={inv} open={dialog === 'refund'} onClose={() => setDialog(null)} onDone={(d) => done(d, t('billing.refunded'))} />
      <EditModal inv={inv} open={dialog === 'edit'} onClose={() => setDialog(null)} onDone={(d) => done(d, t('billing.updated'))} />
      <ConfirmDialog
        open={dialog === 'void'}
        title={t('billing.void_title')}
        body={inv.paid > 0 ? t('billing.void_has_payments') : t('billing.void_body')}
        requireReason
        confirmLabel={t('billing.void')}
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void voidBill(reason)}
      />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-subtle">{label}</p>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function Amount({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div>
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={clsx('font-semibold tabular-nums', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</p>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td colSpan={3} className={clsx('!py-2 text-right', strong ? 'font-semibold text-ink' : 'text-ink-muted')}>
        {label}
      </td>
      <td className={clsx('!py-2 text-right tabular-nums', strong ? 'text-base font-semibold' : '')}>{value}</td>
    </tr>
  );
}

function useErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();
  const handle = (err: unknown) => {
    if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
    else toast.error(errorMessage(err));
  };
  return { errors, setErrors, handle };
}

function PaymentModal({ inv, open, onClose, onDone }: { inv: InvoiceDto; open: boolean; onClose: () => void; onDone: (d: InvoiceDto) => void }) {
  const { t } = useTranslation();
  const [p, setP] = useState<PaymentDraft>(emptyPayment());
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, handle } = useErrors();
  useEffect(() => {
    if (open) (setP(emptyPayment(String(inv.due))), setErrors({}));
  }, [open, inv.due, setErrors]);
  const save = async () => {
    setSaving(true);
    try {
      onDone(await invoicesApi.pay(inv.id, { ...paymentPayload(p), version: inv.version }));
    } catch (err) {
      handle(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('billing.record_payment')}
      description={t('billing.due_now', { number: inv.invoiceNumber })}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!(Number(p.amount) > 0)} onClick={() => void save()}>
            {t('billing.record_payment')}
          </Button>
        </>
      }
    >
      <PaymentFields value={p} onChange={setP} errors={errors} />
    </Modal>
  );
}

function RefundModal({ inv, open, onClose, onDone }: { inv: InvoiceDto; open: boolean; onClose: () => void; onDone: (d: InvoiceDto) => void }) {
  const { t } = useTranslation();
  const [p, setP] = useState<PaymentDraft>(emptyPayment());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, handle } = useErrors();
  useEffect(() => {
    if (open) (setP(emptyPayment(String(inv.paid))), setReason(''), setErrors({}));
  }, [open, inv.paid, setErrors]);
  const save = async () => {
    setSaving(true);
    try {
      const { note: _n, ...pay } = paymentPayload(p);
      onDone(await invoicesApi.refund(inv.id, { ...pay, reason: reason.trim(), version: inv.version }));
    } catch (err) {
      handle(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('billing.refund')}
      description={t('billing.refund_help')}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={saving} disabled={!(Number(p.amount) > 0) || !reason.trim()} onClick={() => void save()}>
            {t('billing.refund')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PaymentFields value={p} onChange={setP} errors={errors} showNote={false} />
        <Field label={t('billing.refund_reason')} error={errors.reason ? translateMessage(errors.reason) : undefined}>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ inv, open, onClose, onDone }: { inv: InvoiceDto; open: boolean; onClose: () => void; onDone: (d: InvoiceDto) => void }) {
  const { t } = useTranslation();
  const doctors = useDoctors();
  const [bill, setBill] = useState<BillDraft | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, handle } = useErrors();
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setReason('');
    setBill({
      items: inv.items.map(itemDraft),
      discountMode: inv.discountPercent ? 'percent' : 'amount',
      discountValue: inv.discountPercent ? String(inv.discountPercent) : inv.discountAmount ? String(inv.discountAmount) : '',
      discountReason: inv.discountReason ?? '',
      notes: inv.notes ?? '',
    });
  }, [open, inv, setErrors]);
  const save = async () => {
    if (!bill) return;
    setSaving(true);
    try {
      onDone(await invoicesApi.update(inv.id, { ...billPayload(bill), reason: reason.trim(), version: inv.version }));
    } catch (err) {
      handle(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('billing.edit_title', { number: inv.invoiceNumber })}
      description={inv.paid > 0 ? t('billing.edit_paid_hint', { amount: inv.paid }) : undefined}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!reason.trim() || !bill?.items.length} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {bill && (
        <div className="space-y-4">
          <InvoiceItemsEditor value={bill} onChange={setBill} doctor={doctors.data?.find((d) => d.id === inv.doctor?.id)} canDiscount errors={errors} />
          <Field label={t('billing.change_reason')} error={errors.reason ? translateMessage(errors.reason) : undefined}>
            <Input value={reason} maxLength={300} placeholder={t('billing.change_reason_placeholder')} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

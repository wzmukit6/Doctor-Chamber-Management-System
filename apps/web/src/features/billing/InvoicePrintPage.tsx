import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, ErrorState, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { invoicesApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { formatAmount } from './money';

function fmt(iso: string, timeZone: string, lang: string) {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** Printable bill / money receipt (A5), with every payment and refund listed. */
export function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['invoices', id, 'print'], queryFn: () => invoicesApi.printData(id!), refetchOnWindowFocus: false });
  const d = q.data;

  useEffect(() => {
    if (!d) return;
    const style = document.createElement('style');
    style.textContent = '@media print { @page { size: A5; margin: 8mm; } }';
    document.head.appendChild(style);
    document.title = `${d.invoice.invoiceNumber} — ${d.invoice.patient.fullName}`;
    return () => style.remove();
  }, [d]);

  if (q.isLoading) return <Skeleton className="mx-auto mt-8 h-[40rem] max-w-[148mm]" />;
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  if (q.isError || !d) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const inv = d.invoice;
  const lang = i18n.language;
  const m = (v: number) => formatAmount(v, d.settings.currencySymbol, lang);
  const tz = d.chamber.timezone;
  const print = async () => {
    try {
      await invoicesApi.logPrint(inv.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
    window.print();
  };

  return (
    <div className="min-h-screen bg-canvas py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[148mm] items-center gap-3 px-4">
        <Link to={`/billing/invoices/${inv.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('billing.back_to_invoice')}
        </Link>
        <Button className="ml-auto" icon={<Printer className="h-4 w-4" />} onClick={() => void print()}>
          {t('billing.print_receipt')}
        </Button>
      </div>
      <article className="relative mx-auto max-w-[148mm] bg-white px-[10mm] py-[8mm] text-[11.5px] leading-snug text-black shadow-card print:max-w-none print:p-0 print:shadow-none" aria-label={t('billing.receipt')}>
        {inv.status === 'VOID' && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span style={{ transform: 'rotate(-25deg)' }} className="text-[56px] font-bold uppercase tracking-widest text-black/10">
              {t('invoiceStatus.VOID')}
            </span>
          </div>
        )}
        <div className="border-b-2 border-primary-700 pb-2 text-center">
          {d.chamber.logoDataUrl && <img src={d.chamber.logoDataUrl} alt="" className="mx-auto mb-1 max-h-[12mm] max-w-[40mm] object-contain" />}
          <p className="text-[15px] font-bold text-primary-800">{d.chamber.name}</p>
          {d.chamber.address && <p className="text-[10.5px]">{d.chamber.address}</p>}
          <p className="text-[10.5px]">{[d.chamber.phone, d.chamber.email].filter(Boolean).join(' · ')}</p>
        </div>
        <p className="mt-2 text-center text-[12px] font-semibold uppercase tracking-wide">{t('billing.receipt_title')}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-neutral-600">{t('billing.invoice_no')}</dt>
          <dd className="font-mono font-semibold">{inv.invoiceNumber}</dd>
          <dt className="text-neutral-600">{t('billing.date')}</dt>
          <dd>{fmt(inv.issuedAt, tz, lang)}</dd>
          <dt className="text-neutral-600">{t('appointments.patient')}</dt>
          <dd className="font-semibold">{inv.patient.fullName}</dd>
          <dt className="text-neutral-600">{t('patients.patient_id')}</dt>
          <dd className="font-mono">{inv.patient.patientCode}</dd>
          {inv.doctor && (
            <>
              <dt className="text-neutral-600">{t('appointments.doctor')}</dt>
              <dd className="col-span-3">{inv.doctor.fullName}</dd>
            </>
          )}
        </dl>
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-neutral-400 text-left">
              <th className="py-1">{t('billing.description')}</th>
              <th className="py-1 text-right">{t('billing.qty')}</th>
              <th className="py-1 text-right">{t('billing.unit_price')}</th>
              <th className="py-1 text-right">{t('billing.line_total')}</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id} className="border-b border-neutral-200">
                <td className="py-1">{i.description}</td>
                <td className="py-1 text-right">{i.quantity}</td>
                <td className="py-1 text-right">{m(i.unitPrice)}</td>
                <td className="py-1 text-right">{m(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-2 w-[60%] space-y-0.5 text-[11px]">
          <Line label={t('billing.subtotal')} value={m(inv.subtotal)} />
          {inv.discountAmount > 0 && <Line label={`${t('billing.discount')}${inv.discountReason ? ` (${inv.discountReason})` : ''}`} value={`− ${m(inv.discountAmount)}`} />}
          <Line label={t('billing.total')} value={m(inv.total)} strong />
          <Line label={t('billing.paid')} value={m(inv.paid)} />
          <Line label={t('billing.due')} value={m(inv.due)} strong />
        </dl>
        {inv.payments.length > 0 && (
          <div className="mt-3 border-t border-neutral-300 pt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-primary-800">{t('billing.payments')}</p>
            {inv.payments.map((p) => (
              <p key={p.id} className="flex justify-between gap-2 text-[10.5px]">
                <span>
                  <span className="font-mono">{p.receiptNumber}</span> · {fmt(p.receivedAt, tz, lang)} · {p.kind === 'REFUND' ? t('billing.refund') : t(`paymentMethod.${p.method}`)}
                  {p.provider && ` (${p.provider})`}
                </span>
                <span className="font-medium">
                  {p.kind === 'REFUND' ? '− ' : ''}
                  {m(p.amount)}
                </span>
              </p>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-end justify-between">
          <p className="text-[18px] font-bold uppercase tracking-widest text-primary-800/80">{inv.status === 'PAID' ? t('invoiceStatus.PAID') : inv.status === 'VOID' ? '' : t('billing.due_stamp')}</p>
          <div className="min-w-[40mm] text-center">
            <div className="h-7" />
            <p className="border-t border-black pt-0.5 text-[10px]">{inv.payments.filter((p) => p.kind === 'PAYMENT').at(-1)?.receivedByName ?? inv.createdByName}</p>
            <p className="text-[9px] text-neutral-600">{t('billing.received_by')}</p>
          </div>
        </div>
        {d.settings.receiptFooter && <p className="mt-3 text-center text-[10px] text-neutral-600">{d.settings.receiptFooter}</p>}
      </article>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-neutral-600'}>{label}</dt>
      <dd className={strong ? 'font-semibold' : ''}>{value}</dd>
    </div>
  );
}

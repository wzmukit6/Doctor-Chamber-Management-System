import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Receipt } from 'lucide-react';
import { PERMISSIONS, type PatientSummaryDto } from '@chamber/shared';
import { Button, ErrorState, Field, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { invoicesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDoctors } from '@/hooks/useChamber';
import { errorMessage } from '@/utils/errors';
import { PatientPicker } from '@/features/appointments/components/PatientPicker';
import { billPayload, billTotals, InvoiceItemsEditor, itemDraft, type BillDraft } from './components/InvoiceItemsEditor';
import { emptyPayment, PaymentFields, paymentPayload, type PaymentDraft } from './components/PaymentFields';
import { useMoney } from './money';

const emptyBill = (): BillDraft => ({ items: [], discountMode: 'amount', discountValue: '', discountReason: '', notes: '' });

/** New bill — for a visit (pre-filled with the doctor's fee) or a walk-in charge; payment can be taken at once. */
export function NewInvoicePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const money = useMoney();
  const { can } = useAuth();
  const doctors = useDoctors();
  const [params] = useSearchParams();
  const appointmentId = params.get('appointmentId') ?? undefined;
  const [patient, setPatient] = useState<PatientSummaryDto | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [bill, setBill] = useState<BillDraft>(emptyBill);
  const [collect, setCollect] = useState(true);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPayment());
  const [amountEdited, setAmountEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const suggestion = useQuery({ queryKey: ['invoices', 'suggest', appointmentId], queryFn: () => invoicesApi.suggest({ appointmentId }), enabled: !!appointmentId, refetchOnWindowFocus: false });
  useEffect(() => {
    const s = suggestion.data;
    if (!s) return;
    if (s.existingInvoiceId) {
      toast.info(t('billing.already_billed'));
      navigate(`/billing/invoices/${s.existingInvoiceId}`, { replace: true });
      return;
    }
    setDoctorId(s.doctor?.id ?? '');
    setBill({ ...emptyBill(), items: s.items.map(itemDraft) });
  }, [suggestion.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = billTotals(bill);
  useEffect(() => {
    if (!amountEdited) setPayment((p) => ({ ...p, amount: totals.total ? String(totals.total) : '' }));
  }, [totals.total, amountEdited]);

  const doctor = doctors.data?.find((d) => d.id === doctorId) ?? null;
  const patientId = appointmentId ? suggestion.data?.patient.id : patient?.id;

  const save = async () => {
    if (!patientId) return setErrors({ patientId: 'validation.required' });
    setSaving(true);
    setErrors({});
    try {
      const inv = await invoicesApi.create({
        patientId,
        appointmentId: appointmentId ?? null,
        doctorId: doctorId || null,
        ...billPayload(bill),
        payment: collect && Number(payment.amount) > 0 ? paymentPayload(payment) : null,
      });
      toast.success(t('billing.created', { number: inv.invoiceNumber }));
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
      navigate(`/billing/invoices/${inv.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVOICE_EXISTS' && (err.data as { invoiceId?: string })?.invoiceId) {
        navigate(`/billing/invoices/${(err.data as { invoiceId: string }).invoiceId}`, { replace: true });
      } else if (err instanceof ApiError && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
        toast.error(errorMessage(err));
      } else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (appointmentId && suggestion.isLoading) return <Skeleton className="h-96 w-full" />;
  if (suggestion.isError) return <ErrorState message={errorMessage(suggestion.error)} onRetry={() => void suggestion.refetch()} />;
  const s = suggestion.data;
  const extras = (s?.suggestedExtras ?? []).filter((x) => !bill.items.some((i) => i.feeItemId === x.feeItemId));

  return (
    <div className="max-w-5xl">
      <Link to="/billing" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('nav.billing')}
      </Link>
      <PageHeader title={t('billing.new_title')} subtitle={s ? t('billing.new_for_visit', { name: s.patient.fullName, code: s.patient.patientCode }) : t('billing.new_subtitle')} />

      <section className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {!appointmentId && (
            <Field label={t('appointments.patient')} error={errors.patientId ? t('validation.required') : undefined}>
              <PatientPicker value={patient} onChange={setPatient} error={!!errors.patientId} />
            </Field>
          )}
          <Field label={t('appointments.doctor')} optional={!appointmentId}>
            <Select value={doctorId} disabled={!!appointmentId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">—</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {extras.length > 0 && (
          <div className="rounded-lg border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
            <p className="mb-1 font-medium">{t('billing.ordered_tests')}</p>
            <div className="flex flex-wrap gap-1.5">
              {extras.map((x) => (
                <button
                  key={x.feeItemId ?? x.description}
                  type="button"
                  onClick={() => setBill({ ...bill, items: [...bill.items, itemDraft(x)] })}
                  className="rounded-full border border-info/30 bg-surface px-2.5 py-0.5 text-xs hover:bg-info-soft"
                >
                  + {x.description} · {money(x.unitPrice)}
                </button>
              ))}
            </div>
          </div>
        )}

        <InvoiceItemsEditor value={bill} onChange={setBill} doctor={doctor} canDiscount={can(PERMISSIONS.BILLING_UPDATE)} errors={errors} />
      </section>

      <section className="card mt-4 space-y-3 p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
          {t('billing.collect_now')}
        </label>
        {collect && (
          <PaymentFields
            value={payment}
            onChange={(p) => {
              if (p.amount !== payment.amount) setAmountEdited(true);
              setPayment(p);
            }}
            errors={errors}
            prefix="payment."
            showNote={false}
          />
        )}
        {collect && Number(payment.amount) > 0 && Number(payment.amount) < totals.total && (
          <p className="text-xs text-warning">{t('billing.will_remain_due', { amount: money(totals.total - Number(payment.amount)) })}</p>
        )}
      </section>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('common.cancel')}
        </Button>
        <Button icon={<Receipt className="h-4 w-4" />} loading={saving} disabled={!bill.items.length || (!patientId && !!appointmentId)} onClick={() => void save()}>
          {collect && Number(payment.amount) > 0 ? t('billing.create_and_collect', { amount: money(Number(payment.amount)) }) : t('billing.create')}
        </Button>
      </div>
    </div>
  );
}

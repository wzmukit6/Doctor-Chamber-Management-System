import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { AlertTriangle, ArrowLeft, Printer } from 'lucide-react';
import type { PrescriptionPrintDto } from '@chamber/shared';
import { Button, ErrorState, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { prescriptionsApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import i18n, { useLanguageReady } from '@/i18n';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { formatDirections, itemTitle } from './format';

function formatDate(iso: string, timeZone: string, lang: string) {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
}

/**
 * Printable A4/A5 prescription (spec §13, §58): doctor and chamber header,
 * patient section, clinical summary, Rx, advice, follow-up, signature and a
 * verification QR code. "Print" also offers "Save as PDF" in every browser.
 */
export function PrescriptionPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const version = params.get('version') ? Number(params.get('version')) : undefined;
  const { t: tUi } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['prescriptions', id, 'print', version], queryFn: () => prescriptionsApi.printData(id!, version), refetchOnWindowFocus: false });
  const d = q.data;
  const issued = d && (d.version.status === 'FINALIZED' || d.version.status === 'SUPERSEDED');
  const verifyUrl = d?.version.verificationToken ? `${window.location.origin}/verify/${d.version.verificationToken}` : null;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!verifyUrl || !d?.settings.showQr) return setQr(null);
    void QRCode.toDataURL(verifyUrl, { margin: 0, width: 160, errorCorrectionLevel: 'M' }).then(setQr);
  }, [verifyUrl, d?.settings.showQr]);

  // Page size follows the chamber setting.
  useEffect(() => {
    if (!d) return;
    const style = document.createElement('style');
    style.textContent = `@media print { @page { size: ${d.settings.pageFormat}; margin: ${d.settings.pageFormat === 'A5' ? '8mm' : '12mm'}; } }`;
    document.head.appendChild(style);
    document.title = `${d.rxNumber ?? 'Prescription'} — ${d.patient.fullName}`;
    return () => style.remove();
  }, [d]);

  const print = async () => {
    if (d && issued) {
      try {
        await prescriptionsApi.logPrint(d.prescriptionId, d.version.versionNumber);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    window.print();
  };

  if (q.isLoading) return <Skeleton className="mx-auto mt-8 h-[60rem] max-w-[210mm]" />;
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;
  if (q.isError || !d) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;

  return (
    <div className="min-h-screen bg-canvas py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 px-4">
        <Link to={`/prescriptions/${d.prescriptionId}`} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {tUi('rx.back_to_prescription')}
        </Link>
        <span className="text-xs text-ink-subtle">{tUi('rx.pdf_hint')}</span>
        <Button className="ml-auto" icon={<Printer className="h-4 w-4" />} onClick={() => void print()}>
          {issued ? tUi('rx.print') : tUi('rx.print_preview')}
        </Button>
      </div>
      {!issued && (
        <p role="alert" className="no-print mx-auto mb-3 flex max-w-[210mm] items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {tUi('rx.draft_banner')}
        </p>
      )}
      {d.version.status === 'SUPERSEDED' && (
        <p role="alert" className="no-print mx-auto mb-3 flex max-w-[210mm] items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {tUi('rx.superseded_banner', { n: d.latestVersionNumber })}
        </p>
      )}
      <PrescriptionSheet d={d} qr={qr} issued={!!issued} />
    </div>
  );
}

export function PrescriptionSheet({ d, qr, issued }: { d: PrescriptionPrintDto; qr: string | null; issued: boolean }) {
  // Printed labels follow the chamber's prescription language, independent of the UI language.
  const ready = useLanguageReady(d.settings.language);
  const t = useMemo(() => i18n.getFixedT(d.settings.language), [d.settings.language, ready]);
  const lang = d.settings.language;
  const s = d.settings;
  const v = d.visit;
  const clinical = s.showClinicalSection && (v.complaints.length > 0 || v.vitals.length > 0 || v.examinationNotes || v.diagnoses.length > 0 || v.investigations.length > 0);
  const tz = d.chamber.timezone;

  return (
    <article
      lang={lang}
      className="relative mx-auto flex min-h-[297mm] max-w-[210mm] flex-col bg-white px-[14mm] py-[12mm] text-[12px] leading-snug text-black shadow-card print:min-h-0 print:max-w-none print:p-0 print:shadow-none"
      aria-label={t('print.title')}
    >
      {!issued && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span style={{ transform: 'rotate(-30deg)' }} className="select-none text-[64px] font-bold uppercase tracking-widest text-black/[0.06]">{t('print.draft_watermark')}</span>
        </div>
      )}

      {/* Plain <div>s: the global print stylesheet hides <header>, <aside> and <nav>. */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-primary-700 pb-3" style={{ breakInside: 'avoid' }}>
        <div className="flex items-start gap-3">
          {d.chamber.logoDataUrl && <img src={d.chamber.logoDataUrl} alt="" className="max-h-[16mm] max-w-[30mm] object-contain" />}
          <div>
            <p className="text-[18px] font-bold text-primary-800">{d.doctor.fullName}</p>
            {d.doctor.qualifications && <p className="font-medium">{d.doctor.qualifications}</p>}
            {d.doctor.specialty && <p>{d.doctor.specialty}</p>}
            {d.doctor.registrationNo && <p className="text-[11px] text-neutral-600">{t('print.registration', { no: d.doctor.registrationNo })}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[14px] font-semibold">{d.chamber.name}</p>
          {d.chamber.tagline && <p className="text-[10.5px] italic text-neutral-600">{d.chamber.tagline}</p>}
          {d.chamber.address && <p className="max-w-[70mm] text-[11px]">{d.chamber.address}</p>}
          {d.chamber.phone && <p className="text-[11px]">{t('print.phone', { phone: d.chamber.phone })}</p>}
          {d.chamber.email && <p className="text-[11px]">{d.chamber.email}</p>}
        </div>
      </div>
      {s.headerNote && <p className="mt-1 text-center text-[11px] italic text-neutral-600">{s.headerNote}</p>}

      {/* Patient section */}
      <dl className="mt-3 grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-0.5 rounded border border-neutral-300 px-3 py-2 text-[11.5px]">
        <dt className="text-neutral-600">{t('print.patient')}</dt>
        <dd className="font-semibold">{d.patient.fullName}</dd>
        <dt className="text-neutral-600">{t('print.date')}</dt>
        <dd>{formatDate(v.date, tz, lang)}</dd>
        <dt className="text-neutral-600">{t('print.patient_id')}</dt>
        <dd>{d.patient.patientCode}</dd>
        <dt className="text-neutral-600">{t('print.rx_id')}</dt>
        <dd className="font-mono">
          {d.rxNumber ?? '—'}
          {d.version.versionNumber > 1 && ` · v${d.version.versionNumber}`}
        </dd>
        <dt className="text-neutral-600">{t('print.age_sex')}</dt>
        <dd>
          {d.patient.age !== null ? t('print.years', { count: d.patient.age }) : '—'} / {t(`gender.${d.patient.gender}`)}
        </dd>
        <dt className="text-neutral-600">{t('print.visit')}</dt>
        <dd>#{v.visitNumber}</dd>
      </dl>

      <div className={clinical ? 'mt-4 grid flex-1 grid-cols-[34%_1fr] gap-5' : 'mt-4 flex-1'}>
        {clinical && (
          <div className="space-y-3 border-r border-neutral-300 pr-4">
            {v.complaints.length > 0 && (
              <PrintBlock title={t('print.complaints')}>
                <ul className="list-disc pl-4">
                  {v.complaints.map((c, i) => (
                    <li key={i}>
                      {c.text}
                      {c.duration && <span className="text-neutral-600"> — {c.duration}</span>}
                    </li>
                  ))}
                </ul>
              </PrintBlock>
            )}
            {(v.vitals.length > 0 || v.examinationNotes) && (
              <PrintBlock title={t('print.examination')}>
                {v.vitals.map((x) => (
                  <p key={x.label}>
                    {x.label}: <span className="font-medium">{x.value}</span> {x.unit}
                  </p>
                ))}
                {v.examinationNotes && <p className="mt-1 whitespace-pre-line">{v.examinationNotes}</p>}
              </PrintBlock>
            )}
            {v.diagnoses.length > 0 && (
              <PrintBlock title={t('print.diagnosis')}>
                <ul className="list-disc pl-4">
                  {v.diagnoses.map((x, i) => (
                    <li key={i} className={x.isPrimary ? 'font-semibold' : undefined}>
                      {x.name}
                      {x.code && <span className="font-normal text-neutral-600"> ({x.code})</span>}
                      {x.certainty !== 'CONFIRMED' && <span className="font-normal italic text-neutral-600"> — {t(`certainty.${x.certainty}`)}</span>}
                    </li>
                  ))}
                </ul>
              </PrintBlock>
            )}
            {v.investigations.length > 0 && (
              <PrintBlock title={t('print.investigations')}>
                <ul className="list-disc pl-4">
                  {v.investigations.map((x, i) => (
                    <li key={i}>
                      {x.name}
                      {x.priority !== 'ROUTINE' && <span className="font-semibold"> ({t(`priority.${x.priority}`)})</span>}
                      {x.instructions && <span className="block text-[11px] text-neutral-600">{x.instructions}</span>}
                    </li>
                  ))}
                </ul>
              </PrintBlock>
            )}
          </div>
        )}

        <section>
          <p className="font-serif text-[26px] font-bold italic leading-none text-primary-800" aria-label={t('print.rx')}>
            ℞
          </p>
          {d.version.items.length === 0 ? (
            <p className="mt-2 text-neutral-600">{t('print.no_medicines')}</p>
          ) : (
            <ol className="mt-2 space-y-2.5">
              {d.version.items.map((i, n) => (
                <li key={i.id ?? n} style={{ breakInside: 'avoid' }}>
                  <p className="text-[13px] font-semibold">
                    {n + 1}. {i.form && <span className="font-normal">{t(`medicineFormShort.${i.form}`)} </span>}
                    {itemTitle(i, s.medicineNameFormat)} {i.strength && <span>{i.strength}</span>}
                  </p>
                  <p className="pl-4">{formatDirections(t, i) || '—'}</p>
                  {(i.instructions || i.quantity) && (
                    <p className="pl-4 text-[11px] text-neutral-700">
                      {i.instructions}
                      {i.instructions && i.quantity ? ' · ' : ''}
                      {i.quantity ? t('print.qty', { count: i.quantity }) : ''}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          {d.version.advice && (
            <PrintBlock title={t('print.advice')} className="mt-5">
              <p className="whitespace-pre-line">{d.version.advice}</p>
            </PrintBlock>
          )}
          {(v.followUpDate || v.followUpInstructions) && (
            <PrintBlock title={t('print.follow_up')} className="mt-4">
              {v.followUpDate && <p className="font-semibold">{formatDate(`${v.followUpDate}T00:00:00Z`, 'UTC', lang)}</p>}
              {v.followUpInstructions && <p>{v.followUpInstructions}</p>}
            </PrintBlock>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="mt-8 flex items-end justify-between gap-6 border-t border-neutral-300 pt-3" style={{ breakInside: 'avoid' }}>
        <div className="flex items-end gap-3">
          {qr && issued && (
            <>
              <img src={qr} alt={t('print.qr_alt')} className="h-[22mm] w-[22mm]" />
              <div className="text-[10px] text-neutral-600">
                <p className="font-medium text-black">{t('print.scan_to_verify')}</p>
                <p className="font-mono">{d.rxNumber}</p>
                {d.version.contentHash && <p className="font-mono">#{d.version.contentHash.slice(0, 12)}</p>}
              </div>
            </>
          )}
        </div>
        {s.showSignatureLine && (
          <div className="min-w-[55mm] text-center">
            {d.doctor.signatureDataUrl ? <img src={d.doctor.signatureDataUrl} alt={t('print.signature')} className="mx-auto h-10 max-w-[50mm] object-contain" /> : <div className="h-10" />}
            <p className="border-t border-black pt-1 font-medium">{d.doctor.fullName}</p>
            <p className="text-[10px] text-neutral-600">{t('print.signature')}</p>
          </div>
        )}
      </div>
      {d.doctor.prescriptionFooter && <p className="mt-2 text-center text-[10.5px] text-neutral-700">{d.doctor.prescriptionFooter}</p>}
      {s.footerText && <p className="mt-1 text-center text-[10.5px] text-neutral-600">{s.footerText}</p>}
      <p className="mt-1 text-center text-[9px] text-neutral-500">
        {issued && d.version.finalizedAt
          ? t('print.issued_by', { name: d.version.finalizedByName ?? d.doctor.fullName, date: formatDate(d.version.finalizedAt, tz, lang) })
          : t('print.draft_watermark')}
      </p>
    </article>
  );
}

function PrintBlock({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ breakInside: 'avoid' }}>
      <p className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary-800">{title}</p>
      {children}
    </div>
  );
}

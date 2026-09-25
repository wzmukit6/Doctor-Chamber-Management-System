import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BadgeCheck, Loader2, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/services/api';
import { prescriptionsApi } from '@/services/endpoints';
import { formatDateTime } from '@/utils/format';

/**
 * Public verification page behind the prescription QR code (spec §14): shows
 * only the prescription ID, issue date, doctor and status — never patient data.
 */
export function VerifyPrescriptionPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['verify', token], queryFn: () => prescriptionsApi.verify(token!), retry: false });
  const v = q.data;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="card w-full max-w-md p-6">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t('verify.title')}</p>
        {q.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('verify.checking')}
          </p>
        ) : !v ? (
          <div className="flex items-start gap-3" role="alert">
            <ShieldAlert className="h-8 w-8 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="text-base font-semibold text-danger">{t('verify.not_found')}</p>
              <p className="mt-1 text-sm text-ink-muted">{q.error instanceof ApiError && q.error.status === 429 ? t('errors.RATE_LIMITED') : t('verify.not_found_help')}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3" role="status">
              {v.valid ? <BadgeCheck className="h-8 w-8 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="h-8 w-8 shrink-0 text-warning" aria-hidden />}
              <div>
                <p className={v.valid ? 'text-base font-semibold text-success' : 'text-base font-semibold text-warning'}>{t(`verify.status_${v.status}`)}</p>
                <p className="mt-1 text-sm text-ink-muted">{v.valid ? t('verify.valid_help') : t('verify.superseded_help', { n: v.latestVersionNumber })}</p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-subtle">{t('verify.rx')}</dt>
              <dd className="font-mono font-medium text-ink">
                {v.rxNumber} · v{v.versionNumber}
              </dd>
              <dt className="text-ink-subtle">{t('verify.issued')}</dt>
              <dd className="text-ink">{v.issuedAt ? formatDateTime(v.issuedAt) : '—'}</dd>
              {v.supersededAt && (
                <>
                  <dt className="text-ink-subtle">{t('verify.superseded_on')}</dt>
                  <dd className="text-ink">{formatDateTime(v.supersededAt)}</dd>
                </>
              )}
              <dt className="text-ink-subtle">{t('verify.doctor')}</dt>
              <dd className="text-ink">
                {v.doctor.fullName}
                {v.doctor.qualifications && <span className="block text-xs text-ink-muted">{v.doctor.qualifications}</span>}
                {v.doctor.registrationNo && <span className="block text-xs text-ink-muted">{t('verify.registration', { no: v.doctor.registrationNo })}</span>}
              </dd>
              <dt className="text-ink-subtle">{t('verify.chamber')}</dt>
              <dd className="text-ink">{v.chamber.name}</dd>
              {v.contentHash && (
                <>
                  <dt className="text-ink-subtle">{t('verify.fingerprint')}</dt>
                  <dd className="break-all font-mono text-xs text-ink-muted">{v.contentHash}</dd>
                </>
              )}
            </dl>
            <p className="mt-5 border-t border-border pt-3 text-xs text-ink-subtle">{t('verify.privacy')}</p>
          </>
        )}
      </div>
    </main>
  );
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Droplet, History, Lock, Pill, Stethoscope } from 'lucide-react';
import type { ConsultationDetail } from '@/services/endpoints';
import { Avatar, Badge } from '@/components/ui';
import { formatDate } from '@/utils/format';

/** Patient summary beside the consultation (spec §9): identity, allergies, conditions, medications, previous visits. */
export function PatientSummaryPanel({ c }: { c: ConsultationDetail }) {
  const { t } = useTranslation();
  const p = c.patient;
  const ctx = c.context;
  return (
    <aside className="space-y-4" aria-label={t('consultation.summary')}>
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <Avatar name={p.fullName} />
          <div className="min-w-0">
            <Link to={`/patients/${p.id}`} className="block truncate font-semibold text-ink hover:underline">
              {p.fullName}
            </Link>
            <p className="text-xs text-ink-muted">
              <span className="font-mono">{p.patientCode}</span> · {p.age !== null ? t('patients.age_value', { count: p.age }) : '—'}
              {p.dobEstimated && ` (${t('patients.estimated')})`} · {t(`gender.${p.gender}`)}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-muted">
              {p.bloodGroup && (
                <span className="inline-flex items-center gap-1">
                  <Droplet className="h-3 w-3 text-danger" aria-hidden /> {p.bloodGroup}
                </span>
              )}
              <span>{t('consultation.visit', { n: c.visitNumber })}</span>
            </p>
          </div>
        </div>
      </div>

      {ctx.medicalHidden ? (
        <p className="card flex items-start gap-2 p-3 text-xs text-ink-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t('consultation.medical_hidden')}
        </p>
      ) : (
        <>
          <section className={ctx.allergies.length ? 'card border-danger/30 bg-danger-soft/50 p-4' : 'card p-4'} aria-labelledby="sum-allergies">
            <h3 id="sum-allergies" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              <AlertTriangle className={ctx.allergies.length ? 'h-3.5 w-3.5 text-danger' : 'h-3.5 w-3.5'} aria-hidden /> {t('consultation.allergies')}
            </h3>
            {ctx.allergies.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('consultation.no_allergies')}</p>
            ) : (
              <ul className="space-y-1" role="alert">
                {ctx.allergies.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="font-semibold text-danger">{a.allergen}</span>
                    {a.reaction && <span className="text-ink-muted"> — {a.reaction}</span>}
                    {a.severity !== 'UNKNOWN' && (
                      <Badge tone={a.severity === 'SEVERE' ? 'danger' : 'warning'} className="ml-1">
                        {t(`severity.${a.severity}`)}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card space-y-3 p-4">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <Stethoscope className="h-3.5 w-3.5" aria-hidden /> {t('consultation.conditions')}
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">{ctx.existingConditions || <span className="text-ink-subtle">{t('patients.not_recorded')}</span>}</p>
            </div>
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <Pill className="h-3.5 w-3.5" aria-hidden /> {t('consultation.medications')}
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">{ctx.currentMedications || <span className="text-ink-subtle">{t('patients.not_recorded')}</span>}</p>
            </div>
          </section>
        </>
      )}

      <section className="card p-4" aria-labelledby="sum-visits">
        <h3 id="sum-visits" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <History className="h-3.5 w-3.5" aria-hidden /> {t('consultation.previous_visits')}
        </h3>
        {ctx.previousVisits.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('consultation.no_previous')}</p>
        ) : (
          <ul className="space-y-2">
            {ctx.previousVisits.map((v) => (
              <li key={v.id}>
                <Link to={`/consultations/${v.id}`} className="block rounded p-1.5 hover:bg-canvas">
                  <p className="text-2xs text-ink-subtle">
                    {formatDate(v.finalizedAt ?? v.startedAt)} · {v.doctor.fullName}
                  </p>
                  <p className="truncate text-sm text-ink">{v.primaryDiagnosis ?? v.complaints.join(', ') ?? '—'}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

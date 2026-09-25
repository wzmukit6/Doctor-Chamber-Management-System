import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Star } from 'lucide-react';
import { computeBmi } from '@chamber/shared';
import type { ConsultationDetail } from '@/services/endpoints';
import { Badge } from '@/components/ui';
import { formatDate, formatDateTime } from '@/utils/format';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const Empty = () => {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-subtle">{t('consultation.none')}</p>;
};

/** Read-only rendering of a consultation (finalized records or viewers who cannot edit). */
export function ConsultationView({ c }: { c: ConsultationDetail }) {
  const { t } = useTranslation();
  const weight = c.vitals.find((v) => v.key === 'weight');
  const height = c.vitals.find((v) => v.key === 'height');
  const bmi = weight && height ? computeBmi(Number(weight.value), Number(height.value)) : null;
  const history = (
    [
      ['present_illness', c.presentIllness],
      ['past_history', c.pastHistory],
      ['family_history', c.familyHistory],
      ['medication_history', c.medicationHistory],
      ['other_history', c.otherHistory],
    ] as const
  ).filter(([, v]) => v);
  return (
    <div className="space-y-4">
      <Block title={t('consultation.complaints')}>
        {c.complaints.length === 0 ? (
          <Empty />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {c.complaints.map((s) => (
              <li key={s.id} className="rounded-full border border-border bg-canvas px-3 py-1 text-sm">
                {s.text}
                {s.duration && <span className="text-ink-muted"> · {s.duration}</span>}
              </li>
            ))}
          </ul>
        )}
      </Block>
      {history.length > 0 && (
        <Block title={t('consultation.history')}>
          <dl className="space-y-2">
            {history.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-ink-subtle">{t(`consultation.${k}`)}</dt>
                <dd className="whitespace-pre-line text-sm text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
      <Block title={t('consultation.examination')}>
        {c.vitals.length === 0 && !c.examinationNotes ? (
          <Empty />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {c.vitals.map((v) => (
                <div key={v.definitionId} className="rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-2xs text-ink-subtle">{v.label}</dt>
                  <dd className="text-sm font-semibold text-ink">
                    {v.value} {v.unit && <span className="text-2xs font-normal text-ink-subtle">{v.unit}</span>}
                  </dd>
                </div>
              ))}
              {bmi !== null && (
                <div className="rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-2xs text-ink-subtle">{t('consultation.bmi')}</dt>
                  <dd className="text-sm font-semibold text-ink">{bmi}</dd>
                </div>
              )}
            </dl>
            {c.examinationNotes && <p className="mt-3 whitespace-pre-line text-sm text-ink">{c.examinationNotes}</p>}
          </>
        )}
      </Block>
      <Block title={t('consultation.diagnosis')}>
        {c.diagnoses.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1.5">
            {c.diagnoses.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                {d.isPrimary && <Star className="h-4 w-4 fill-current text-primary-700" aria-label={t('consultation.primary')} />}
                <span className={d.isPrimary ? 'font-semibold text-ink' : 'text-ink'}>{d.name}</span>
                {d.code && <span className="font-mono text-2xs text-ink-subtle">{d.code}</span>}
                {d.certainty !== 'CONFIRMED' && <Badge>{t(`certainty.${d.certainty}`)}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title={t('consultation.investigations')}>
        {c.investigations.length === 0 ? (
          <Empty />
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {c.investigations.map((i) => (
              <li key={i.id}>
                {i.name}
                {i.priority !== 'ROUTINE' && (
                  <Badge tone="danger" className="ml-2">
                    {t(`priority.${i.priority}`)}
                  </Badge>
                )}
                {i.instructions && <span className="text-ink-muted"> — {i.instructions}</span>}
              </li>
            ))}
          </ol>
        )}
      </Block>
      <Block title={t('consultation.notes')}>
        {c.clinicalNotesHidden ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden /> {t('consultation.notes_hidden')}
          </p>
        ) : c.clinicalNotes ? (
          <p className="whitespace-pre-line text-sm text-ink">{c.clinicalNotes}</p>
        ) : (
          <Empty />
        )}
      </Block>
      <Block title={t('consultation.follow_up')}>
        {c.followUpDate ? (
          <p className="text-sm text-ink">
            <span className="font-semibold">{formatDate(c.followUpDate)}</span>
            {c.followUpInstructions && <span className="text-ink-muted"> — {c.followUpInstructions}</span>}
          </p>
        ) : (
          <p className="text-sm text-ink-subtle">{t('consultation.no_follow_up')}</p>
        )}
      </Block>
      {c.addenda.length > 0 && (
        <Block title={t('consultation.addenda')}>
          <ul className="space-y-2">
            {c.addenda.map((a) => (
              <li key={a.id} className="rounded-lg border-l-4 border-l-info bg-info-soft/40 px-3 py-2">
                <p className="whitespace-pre-line text-sm text-ink">{a.text}</p>
                <p className="mt-1 text-2xs text-ink-subtle">
                  {formatDateTime(a.createdAt)} · {a.createdByName}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

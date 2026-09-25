import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Droplet, Phone } from 'lucide-react';
import type { AllergyDto, PatientSummaryDto } from '@chamber/shared';
import { Avatar, Badge } from '@/components/ui';

/** "34 y · Male" with an "estimated" hint when only the age was known. */
export function AgeGender({ patient }: { patient: Pick<PatientSummaryDto, 'age' | 'gender' | 'dobEstimated'> }) {
  const { t } = useTranslation();
  return (
    <span className="whitespace-nowrap">
      {patient.age !== null ? t('patients.age_value', { count: patient.age }) : '—'}
      {patient.dobEstimated && <span className="text-ink-subtle"> ({t('patients.estimated')})</span>} · {t(`gender.${patient.gender}`)}
    </span>
  );
}

export function AllergyBadges({ allergies, compact }: { allergies: AllergyDto[]; compact?: boolean }) {
  const { t } = useTranslation();
  if (allergies.length === 0) return compact ? null : <span className="text-sm text-ink-muted">{t('patients.no_allergies')}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {allergies.map((a) => (
        <Badge key={a.id} tone={a.severity === 'SEVERE' ? 'danger' : 'warning'}>
          {a.allergen}
          {!compact && a.severity !== 'UNKNOWN' && <span className="opacity-70">· {t(`severity.${a.severity}`)}</span>}
        </Badge>
      ))}
    </span>
  );
}

/** Prominent allergy warning (patient safety). */
export function AllergyAlert({ allergies }: { allergies: AllergyDto[] }) {
  const { t } = useTranslation();
  if (allergies.length === 0) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-4 py-2.5 text-sm text-danger">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">{t('patients.allergy_alert')}</span>
      <AllergyBadges allergies={allergies} />
    </div>
  );
}

/** Compact patient row used in search results and recent lists. */
export function PatientLine({ patient, to }: { patient: PatientSummaryDto; to?: string }) {
  const { t } = useTranslation();
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={patient.fullName} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {patient.fullName} {patient.isDemo && <Badge tone="warning">{t('app.demo')}</Badge>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-2xs text-ink-subtle">
          <span className="font-mono">{patient.patientCode}</span>
          <AgeGender patient={patient} />
          {patient.phone && (
            <span className="inline-flex items-center gap-0.5">
              <Phone className="h-3 w-3" aria-hidden />
              {patient.phone}
            </span>
          )}
          {patient.bloodGroup && (
            <span className="inline-flex items-center gap-0.5">
              <Droplet className="h-3 w-3" aria-hidden />
              {patient.bloodGroup}
            </span>
          )}
        </p>
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded px-2 py-1.5 hover:bg-canvas">
      {body}
    </Link>
  ) : (
    body
  );
}

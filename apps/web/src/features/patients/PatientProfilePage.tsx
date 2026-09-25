import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, CalendarPlus, Droplet, Lock, Mail, MapPin, Pencil, Phone, Stethoscope, Trash2, UserRound } from 'lucide-react';
import { PERMISSIONS, type PatientDto } from '@chamber/shared';
import { Avatar, Badge, Button, ConfirmDialog, ErrorState, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { patientsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AgeGender, AllergyAlert } from './components/PatientBits';
import { MedicalHistoryPanel } from './components/MedicalHistoryPanel';
import { PatientTimeline } from './components/Timeline';
import { BookAppointmentModal } from '@/features/appointments/components/BookAppointmentModal';
import { PatientAppointments } from '@/features/appointments/components/PatientAppointments';
import { PatientConsultations } from '@/features/consultations/components/PatientConsultations';
import { consultationsApi } from '@/services/endpoints';

type Tab = 'overview' | 'medical' | 'timeline' | 'appointments' | 'consultations';

function Detail({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{children || '—'}</dd>
    </div>
  );
}

/** Patient profile (spec §5, §32): summary header, demographics, medical information and timeline. */
export function PatientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const [starting, setStarting] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [deleting, setDeleting] = useState(false);
  const [booking, setBooking] = useState(false);

  const query = useQuery({ queryKey: ['patients', id], queryFn: () => patientsApi.get(id!) });
  const remove = useMutation({
    mutationFn: (reason: string) => patientsApi.remove(id!, reason),
    onSuccess: () => {
      toast.success(t('patients.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      navigate('/patients', { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage />;
  if (query.isError || !query.data) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const p: PatientDto = query.data;
  const tabs: { key: Tab | 'prescriptions'; label: string; disabled?: boolean }[] = [
    { key: 'overview', label: t('patients.tab_overview') },
    ...(p.medical ? [{ key: 'medical' as const, label: t('patients.tab_medical') }] : []),
    { key: 'timeline', label: t('patients.tab_timeline') },
    ...(can(PERMISSIONS.CONSULTATIONS_VIEW) ? [{ key: 'consultations' as const, label: t('consultation.list_title') }] : []),
    ...(can(PERMISSIONS.APPOINTMENTS_VIEW) ? [{ key: 'appointments' as const, label: t('patients.tab_appointments') }] : []),
    { key: 'prescriptions', label: t('patients.tab_prescriptions'), disabled: true },
  ];

  return (
    <div className="space-y-4">
      <Link to="/patients" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('nav.patients')}
      </Link>

      <section className="card p-5" aria-label={t('patients.summary')}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={p.fullName} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink">
                {p.fullName} {p.isDemo && <Badge tone="warning">{t('app.demo')}</Badge>}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                <span className="font-mono text-xs">{p.patientCode}</span>
                <AgeGender patient={p} />
                {p.bloodGroup && (
                  <span className="inline-flex items-center gap-1">
                    <Droplet className="h-3.5 w-3.5 text-danger" aria-hidden /> {p.bloodGroup}
                  </span>
                )}
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-ink">
                    <Phone className="h-3.5 w-3.5" aria-hidden /> {p.phone}
                  </a>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(PERMISSIONS.APPOINTMENTS_CREATE) && (
              <Button variant="secondary" size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking(true)}>
                {t('patients.new_appointment')}
              </Button>
            )}
            {can(PERMISSIONS.CONSULTATIONS_CREATE) && user?.doctorId && (
              <Button
                size="sm"
                icon={<Stethoscope className="h-4 w-4" />}
                loading={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    const c = await consultationsApi.start(p.id);
                    navigate(`/consultations/${c.id}`);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                {t('patients.start_consultation')}
              </Button>
            )}
            {can(PERMISSIONS.PATIENTS_UPDATE) && (
              <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/patients/${p.id}/edit`)}>
                {t('common.edit')}
              </Button>
            )}
            {can(PERMISSIONS.PATIENTS_DELETE) && (
              <Button variant="ghost" size="sm" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
                {t('patients.delete')}
              </Button>
            )}
          </div>
        </div>
        {p.medical && p.medical.allergies.length > 0 && (
          <div className="mt-4">
            <AllergyAlert allergies={p.medical.allergies} />
          </div>
        )}
      </section>

      <div className="border-b border-border" role="tablist" aria-label={t('patients.summary')}>
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              role="tab"
              id={`tab-${tb.key}`}
              aria-selected={tab === tb.key}
              aria-controls={`panel-${tb.key}`}
              disabled={tb.disabled}
              onClick={() => !tb.disabled && setTab(tb.key as Tab)}
              className={clsx(
                'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-subtle',
                tab === tb.key ? 'border-primary-700 text-primary-800' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tb.label}
              {tb.disabled && <Badge className="!px-1.5 !py-0">{t('common.coming_soon')}</Badge>}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="card p-5">
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <dl className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <Detail label={t('patients.dob')}>
                {p.dateOfBirth ? (
                  <>
                    {p.dobEstimated ? '≈ ' : ''}
                    {formatDate(p.dateOfBirth)} {p.dobEstimated && <span className="text-xs text-ink-subtle">({t('patients.estimated')})</span>}
                  </>
                ) : null}
              </Detail>
              <Detail label={t('patients.gender')}>{t(`gender.${p.gender}`)}</Detail>
              <Detail label={t('common.phone')} icon={<Phone className="h-3 w-3" aria-hidden />}>
                {p.phone}
              </Detail>
              <Detail label={t('common.email')} icon={<Mail className="h-3 w-3" aria-hidden />}>
                {p.email}
              </Detail>
              <Detail label={t('common.address')} icon={<MapPin className="h-3 w-3" aria-hidden />}>
                {p.address}
              </Detail>
              <Detail label={t('patients.occupation')}>{p.occupation}</Detail>
              <Detail label={t('patients.nationality')}>{p.nationality}</Detail>
              <Detail label={t('patients.registered')} icon={<UserRound className="h-3 w-3" aria-hidden />}>
                {formatDate(p.registeredAt)}
                {p.registeredByName && <span className="block text-xs text-ink-subtle">{t('patients.registered_by', { name: p.registeredByName })}</span>}
              </Detail>
            </dl>
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t('patients.section_emergency')}</h3>
                {p.emergencyContacts.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('patients.no_emergency')}</p>
                ) : (
                  <ul className="space-y-2">
                    {p.emergencyContacts.map((c) => (
                      <li key={c.id} className="text-sm">
                        <p className="font-medium text-ink">
                          {c.name} {c.relation && <span className="font-normal text-ink-muted">· {c.relation}</span>}
                        </p>
                        <a href={`tel:${c.phone}`} className="text-xs text-primary-700 hover:underline">
                          {c.phone}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!p.medical && (
                <p className="flex items-start gap-2 rounded-lg bg-canvas p-3 text-xs text-ink-muted">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t('patients.medical_hidden')}
                </p>
              )}
            </div>
          </div>
        )}
        {tab === 'medical' && p.medical && <MedicalHistoryPanel patient={p} />}
        {tab === 'timeline' && <PatientTimeline patientId={p.id} />}
        {tab === 'appointments' && <PatientAppointments patientId={p.id} />}
        {tab === 'consultations' && <PatientConsultations patientId={p.id} />}
      </div>

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} defaults={{ patient: p }} />
      <ConfirmDialog
        open={deleting}
        title={t('patients.delete_title', { name: p.fullName })}
        body={t('patients.delete_body')}
        confirmLabel={t('patients.delete')}
        requireReason
        loading={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={(reason) => remove.mutate(reason)}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Plus, Trash2, Users } from 'lucide-react';
import {
  ALLERGY_SEVERITIES,
  BLOOD_GROUPS,
  createPatientSchema,
  GENDERS,
  PERMISSIONS,
  updatePatientSchema,
  type DuplicateCandidateDto,
  type PatientDto,
} from '@chamber/shared';
import { Badge, Button, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { patientsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { PatientLine } from './components/PatientBits';

type FormValues = z.input<typeof createPatientSchema> & { version?: number };
type DobMode = 'date' | 'age';

const numberOrNull = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
const emptyToNull = (v: unknown) => (v === '' ? null : v);

const MEDICAL_FIELDS = ['existingConditions', 'currentMedications', 'previousSurgeries', 'familyHistory', 'relevantHistory', 'lifestyle'] as const;

function toFormValues(p: PatientDto): FormValues {
  return {
    fullName: p.fullName,
    gender: p.gender,
    dateOfBirth: p.dobEstimated ? null : p.dateOfBirth,
    ageYears: p.dobEstimated ? p.age : null,
    bloodGroup: (p.bloodGroup as FormValues['bloodGroup']) ?? null,
    phone: p.phone,
    email: p.email,
    address: p.address,
    occupation: p.occupation,
    nationality: p.nationality,
    emergencyContacts: p.emergencyContacts.map((c) => ({ name: c.name, relation: c.relation, phone: c.phone })),
    version: p.version,
  };
}

/** Patient registration and demographic editing (spec §5). */
export function PatientFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canMedical = !editing && can(PERMISSIONS.PATIENTS_UPDATE_MEDICAL) && can(PERMISSIONS.PATIENTS_VIEW_MEDICAL);
  const [dobMode, setDobMode] = useState<DobMode>('date');
  const [blocked, setBlocked] = useState<DuplicateCandidateDto[] | null>(null);

  const existing = useQuery({ queryKey: ['patients', id], queryFn: () => patientsApi.get(id!), enabled: editing });

  const resolver = useMemo(
    () => zodResolver(editing ? updatePatientSchema : createPatientSchema) as unknown as Resolver<FormValues>,
    [editing],
  );
  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver,
    defaultValues: {
      fullName: (location.state as { name?: string } | null)?.name && !/\d/.test((location.state as { name: string }).name) ? (location.state as { name: string }).name : '',
      emergencyContacts: [],
      allergies: [],
      nationality: 'Bangladeshi',
    },
  });
  const contacts = useFieldArray({ control, name: 'emergencyContacts' });
  const allergies = useFieldArray({ control, name: 'allergies' });

  useEffect(() => {
    if (existing.data) {
      reset(toFormValues(existing.data));
      setDobMode(existing.data.dobEstimated ? 'age' : 'date');
    }
  }, [existing.data, reset]);

  // Live duplicate check while registering (spec §46: prevent duplicate records).
  const [fullName, phone, dateOfBirth] = useWatch({ control, name: ['fullName', 'phone', 'dateOfBirth'] });
  const dupInput = useDebounce({ fullName: fullName ?? '', phone: phone ?? '', dateOfBirth: dateOfBirth ?? '' }, 500);
  const dupEnabled = !editing && ((dupInput.phone?.replace(/\D/g, '').length ?? 0) >= 10 || (dupInput.fullName.length >= 3 && !!dupInput.dateOfBirth));
  const duplicates = useQuery({
    queryKey: ['patients', 'duplicates', dupInput],
    queryFn: () =>
      patientsApi.duplicates({
        fullName: dupInput.fullName || undefined,
        phone: dupInput.phone || undefined,
        dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(dupInput.dateOfBirth) ? dupInput.dateOfBirth : undefined,
      }),
    enabled: dupEnabled,
    staleTime: 10_000,
  });

  const switchDobMode = (mode: DobMode) => {
    setDobMode(mode);
    if (mode === 'date') setValue('ageYears', null);
    else setValue('dateOfBirth', null);
  };

  const submit = async (values: FormValues, allowDuplicate = false) => {
    try {
      if (editing) {
        const parsed = updatePatientSchema.parse({ ...values, version: existing.data!.version });
        const saved = await patientsApi.update(id!, parsed);
        queryClient.setQueryData(['patients', id], saved);
        toast.success(t('patients.updated'));
        navigate(`/patients/${id}`);
      } else {
        const parsed = createPatientSchema.parse({ ...values, allowDuplicate });
        const history = parsed.medicalHistory;
        const hasHistory = !!history && MEDICAL_FIELDS.some((f) => history[f]);
        const saved = await patientsApi.create({
          ...parsed,
          medicalHistory: canMedical && hasHistory ? history : undefined,
          allergies: canMedical && parsed.allergies?.length ? parsed.allergies : undefined,
        });
        toast.success(t('patients.created'));
        void queryClient.invalidateQueries({ queryKey: ['patients'] });
        navigate(`/patients/${saved.id}`, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
        setBlocked((err.data as { candidates: DuplicateCandidateDto[] }).candidates);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  };

  if (editing && existing.isLoading) return <Skeleton className="h-96 w-full" />;
  if (editing && existing.isError) return <ErrorState message={errorMessage(existing.error)} onRetry={() => void existing.refetch()} />;

  const warnings = duplicates.data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={editing ? `/patients/${id}` : '/patients'} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('common.back')}
      </Link>
      <PageHeader
        title={editing ? t('patients.edit') : t('patients.register')}
        subtitle={editing ? `${existing.data?.patientCode} · ${existing.data?.fullName}` : undefined}
      />

      {blocked && (
        <div role="alert" className="card mb-4 border-danger/30 p-4">
          <p className="flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('patients.duplicate_blocked')}
          </p>
          <DuplicateList candidates={blocked} />
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" loading={isSubmitting} onClick={handleSubmit((v) => submit(v, true))}>
              {t('patients.register_anyway')}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit((v) => submit(v))} noValidate className="space-y-6">
        <section className="card p-5" aria-labelledby="sec-basic">
          <h2 id="sec-basic" className="mb-4 text-sm font-semibold text-ink">
            {t('patients.section_basic')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('patients.name')} error={errors.fullName?.message} className="sm:col-span-2">
              <Input autoFocus autoComplete="off" {...register('fullName')} />
            </Field>
            <Field label={t('patients.gender')} error={errors.gender?.message}>
              <Select {...register('gender', { setValueAs: emptyToNull })} defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {t(`gender.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('patients.blood_group')} optional error={errors.bloodGroup?.message}>
              <Select {...register('bloodGroup', { setValueAs: emptyToNull })}>
                <option value="">—</option>
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <span className="label">{t('patients.dob_mode')}</span>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="inline-flex rounded border border-border p-0.5" role="radiogroup" aria-label={t('patients.dob_mode')}>
                  {(['date', 'age'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={dobMode === m}
                      onClick={() => switchDobMode(m)}
                      className={clsx('rounded px-3 py-1.5 text-xs font-medium', dobMode === m ? 'bg-primary-700 text-white' : 'text-ink-muted hover:bg-canvas')}
                    >
                      {m === 'date' ? t('patients.dob_mode_date') : t('patients.dob_mode_age')}
                    </button>
                  ))}
                </div>
                <div className="flex-1">
                  {dobMode === 'date' ? (
                    <Field label={t('patients.dob')} error={errors.dateOfBirth?.message}>
                      <Input type="date" max={new Date().toISOString().slice(0, 10)} {...register('dateOfBirth', { setValueAs: emptyToNull })} />
                    </Field>
                  ) : (
                    <Field label={t('patients.age_years')} error={errors.ageYears?.message ?? errors.dateOfBirth?.message}>
                      <Input type="number" min={0} max={130} inputMode="numeric" {...register('ageYears', { setValueAs: numberOrNull })} />
                    </Field>
                  )}
                </div>
              </div>
            </div>
            <Field label={t('patients.occupation')} optional error={errors.occupation?.message}>
              <Input {...register('occupation')} />
            </Field>
            <Field label={t('patients.nationality')} optional error={errors.nationality?.message}>
              <Input {...register('nationality')} />
            </Field>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="sec-contact">
          <h2 id="sec-contact" className="mb-4 text-sm font-semibold text-ink">
            {t('patients.section_contact')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.phone')} optional error={errors.phone?.message}>
              <Input type="tel" inputMode="tel" placeholder="01XXXXXXXXX" {...register('phone', { setValueAs: emptyToNull })} />
            </Field>
            <Field label={t('common.email')} optional error={errors.email?.message}>
              <Input type="email" {...register('email', { setValueAs: emptyToNull })} />
            </Field>
            <Field label={t('common.address')} optional error={errors.address?.message} className="sm:col-span-2">
              <Textarea rows={2} {...register('address')} />
            </Field>
          </div>
          {!editing && warnings.length > 0 && !blocked && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft/60 p-3" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-warning">
                <Users className="h-4 w-4" aria-hidden /> {t('patients.duplicates_title')}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">{t('patients.duplicates_hint')}</p>
              <DuplicateList candidates={warnings} />
            </div>
          )}
        </section>

        <section className="card p-5" aria-labelledby="sec-emergency">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="sec-emergency" className="text-sm font-semibold text-ink">
              {t('patients.section_emergency')}
            </h2>
            {contacts.fields.length < 3 && (
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => contacts.append({ name: '', relation: null, phone: '' })}>
                {t('patients.add_contact')}
              </Button>
            )}
          </div>
          {contacts.fields.length === 0 && <p className="text-sm text-ink-muted">{t('patients.no_emergency')}</p>}
          <div className="space-y-3">
            {contacts.fields.map((f, i) => (
              <div key={f.id} className="grid items-start gap-3 sm:grid-cols-[1fr_10rem_12rem_auto]">
                <Field label={t('patients.emergency_name')} error={errors.emergencyContacts?.[i]?.name?.message}>
                  <Input {...register(`emergencyContacts.${i}.name`)} />
                </Field>
                <Field label={t('patients.emergency_relation')} optional error={errors.emergencyContacts?.[i]?.relation?.message}>
                  <Input {...register(`emergencyContacts.${i}.relation`)} />
                </Field>
                <Field label={t('patients.emergency_phone')} error={errors.emergencyContacts?.[i]?.phone?.message}>
                  <Input type="tel" {...register(`emergencyContacts.${i}.phone`)} />
                </Field>
                <Button variant="ghost" size="sm" className="mt-6" aria-label={t('patients.remove_contact')} icon={<Trash2 className="h-4 w-4" />} onClick={() => contacts.remove(i)} />
              </div>
            ))}
          </div>
        </section>

        {canMedical && (
          <section className="card p-5" aria-labelledby="sec-medical">
            <h2 id="sec-medical" className="text-sm font-semibold text-ink">
              {t('patients.section_medical')}
            </h2>
            <p className="mb-4 text-xs text-ink-muted">{t('patients.section_medical_hint')}</p>
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="label !mb-0">{t('patients.allergies')}</span>
                <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => allergies.append({ allergen: '', reaction: null, severity: 'UNKNOWN' })}>
                  {t('patients.add_allergy')}
                </Button>
              </div>
              {allergies.fields.length === 0 && <p className="text-sm text-ink-muted">{t('patients.no_allergies')}</p>}
              <div className="space-y-3">
                {allergies.fields.map((f, i) => (
                  <div key={f.id} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
                    <Field label={t('patients.allergen')} error={errors.allergies?.[i]?.allergen?.message}>
                      <Input {...register(`allergies.${i}.allergen`)} />
                    </Field>
                    <Field label={t('patients.reaction')} optional>
                      <Input {...register(`allergies.${i}.reaction`)} />
                    </Field>
                    <Field label={t('patients.severity')}>
                      <Select {...register(`allergies.${i}.severity`)}>
                        {ALLERGY_SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {t(`severity.${s}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button variant="ghost" size="sm" className="mt-6" aria-label={t('patients.remove_allergy')} icon={<Trash2 className="h-4 w-4" />} onClick={() => allergies.remove(i)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {MEDICAL_FIELDS.map((f) => (
                <Field key={f} label={t(`patients.${f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`)} optional>
                  <Textarea rows={2} {...register(`medicalHistory.${f}`)} />
                </Field>
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(editing ? `/patients/${id}` : '/patients')} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {editing ? t('common.save_changes') : t('patients.register')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DuplicateList({ candidates }: { candidates: DuplicateCandidateDto[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-2 divide-y divide-border rounded border border-border bg-surface">
      {candidates.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
          <PatientLine patient={c} />
          <div className="flex items-center gap-1.5">
            {c.matchReasons.map((r) => (
              <Badge key={r} tone="warning">
                {t(`patients.match_${r}`)}
              </Badge>
            ))}
            <Link to={`/patients/${c.id}`} className="ml-1 text-xs font-medium text-primary-700 hover:underline">
              {t('patients.open')}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

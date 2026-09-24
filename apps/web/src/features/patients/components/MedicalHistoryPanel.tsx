import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ALLERGY_SEVERITIES,
  allergyInputSchema,
  medicalHistorySchema,
  PERMISSIONS,
  type AllergyDto,
  type PatientDto,
} from '@chamber/shared';
import { Badge, Button, ConfirmDialog, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { patientsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { formatRelative } from '@/utils/format';

const FIELDS = ['existingConditions', 'currentMedications', 'previousSurgeries', 'familyHistory', 'relevantHistory', 'lifestyle'] as const;
const labelKey = (f: string) => `patients.${f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

type HistoryForm = z.input<typeof medicalHistorySchema>;
type AllergyForm = z.input<typeof allergyInputSchema>;

/** Medical history and allergies (spec §5 "Medical Information"). Editing needs `patients.update_medical`. */
export function MedicalHistoryPanel({ patient }: { patient: PatientDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can(PERMISSIONS.PATIENTS_UPDATE_MEDICAL);
  const medical = patient.medical!;
  const [editing, setEditing] = useState(false);
  const [addingAllergy, setAddingAllergy] = useState(false);
  const [removing, setRemoving] = useState<AllergyDto | null>(null);

  const setPatient = (p: PatientDto) => {
    queryClient.setQueryData(['patients', patient.id], p);
    void queryClient.invalidateQueries({ queryKey: ['patients', patient.id, 'timeline'] });
  };

  const historyForm = useForm<HistoryForm>({ resolver: zodResolver(medicalHistorySchema) });
  useEffect(() => {
    if (editing) historyForm.reset(Object.fromEntries(FIELDS.map((f) => [f, medical.history[f] ?? ''])));
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveHistory = historyForm.handleSubmit(async (values) => {
    try {
      const saved = await patientsApi.updateMedical(patient.id, { ...medicalHistorySchema.parse(values), version: medical.history.version });
      setPatient(saved);
      toast.success(t('patients.medical_saved'));
      setEditing(false);
    } catch (err) {
      if (!applyServerErrors(err, historyForm.setError)) toast.error(errorMessage(err));
    }
  });

  const allergyForm = useForm<AllergyForm>({ resolver: zodResolver(allergyInputSchema), defaultValues: { severity: 'UNKNOWN' } });
  const saveAllergy = allergyForm.handleSubmit(async (values) => {
    try {
      setPatient(await patientsApi.addAllergy(patient.id, allergyInputSchema.parse(values)));
      toast.success(t('patients.allergy_added'));
      allergyForm.reset({ allergen: '', reaction: '', severity: 'UNKNOWN' });
      setAddingAllergy(false);
    } catch (err) {
      if (!applyServerErrors(err, allergyForm.setError)) toast.error(errorMessage(err));
    }
  });

  const removeAllergy = useMutation({
    mutationFn: ({ allergy, reason }: { allergy: AllergyDto; reason: string }) => patientsApi.removeAllergy(patient.id, allergy.id, reason),
    onSuccess: (p) => {
      setPatient(p);
      toast.success(t('patients.allergy_removed'));
      setRemoving(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="allergies-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="allergies-heading" className="text-sm font-semibold text-ink">
            {t('patients.allergies')}
          </h3>
          {canEdit && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddingAllergy(true)}>
              {t('patients.add_allergy')}
            </Button>
          )}
        </div>
        {medical.allergies.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('patients.no_allergies')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {medical.allergies.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <Badge tone={a.severity === 'SEVERE' ? 'danger' : a.severity === 'UNKNOWN' ? 'neutral' : 'warning'}>{t(`severity.${a.severity}`)}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{a.allergen}</p>
                  {a.reaction && <p className="text-xs text-ink-muted">{a.reaction}</p>}
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" aria-label={t('patients.remove_allergy')} icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(a)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-heading">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 id="history-heading" className="text-sm font-semibold text-ink">
              {t('patients.tab_medical')}
            </h3>
            {medical.history.updatedAt && (
              <p className="text-2xs text-ink-subtle">
                {t('patients.medical_updated_by', { time: formatRelative(medical.history.updatedAt), name: medical.history.updatedByName ?? '—' })}
              </p>
            )}
          </div>
          {canEdit && (
            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f}>
              <dt className="text-xs font-medium text-ink-subtle">{t(labelKey(f))}</dt>
              <dd className="mt-0.5 whitespace-pre-line text-sm text-ink">{medical.history[f] || <span className="text-ink-subtle">{t('patients.not_recorded')}</span>}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={t('patients.tab_medical')}
        size="lg"
        busy={historyForm.formState.isSubmitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="history-form" loading={historyForm.formState.isSubmitting}>
              {t('common.save_changes')}
            </Button>
          </>
        }
      >
        <form id="history-form" onSubmit={saveHistory} noValidate className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f, i) => (
            <Field key={f} label={t(labelKey(f))} error={historyForm.formState.errors[f]?.message} className={f === 'relevantHistory' ? 'sm:col-span-2' : undefined}>
              <Textarea rows={3} data-autofocus={i === 0 || undefined} {...historyForm.register(f)} />
            </Field>
          ))}
        </form>
      </Modal>

      <Modal
        open={addingAllergy}
        onClose={() => setAddingAllergy(false)}
        title={t('patients.add_allergy')}
        size="sm"
        busy={allergyForm.formState.isSubmitting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddingAllergy(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="allergy-form" loading={allergyForm.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="allergy-form" onSubmit={saveAllergy} noValidate className="space-y-4">
          <Field label={t('patients.allergen')} error={allergyForm.formState.errors.allergen?.message}>
            <Input data-autofocus {...allergyForm.register('allergen')} />
          </Field>
          <Field label={t('patients.reaction')} optional>
            <Input {...allergyForm.register('reaction')} />
          </Field>
          <Field label={t('patients.severity')}>
            <Select {...allergyForm.register('severity')}>
              {ALLERGY_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title={removing ? t('patients.remove_allergy_title', { name: removing.allergen }) : ''}
        body={t('patients.remove_allergy_body')}
        confirmLabel={t('patients.remove_allergy')}
        requireReason
        loading={removeAllergy.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => removing && removeAllergy.mutate({ allergy: removing, reason })}
      />
    </div>
  );
}

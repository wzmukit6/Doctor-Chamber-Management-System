import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { consultationsApi, vitalDefinitionsApi } from '@/services/endpoints';
import { errorMessage, translateMessage } from '@/utils/errors';

/** Front-desk vitals before the doctor sees the patient (adopted by the consultation). */
export function RecordVitalsModal({ appointmentId, patientName, onClose }: { appointmentId: string | null; patientName?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const defs = useQuery({ queryKey: ['vital-definitions'], queryFn: () => vitalDefinitionsApi.list(), staleTime: 10 * 60_000, enabled: !!appointmentId });
  const existing = useQuery({ queryKey: ['appointments', appointmentId, 'vitals'], queryFn: () => consultationsApi.preVitals(appointmentId!), enabled: !!appointmentId });
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) setValues(Object.fromEntries(existing.data.map((v) => [v.definitionId, v.value])));
  }, [existing.data]);

  const save = async () => {
    const vitals = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([definitionId, value]) => ({ definitionId, value }));
    if (!vitals.length) return onClose();
    setSaving(true);
    try {
      await consultationsApi.recordVitals(appointmentId!, vitals);
      toast.success(t('consultation.vitals_saved'));
      void queryClient.invalidateQueries({ queryKey: ['appointments', appointmentId, 'vitals'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [vitals[Number(/\.(\d+)\./.exec(d.path)?.[1] ?? -1)]?.definitionId ?? d.path, d.message])));
      } else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!appointmentId}
      onClose={onClose}
      title={t('consultation.record_vitals')}
      description={patientName}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {defs.isLoading || existing.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {defs.data?.map((d, i) => (
            <label key={d.id}>
              <span className="label">
                {d.label} {d.unit && <span className="font-normal text-ink-subtle">({d.unit})</span>}
              </span>
              <Input
                data-autofocus={i === 0 || undefined}
                inputMode={d.type === 'TEXT' ? 'text' : 'decimal'}
                placeholder={d.type === 'BLOOD_PRESSURE' ? '120/80' : ''}
                value={values[d.id] ?? ''}
                aria-invalid={errors[d.id] ? true : undefined}
                onChange={(e) => setValues({ ...values, [d.id]: e.target.value })}
              />
              {errors[d.id] && <span className="text-2xs text-danger">{translateMessage(errors[d.id])}</span>}
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

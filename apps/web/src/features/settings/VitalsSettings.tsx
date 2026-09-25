import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { PERMISSIONS, VITAL_TYPES, type VitalDefinitionDto, type VitalType } from '@chamber/shared';
import { Badge, Button, Field, Input, Modal, Select, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { vitalDefinitionsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage, translateMessage } from '@/utils/errors';

/** Configurable examination fields (spec §9, §34). */
export function VitalsSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can(PERMISSIONS.SETTINGS_MANAGE);
  const canGlobal = can(PERMISSIONS.SYSTEM_MANAGE);
  const q = useQuery({ queryKey: ['vital-definitions', 'all'], queryFn: () => vitalDefinitionsApi.list(true) });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ key: '', label: '', unit: '', type: 'NUMBER' as VitalType, minValue: '', maxValue: '', decimals: '0', sortOrder: '100' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vital-definitions'] });
  };
  const toggle = useMutation({
    mutationFn: (v: VitalDefinitionDto) => vitalDefinitionsApi.update(v.id, { isActive: !v.isActive }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const create = useMutation({
    mutationFn: () =>
      vitalDefinitionsApi.create({
        key: form.key.trim(),
        label: form.label.trim(),
        unit: form.unit.trim() || null,
        type: form.type,
        minValue: form.minValue ? Number(form.minValue) : null,
        maxValue: form.maxValue ? Number(form.maxValue) : null,
        decimals: Number(form.decimals),
        sortOrder: Number(form.sortOrder),
      }),
    onSuccess: () => {
      toast.success(t('settings.vital_saved'));
      setAdding(false);
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    },
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <section className="card p-5">
      <p className="mb-4 text-sm text-ink-muted">{t('settings.vitals_intro')}</p>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th scope="col">{t('settings.vital_label')}</th>
              <th scope="col">{t('settings.vital_key')}</th>
              <th scope="col">{t('settings.vital_type')}</th>
              <th scope="col">{t('settings.vital_range')}</th>
              <th scope="col">{t('catalog.scope')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((v) => (
              <tr key={v.id} className={v.isActive ? undefined : 'opacity-50'}>
                <td className="font-medium text-ink">
                  {v.label} {v.unit && <span className="text-xs text-ink-subtle">({v.unit})</span>}
                </td>
                <td className="font-mono text-xs">{v.key}</td>
                <td>{t(`settings.vital_type_${v.type}`)}</td>
                <td className="text-ink-muted">{v.minValue !== null || v.maxValue !== null ? `${v.minValue ?? '…'} – ${v.maxValue ?? '…'}` : '—'}</td>
                <td>
                  <Badge tone={v.isGlobal ? 'info' : 'primary'}>{v.isGlobal ? t('catalog.global') : t('catalog.chamber')}</Badge>
                </td>
                <td className="text-right">
                  {editable && (!v.isGlobal || canGlobal) && (
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(v)}>
                      {v.isActive ? t('catalog.deactivate') : t('catalog.activate')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setErrors({}), setAdding(true))}>
            {t('settings.add_vital')}
          </Button>
        </div>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={t('settings.add_vital')}
        busy={create.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.vital_label')} error={translateMessage(errors.label)}>
            <Input data-autofocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label={t('settings.vital_key')} hint="e.g. waist_circumference" error={translateMessage(errors.key)}>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
          </Field>
          <Field label={t('settings.vital_type')}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as VitalType })}>
              {VITAL_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`settings.vital_type_${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.vital_unit')} optional>
            <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
          {form.type === 'NUMBER' && (
            <>
              <Field label={t('settings.min')} optional>
                <Input type="number" value={form.minValue} onChange={(e) => setForm({ ...form, minValue: e.target.value })} />
              </Field>
              <Field label={t('settings.max')} optional error={translateMessage(errors.maxValue)}>
                <Input type="number" value={form.maxValue} onChange={(e) => setForm({ ...form, maxValue: e.target.value })} />
              </Field>
              <Field label={t('settings.vital_decimals')}>
                <Input type="number" min={0} max={3} value={form.decimals} onChange={(e) => setForm({ ...form, decimals: e.target.value })} />
              </Field>
            </>
          )}
          <Field label={t('settings.vital_order')}>
            <Input type="number" min={0} max={1000} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </section>
  );
}

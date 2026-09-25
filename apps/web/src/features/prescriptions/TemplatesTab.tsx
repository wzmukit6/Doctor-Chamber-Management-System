import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PERMISSIONS, type PrescriptionTemplateDto } from '@chamber/shared';
import { ActionMenu, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Skeleton, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { templatesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage, translateMessage } from '@/utils/errors';
import { formatRelative } from '@/utils/format';
import { CatalogPicker } from '@/features/consultations/components/CatalogPicker';
import { PrescriptionBuilder } from './components/PrescriptionBuilder';
import { RxItemsView } from './components/RxItemsView';
import { contentPayload, draftFrom, type RxDraft } from './rx';

/** Personal and chamber-shared prescription templates (spec §11). */
export function TemplatesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['prescription-templates'], queryFn: templatesApi.list });
  const [editing, setEditing] = useState<PrescriptionTemplateDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PrescriptionTemplateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can(PERMISSIONS.TEMPLATES_MANAGE);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await templatesApi.remove(deleting.id);
      toast.success(t('rx.template_deleted'));
      void queryClient.invalidateQueries({ queryKey: ['prescription-templates'] });
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">{t('rx.templates_intro')}</p>
        {canManage && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            {t('rx.new_template')}
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !q.data?.length ? (
        <EmptyState icon={<LayoutTemplate className="h-6 w-6" />} title={t('rx.no_templates')} description={t('rx.no_templates_help')} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {q.data.map((tpl) => (
            <li key={tpl.id} className="card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{tpl.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {tpl.shared ? t('rx.shared') : t('rx.personal')} · {tpl.ownerName ?? '—'} · {formatRelative(tpl.updatedAt)}
                  </p>
                  {tpl.description && <p className="mt-1 text-sm text-ink-muted">{tpl.description}</p>}
                </div>
                <Badge tone={tpl.shared ? 'info' : 'primary'}>{tpl.shared ? t('rx.shared') : t('rx.personal')}</Badge>
                {tpl.canEdit && (
                  <ActionMenu
                    label={t('common.actions')}
                    items={[
                      { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(tpl) },
                      { label: t('common.delete'), icon: <Trash2 className="h-4 w-4" />, tone: 'danger', onSelect: () => setDeleting(tpl) },
                    ]}
                  />
                )}
              </div>
              {(tpl.diagnoses.length > 0 || tpl.investigations.length > 0) && (
                <div className="mt-3 space-y-1 text-xs">
                  {tpl.diagnoses.length > 0 && (
                    <p>
                      <span className="text-ink-subtle">{t('consultation.diagnosis')}:</span> {tpl.diagnoses.map((d) => d.name).join(', ')}
                    </p>
                  )}
                  {tpl.investigations.length > 0 && (
                    <p>
                      <span className="text-ink-subtle">{t('consultation.investigations')}:</span> {tpl.investigations.map((i) => i.name).join(', ')}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 border-t border-border pt-3">
                <RxItemsView items={tpl.items} advice={tpl.advice} />
                {tpl.followUpInstructions && (
                  <p className="mt-2 text-xs text-ink-muted">
                    <span className="text-ink-subtle">{t('consultation.follow_up')}:</span> {tpl.followUpInstructions}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <TemplateEditor template={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        title={t('rx.delete_template')}
        body={t('rx.delete_template_body', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

interface EditorState {
  name: string;
  description: string;
  shared: boolean;
  diagnoses: PrescriptionTemplateDto['diagnoses'];
  investigations: PrescriptionTemplateDto['investigations'];
  rx: RxDraft;
  followUpInstructions: string;
}

function TemplateEditor({ template, onClose }: { template: PrescriptionTemplateDto | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [s, setS] = useState<EditorState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isNew = template === 'new';

  useEffect(() => {
    if (!template) return setS(null);
    setErrors({});
    setS(
      template === 'new'
        ? { name: '', description: '', shared: !user?.doctorId, diagnoses: [], investigations: [], rx: { items: [], advice: '' }, followUpInstructions: '' }
        : {
            name: template.name,
            description: template.description ?? '',
            shared: template.shared,
            diagnoses: template.diagnoses,
            investigations: template.investigations,
            rx: draftFrom(template.items, template.advice),
            followUpInstructions: template.followUpInstructions ?? '',
          },
    );
  }, [template, user?.doctorId]);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const body = {
      name: s.name.trim(),
      description: s.description.trim() || null,
      shared: s.shared,
      diagnoses: s.diagnoses.map((d, i) => ({ diagnosisId: d.diagnosisId ?? null, name: d.name, code: d.code ?? null, isPrimary: i === 0, certainty: d.certainty ?? 'CONFIRMED' })),
      investigations: s.investigations.map((x) => ({ investigationId: x.investigationId ?? null, name: x.name, instructions: x.instructions ?? null, priority: x.priority ?? 'ROUTINE' })),
      ...contentPayload(s.rx),
      followUpInstructions: s.followUpInstructions.trim() || null,
    };
    try {
      if (isNew) await templatesApi.create(body);
      else await templatesApi.update((template as PrescriptionTemplateDto).id, { ...body, version: (template as PrescriptionTemplateDto).version });
      toast.success(t('rx.template_saved'));
      void queryClient.invalidateQueries({ queryKey: ['prescription-templates'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const chip = (label: string, onRemove: () => void) => (
    <li key={label} className="inline-flex items-center gap-1 rounded-full border border-border bg-canvas py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button type="button" onClick={onRemove} aria-label={t('rx.remove', { name: label })} className="rounded-full p-0.5 text-ink-subtle hover:text-danger">
        <X className="h-3 w-3" />
      </button>
    </li>
  );

  return (
    <Modal
      open={!!template}
      onClose={onClose}
      size="lg"
      title={isNew ? t('rx.new_template') : t('rx.edit_template')}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!s?.name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {s && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('rx.template_name')} error={errors.name ? translateMessage(errors.name) : undefined}>
              <Input data-autofocus value={s.name} maxLength={120} placeholder={t('rx.template_name_placeholder')} onChange={(e) => setS({ ...s, name: e.target.value })} />
            </Field>
            <Field label={t('rx.template_description')} optional>
              <Input value={s.description} maxLength={300} onChange={(e) => setS({ ...s, description: e.target.value })} />
            </Field>
          </div>
          {user?.doctorId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={s.shared} onChange={(e) => setS({ ...s, shared: e.target.checked })} />
              {t('rx.share_with_chamber')}
            </label>
          )}
          <div>
            <span className="label">{t('consultation.diagnosis')}</span>
            <CatalogPicker
              kind="diagnoses"
              showFrequent={false}
              placeholder={t('consultation.diagnosis_placeholder')}
              exclude={s.diagnoses.map((d) => d.name)}
              onPick={(item) => setS({ ...s, diagnoses: [...s.diagnoses, { diagnosisId: item.id, name: item.name, code: item.code ?? null }] })}
            />
            {s.diagnoses.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{s.diagnoses.map((d, i) => chip(d.name, () => setS({ ...s, diagnoses: s.diagnoses.filter((_, j) => j !== i) })))}</ul>}
          </div>
          <div>
            <span className="label">{t('consultation.investigations')}</span>
            <CatalogPicker
              kind="investigations"
              showFrequent={false}
              placeholder={t('consultation.investigation_placeholder')}
              exclude={s.investigations.map((d) => d.name)}
              onPick={(item) => setS({ ...s, investigations: [...s.investigations, { investigationId: item.id, name: item.name }] })}
            />
            {s.investigations.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">{s.investigations.map((d, i) => chip(d.name, () => setS({ ...s, investigations: s.investigations.filter((_, j) => j !== i) })))}</ul>
            )}
          </div>
          <div>
            <span className="label">{t('rx.medicines')}</span>
            <PrescriptionBuilder value={s.rx} onChange={(rx) => setS({ ...s, rx })} errors={errors} errorPrefix="" />
          </div>
          <Field label={t('consultation.follow_up_instructions')} optional>
            <Input value={s.followUpInstructions} maxLength={500} onChange={(e) => setS({ ...s, followUpInstructions: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

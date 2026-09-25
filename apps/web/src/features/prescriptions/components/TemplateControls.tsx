import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, ChevronDown, LayoutTemplate } from 'lucide-react';
import { PERMISSIONS, type PrescriptionItemInput, type PrescriptionTemplateDto, type PrescriptionTemplateInput } from '@chamber/shared';
import { ActionMenu, Button, Field, Input, Modal, useToast } from '@/components/ui';
import { ApiError } from '@/services/api';
import { templatesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage, translateMessage } from '@/utils/errors';

/** "Apply template" dropdown (spec §11). */
export function TemplateApplyMenu({ onApply }: { onApply: (t: PrescriptionTemplateDto) => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['prescription-templates'], queryFn: templatesApi.list, staleTime: 60_000 });
  const list = q.data ?? [];
  if (!list.length) {
    return (
      <Button size="sm" variant="secondary" disabled icon={<LayoutTemplate className="h-4 w-4" />}>
        {t('rx.no_templates')}
      </Button>
    );
  }
  return (
    <ActionMenu
      align="left"
      label={t('rx.apply_template')}
      trigger={
        <>
          <LayoutTemplate className="h-4 w-4" aria-hidden /> {t('rx.apply_template')} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </>
      }
      items={list.map((tpl) => ({ label: tpl.shared ? `${tpl.name} · ${t('rx.shared')}` : tpl.name, onSelect: () => onApply(tpl) }))}
    />
  );
}

export type TemplateContent = Pick<PrescriptionTemplateInput, 'diagnoses' | 'investigations' | 'advice' | 'followUpInstructions'> & { items: PrescriptionItemInput[] };

/** Saves the current consultation content as a reusable template. */
export function SaveTemplateButton({ content, disabled }: { content: () => TemplateContent; disabled?: boolean }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can(PERMISSIONS.TEMPLATES_MANAGE)) return null;
  return (
    <>
      <Button size="sm" variant="secondary" icon={<BookmarkPlus className="h-4 w-4" />} disabled={disabled} onClick={() => setOpen(true)}>
        {t('rx.save_template')}
      </Button>
      <TemplateNameDialog open={open} onClose={() => setOpen(false)} content={content} />
    </>
  );
}

function TemplateNameDialog({ open, onClose, content }: { open: boolean; onClose: () => void; content: () => TemplateContent }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setShared(!user?.doctorId);
      setError(null);
    }
  }, [open, user?.doctorId]);
  const c = open ? content() : null;

  const save = async () => {
    setSaving(true);
    try {
      await templatesApi.create({ ...content(), name: name.trim(), shared });
      toast.success(t('rx.template_saved'));
      void queryClient.invalidateQueries({ queryKey: ['prescription-templates'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setError(err.details[0]!.message);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('rx.save_template')}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('rx.template_name')} error={error ? translateMessage(error) : undefined}>
          <Input data-autofocus value={name} maxLength={120} placeholder={t('rx.template_name_placeholder')} onChange={(e) => setName(e.target.value)} />
        </Field>
        {user?.doctorId && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {t('rx.share_with_chamber')}
          </label>
        )}
        {c && (
          <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">
            {t('rx.template_contains', { diagnoses: c.diagnoses.length, investigations: c.investigations.length, medicines: c.items.length })}
          </p>
        )}
      </div>
    </Modal>
  );
}

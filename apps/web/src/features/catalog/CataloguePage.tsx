import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Pencil, Plus, Power, Search } from 'lucide-react';
import { PERMISSIONS, type CatalogItemDto } from '@chamber/shared';
import { ActionMenu, Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, useToast, type Column } from '@/components/ui';
import { ApiError } from '@/services/api';
import { catalogApi, type CatalogKind } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, translateMessage } from '@/utils/errors';

const MANAGE: Record<CatalogKind, string> = {
  investigations: PERMISSIONS.INVESTIGATIONS_MANAGE,
  diagnoses: PERMISSIONS.DIAGNOSIS_MANAGE,
  complaints: PERMISSIONS.DIAGNOSIS_MANAGE,
};
type Form = Record<string, string | boolean>;

/** Clinical master data (spec §15–§17): investigations, diagnoses (ICD-compatible) and complaints. */
export function CataloguePage() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<CatalogKind>('investigations');
  return (
    <div>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />
      <div className="mb-4 border-b border-border" role="tablist">
        <div className="-mb-px flex gap-1">
          {(['investigations', 'diagnoses', 'complaints'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={clsx('border-b-2 px-3 py-2 text-sm font-medium', kind === k ? 'border-primary-700 text-primary-800' : 'border-transparent text-ink-muted hover:text-ink')}
            >
              {t(`catalog.tab_${k}`)}
            </button>
          ))}
        </div>
      </div>
      <CatalogTable key={kind} kind={kind} />
    </div>
  );
}

function CatalogTable({ kind }: { kind: CatalogKind }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can(MANAGE[kind] as never);
  const canGlobal = can(PERMISSIONS.SYSTEM_MANAGE);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<CatalogItemDto | 'new' | null>(null);
  const q = useDebounce(search.trim(), 200);
  const list = useQuery({
    queryKey: ['catalog', kind, 'admin', q, scope, inactive],
    queryFn: () => catalogApi.search(kind, { q: q || undefined, scope, includeInactive: inactive, limit: 200 }),
  });
  const toggle = useMutation({
    mutationFn: (item: CatalogItemDto) => catalogApi.setStatus(kind, item.id, !item.isActive),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['catalog', kind] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const editableItem = (i: CatalogItemDto) => canManage && (!i.isGlobal || canGlobal);

  const columns: Column<CatalogItemDto>[] = [
    {
      key: 'name',
      header: t('catalog.name'),
      cell: (i) => (
        <span className={clsx('font-medium', i.isActive ? 'text-ink' : 'text-ink-subtle line-through')}>
          {i.name}
          {i.shortName && <span className="ml-2 text-xs font-normal text-ink-subtle">{i.shortName}</span>}
        </span>
      ),
    },
    ...(kind === 'diagnoses' ? [{ key: 'code', header: t('catalog.code'), cell: (i: CatalogItemDto) => <span className="font-mono text-xs">{i.code ?? '—'}</span> }] : []),
    ...(kind !== 'complaints' ? [{ key: 'category', header: t('catalog.category'), hideOnMobile: true, cell: (i: CatalogItemDto) => <span className="text-ink-muted">{i.category ?? '—'}</span> }] : []),
    ...(kind === 'investigations' ? [{ key: 'sample', header: t('catalog.sample_type'), hideOnMobile: true, cell: (i: CatalogItemDto) => <span className="text-ink-muted">{i.sampleType ?? '—'}</span> }] : []),
    {
      key: 'scope',
      header: t('catalog.scope'),
      cell: (i) => (
        <span className="flex gap-1">
          <Badge tone={i.isGlobal ? 'info' : 'primary'}>{i.isGlobal ? t('catalog.global') : t('catalog.chamber')}</Badge>
          {!i.isActive && <Badge>{t('catalog.inactive')}</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (i) =>
        editableItem(i) ? (
          <ActionMenu
            label={t('common.actions')}
            items={[
              { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(i) },
              { label: i.isActive ? t('catalog.deactivate') : t('catalog.activate'), icon: <Power className="h-4 w-4" />, tone: i.isActive ? 'danger' : 'default', onSelect: () => toggle.mutate(i) },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input type="search" aria-label={t('common.search')} placeholder={t('common.search_placeholder')} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label={t('catalog.scope')} className="!w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">{t('catalog.all')}</option>
          <option value="global">{t('catalog.global')}</option>
          <option value="chamber">{t('catalog.chamber')}</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {t('catalog.show_inactive')}
        </label>
        {canManage && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            {t('catalog.new')}
          </Button>
        )}
      </div>
      <DataTable
        caption={t(`catalog.tab_${kind}`)}
        columns={columns}
        rows={list.data}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t('catalog.empty')} />}
      />
      <p className="mt-2 text-xs text-ink-subtle">{t('catalog.global_hint')}</p>
      <CatalogForm kind={kind} item={editing} canGlobal={canGlobal} onClose={() => setEditing(null)} />
    </>
  );
}

function CatalogForm({ kind, item, canGlobal, onClose }: { kind: CatalogKind; item: CatalogItemDto | 'new' | null; canGlobal: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isNew = item === 'new';
  useEffect(() => {
    if (!item) return;
    setErrors({});
    setForm(
      item === 'new'
        ? { global: false }
        : { name: item.name, code: item.code ?? '', category: item.category ?? '', description: item.description ?? '', keywords: item.keywords ?? '', shortName: item.shortName ?? '', sampleType: item.sampleType ?? '', instructions: item.instructions ?? '' },
    );
  }, [item]);

  const fields: { key: string; label: string; area?: boolean }[] =
    kind === 'diagnoses'
      ? [
          { key: 'name', label: t('catalog.name') },
          { key: 'code', label: t('catalog.code') },
          { key: 'category', label: t('catalog.category') },
          { key: 'keywords', label: t('catalog.keywords') },
          { key: 'description', label: t('catalog.description'), area: true },
        ]
      : kind === 'investigations'
        ? [
            { key: 'name', label: t('catalog.name') },
            { key: 'shortName', label: t('catalog.short_name') },
            { key: 'category', label: t('catalog.category') },
            { key: 'sampleType', label: t('catalog.sample_type') },
            { key: 'instructions', label: t('catalog.instructions'), area: true },
          ]
        : [{ key: 'name', label: t('catalog.name') }];

  const save = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, typeof form[f.key] === 'string' && (form[f.key] as string).trim() ? (form[f.key] as string).trim() : f.key === 'name' ? '' : null]));
    if (isNew) payload.global = !!form.global;
    try {
      if (isNew) await catalogApi.create(kind, payload);
      else await catalogApi.update(kind, (item as CatalogItemDto).id, payload);
      toast.success(t('catalog.saved'));
      void queryClient.invalidateQueries({ queryKey: ['catalog', kind] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={isNew ? t('catalog.new') : t('catalog.edit')}
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
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f, i) => (
          <Field key={f.key} label={f.label} error={errors[f.key] ? translateMessage(errors[f.key]) : undefined} optional={f.key !== 'name'} className={f.area || f.key === 'name' ? 'sm:col-span-2' : undefined}>
            {f.area ? (
              <Textarea rows={2} value={(form[f.key] as string) ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <Input data-autofocus={i === 0 || undefined} value={(form[f.key] as string) ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        {isNew && canGlobal && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={!!form.global} onChange={(e) => setForm({ ...form, global: e.target.checked })} />
            {t('catalog.make_global')}
          </label>
        )}
      </div>
    </Modal>
  );
}

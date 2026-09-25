import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Pencil, Plus, Power, Search, Star } from 'lucide-react';
import { MEDICINE_FORMS, MEDICINE_ROUTES, PERMISSIONS, type MedicineDto } from '@chamber/shared';
import { ActionMenu, Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, useToast, type Column } from '@/components/ui';
import { ApiError } from '@/services/api';
import { medicinesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, translateMessage } from '@/utils/errors';

/**
 * Medicine database (spec §15): global generic entries (platform-managed) and
 * chamber-specific medicines with brand names. Doctors star favourites for
 * one-click prescribing.
 */
export function MedicinesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const canCreate = can(PERMISSIONS.MEDICINES_CREATE);
  const canUpdate = can(PERMISSIONS.MEDICINES_UPDATE);
  const canDelete = can(PERMISSIONS.MEDICINES_DELETE);
  const canGlobal = can(PERMISSIONS.MEDICINES_MANAGE_GLOBAL);
  const canFavorite = !!user?.doctorId && can(PERMISSIONS.PRESCRIPTIONS_CREATE);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [form, setForm] = useState('');
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<MedicineDto | 'new' | null>(null);
  const q = useDebounce(search.trim(), 200);
  const list = useQuery({
    queryKey: ['medicines', 'admin', q, scope, form, inactive],
    queryFn: () => medicinesApi.search({ q: q || undefined, scope, form: form || undefined, includeInactive: inactive, limit: 200 }),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['medicines'] });
  const toggle = useMutation({ mutationFn: (m: MedicineDto) => medicinesApi.setStatus(m.id, !m.isActive), onSuccess: invalidate, onError: (err) => toast.error(errorMessage(err)) });
  const favorite = useMutation({ mutationFn: (m: MedicineDto) => medicinesApi.favorite(m.id, !m.isFavorite), onSuccess: invalidate, onError: (err) => toast.error(errorMessage(err)) });
  const editable = (m: MedicineDto) => canUpdate && (!m.isGlobal || canGlobal);

  const columns: Column<MedicineDto>[] = [
    ...(canFavorite
      ? [
          {
            key: 'fav',
            header: '',
            className: 'w-10',
            cell: (m: MedicineDto) => (
              <button type="button" onClick={() => favorite.mutate(m)} aria-pressed={m.isFavorite} aria-label={t('rx.favorite_named', { name: m.brandName ?? m.genericName })} className="rounded p-1 text-ink-subtle hover:text-warning">
                <Star className={clsx('h-4 w-4', m.isFavorite && 'fill-current text-warning')} />
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'name',
      header: t('medicines.name'),
      cell: (m) => (
        <span className={clsx(!m.isActive && 'text-ink-subtle line-through')}>
          <span className="font-medium text-ink">{m.brandName ?? m.genericName}</span>
          {m.strength && <span className="ml-1.5 text-ink-muted">{m.strength}</span>}
          {m.brandName && <span className="block text-xs text-ink-subtle">{m.genericName}</span>}
        </span>
      ),
    },
    { key: 'form', header: t('medicines.form'), cell: (m) => <span className="text-ink-muted">{t(`medicineForm.${m.form}`)}</span> },
    { key: 'category', header: t('catalog.category'), hideOnMobile: true, cell: (m) => <span className="text-ink-muted">{m.category ?? '—'}</span> },
    { key: 'maker', header: t('medicines.manufacturer'), hideOnMobile: true, cell: (m) => <span className="text-ink-muted">{m.manufacturer ?? '—'}</span> },
    {
      key: 'scope',
      header: t('catalog.scope'),
      cell: (m) => (
        <span className="flex gap-1">
          <Badge tone={m.isGlobal ? 'info' : 'primary'}>{m.isGlobal ? t('catalog.global') : t('catalog.chamber')}</Badge>
          {!m.isActive && <Badge>{t('catalog.inactive')}</Badge>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (m) =>
        editable(m) ? (
          <ActionMenu
            label={t('common.actions')}
            items={[
              { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(m) },
              {
                label: m.isActive ? t('catalog.deactivate') : t('catalog.activate'),
                icon: <Power className="h-4 w-4" />,
                tone: m.isActive ? 'danger' : 'default',
                hidden: m.isActive && !canDelete,
                onSelect: () => toggle.mutate(m),
              },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('medicines.title')}
        subtitle={t('medicines.subtitle')}
        actions={
          canCreate && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              {t('medicines.new')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input type="search" aria-label={t('common.search')} placeholder={t('medicines.search_placeholder')} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label={t('medicines.form')} className="!w-auto" value={form} onChange={(e) => setForm(e.target.value)}>
          <option value="">{t('medicines.all_forms')}</option>
          {MEDICINE_FORMS.map((f) => (
            <option key={f} value={f}>
              {t(`medicineForm.${f}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('catalog.scope')} className="!w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">{t('catalog.all')}</option>
          <option value="global">{t('catalog.global')}</option>
          <option value="chamber">{t('catalog.chamber')}</option>
          {canFavorite && <option value="favorites">{t('rx.favorites')}</option>}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {t('catalog.show_inactive')}
        </label>
      </div>
      <DataTable
        caption={t('medicines.title')}
        columns={columns}
        rows={list.data}
        rowKey={(m) => m.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t('medicines.empty')} />}
      />
      <p className="mt-2 text-xs text-ink-subtle">{t('medicines.global_hint')}</p>
      <MedicineForm item={editing} canGlobal={canGlobal} onClose={() => setEditing(null)} />
    </div>
  );
}

type FormState = Record<string, string | boolean>;
const TEXT_FIELDS = ['genericName', 'brandName', 'manufacturer', 'strength', 'category', 'defaultDose', 'keywords'] as const;

function MedicineForm({ item, canGlobal, onClose }: { item: MedicineDto | 'new' | null; canGlobal: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState<FormState>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isNew = item === 'new';
  useEffect(() => {
    if (!item) return;
    setErrors({});
    setF(
      item === 'new'
        ? { form: 'TABLET', route: '', global: false }
        : {
            ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, (item[k] as string | null) ?? ''])),
            form: item.form,
            route: item.route ?? '',
            commonFrequencies: item.commonFrequencies.join(', '),
            commonDurations: item.commonDurations.join(', '),
          },
    );
  }, [item]);
  const set = (k: string, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }));
  const text = (k: string) => (f[k] as string) ?? '';
  const list = (k: string) =>
    text(k)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {
      ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, text(k).trim() || (k === 'genericName' ? '' : null)])),
      form: f.form,
      route: f.route || null,
      commonFrequencies: list('commonFrequencies'),
      commonDurations: list('commonDurations'),
      ...(isNew ? { global: !!f.global } : {}),
    };
    try {
      if (isNew) await medicinesApi.create(payload);
      else await medicinesApi.update((item as MedicineDto).id, payload);
      toast.success(t('medicines.saved'));
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const err = (k: string) => (errors[k] ? translateMessage(errors[k]) : undefined);

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="lg"
      title={isNew ? t('medicines.new') : t('medicines.edit')}
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
        <Field label={t('medicines.generic_name')} error={err('genericName')}>
          <Input data-autofocus value={text('genericName')} maxLength={200} onChange={(e) => set('genericName', e.target.value)} />
        </Field>
        <Field label={t('medicines.brand_name')} optional error={err('brandName')}>
          <Input value={text('brandName')} maxLength={200} onChange={(e) => set('brandName', e.target.value)} />
        </Field>
        <Field label={t('medicines.form')}>
          <Select value={(f.form as string) ?? 'TABLET'} onChange={(e) => set('form', e.target.value)}>
            {MEDICINE_FORMS.map((x) => (
              <option key={x} value={x}>
                {t(`medicineForm.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('medicines.strength')} optional hint={t('medicines.strength_hint')}>
          <Input value={text('strength')} maxLength={80} onChange={(e) => set('strength', e.target.value)} />
        </Field>
        <Field label={t('rx.route')} optional>
          <Select value={(f.route as string) ?? ''} onChange={(e) => set('route', e.target.value)}>
            <option value="">—</option>
            {MEDICINE_ROUTES.map((x) => (
              <option key={x} value={x}>
                {t(`route.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('medicines.manufacturer')} optional>
          <Input value={text('manufacturer')} maxLength={150} onChange={(e) => set('manufacturer', e.target.value)} />
        </Field>
        <Field label={t('catalog.category')} optional>
          <Input value={text('category')} maxLength={100} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label={t('medicines.default_dose')} optional hint={t('rx.dose_placeholder')}>
          <Input value={text('defaultDose')} maxLength={60} onChange={(e) => set('defaultDose', e.target.value)} />
        </Field>
        <Field label={t('medicines.common_frequencies')} optional hint={t('medicines.list_hint', { example: '1+0+1, 0+0+1' })}>
          <Input value={text('commonFrequencies')} onChange={(e) => set('commonFrequencies', e.target.value)} />
        </Field>
        <Field label={t('medicines.common_durations')} optional hint={t('medicines.list_hint', { example: '5 days, 1 month' })}>
          <Input value={text('commonDurations')} onChange={(e) => set('commonDurations', e.target.value)} />
        </Field>
        <Field label={t('catalog.keywords')} optional className="sm:col-span-2">
          <Input value={text('keywords')} maxLength={300} onChange={(e) => set('keywords', e.target.value)} />
        </Field>
        {isNew && canGlobal && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-primary-700" checked={!!f.global} onChange={(e) => set('global', e.target.checked)} />
            {t('medicines.make_global')}
          </label>
        )}
      </div>
    </Modal>
  );
}

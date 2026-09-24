import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { createChamberSchema, PERMISSIONS, type ChamberDto } from '@chamber/shared';
import {
  ActionMenu,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  useToast,
  type Column,
} from '@/components/ui';
import { chambersApi, organizationsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { Can } from '@/permissions/Can';

const formSchema = createChamberSchema.extend({ isActive: z.boolean().optional() });
type FormValues = z.input<typeof formSchema>;

function ChamberForm({ chamber, open, onClose, defaultOrgId }: { chamber: ChamberDto | null; open: boolean; onClose: () => void; defaultOrgId?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user!.activeMembership.role === 'SUPER_ADMIN';
  const orgs = useQuery({
    queryKey: ['organizations', 'options'],
    queryFn: () => organizationsApi.list({ pageSize: 100, sort: 'name', order: 'asc' }),
    enabled: open && isSuperAdmin && !chamber,
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (!open) return;
    reset(
      chamber
        ? {
            organizationId: chamber.organizationId,
            name: chamber.name,
            code: chamber.code,
            phone: chamber.phone,
            email: chamber.email,
            address: chamber.address,
            timezone: chamber.timezone,
            isActive: chamber.isActive,
          }
        : { organizationId: defaultOrgId ?? '', timezone: 'Asia/Dhaka' },
    );
  }, [open, chamber, reset, defaultOrgId]);

  const onSubmit = handleSubmit(async (values) => {
    const v = formSchema.parse(values);
    try {
      if (chamber) {
        const { organizationId: _o, code: _c, isActive, ...rest } = v;
        await chambersApi.update(chamber.id, { ...rest, ...(isSuperAdmin ? { isActive } : {}), version: chamber.version });
      } else {
        await chambersApi.create(v);
      }
      toast.success(chamber ? t('chambers.updated') : t('chambers.created'));
      void queryClient.invalidateQueries({ queryKey: ['chambers'] });
      onClose();
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  const nullIfEmpty = { setValueAs: (v: string) => (v === '' ? null : v) };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={chamber ? t('chambers.edit') : t('chambers.new')}
      busy={isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="chamber-form" loading={isSubmitting}>
            {chamber ? t('common.save_changes') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="chamber-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {!chamber && (
          <Field label={t('chambers.organization')} error={errors.organizationId?.message} className="sm:col-span-2">
            <Select {...register('organizationId')}>
              <option value="">—</option>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('common.name')} error={errors.name?.message}>
          <Input data-autofocus {...register('name')} />
        </Field>
        <Field label={t('chambers.code')} error={errors.code?.message} hint={t('chambers.code_hint')}>
          <Input disabled={!!chamber} className="uppercase" {...register('code')} />
        </Field>
        <Field label={t('common.phone')} error={errors.phone?.message} optional>
          <Input type="tel" {...register('phone', nullIfEmpty)} />
        </Field>
        <Field label={t('common.email')} error={errors.email?.message} optional>
          <Input type="email" {...register('email', nullIfEmpty)} />
        </Field>
        <Field label={t('common.address')} error={errors.address?.message} optional className="sm:col-span-2">
          <Textarea rows={2} {...register('address')} />
        </Field>
        <Field label={t('chambers.timezone')} error={errors.timezone?.message}>
          <Input {...register('timezone')} />
        </Field>
        {chamber && isSuperAdmin && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary-700" {...register('isActive')} />
            {t('common.active')}
          </label>
        )}
      </form>
    </Modal>
  );
}

export function ChambersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organizationId') ?? '';
  const isSuperAdmin = user!.activeMembership.role === 'SUPER_ADMIN';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ open: boolean; chamber: ChamberDto | null }>({ open: false, chamber: null });
  const [removing, setRemoving] = useState<ChamberDto | null>(null);
  const q = useDebounce(search);
  const query = { page, pageSize: 20, q, organizationId: organizationId || undefined };
  const list = useQuery({ queryKey: ['chambers', query], queryFn: () => chambersApi.list(query), placeholderData: keepPreviousData });
  const orgs = useQuery({
    queryKey: ['organizations', 'options'],
    queryFn: () => organizationsApi.list({ pageSize: 100, sort: 'name', order: 'asc' }),
    enabled: isSuperAdmin,
  });

  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => chambersApi.remove(id, reason),
    onSuccess: () => {
      toast.success(t('chambers.removed'));
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['chambers'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns: Column<ChamberDto>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (c) => (
        <div>
          <p className="font-medium text-ink">
            {c.name} {c.id === user!.activeMembership.chamber?.id && <Badge tone="primary">{t('chambers.my_chamber')}</Badge>}{' '}
            {c.isDemo && <Badge tone="warning">{t('app.demo')}</Badge>}
          </p>
          <p className="text-xs text-ink-subtle">{c.address ?? t('common.none')}</p>
        </div>
      ),
    },
    { key: 'code', header: t('chambers.code'), cell: (c) => <span className="font-mono text-xs">{c.code}</span> },
    { key: 'org', header: t('chambers.organization'), hideOnMobile: true, cell: (c) => <span className="text-ink-muted">{c.organizationName}</span> },
    { key: 'staff', header: t('chambers.staff'), hideOnMobile: true, cell: (c) => <span className="tabular-nums">{c.staffCount}</span> },
    { key: 'phone', header: t('common.phone'), hideOnMobile: true, cell: (c) => <span className="text-ink-muted">{c.phone ?? t('common.none')}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (c) => <StatusBadge active={c.isActive} labels={{ active: t('common.active'), inactive: t('common.inactive'), locked: '' }} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (c) => (
        <ActionMenu
          label={t('common.actions')}
          items={[
            { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setForm({ open: true, chamber: c }), hidden: !can(PERMISSIONS.CHAMBERS_UPDATE) },
            { label: t('common.delete'), icon: <Trash2 className="h-4 w-4" />, tone: 'danger', onSelect: () => setRemoving(c), hidden: !can(PERMISSIONS.CHAMBERS_DELETE) },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('chambers.title')}
        subtitle={t('chambers.subtitle')}
        actions={
          <Can permission={PERMISSIONS.CHAMBERS_CREATE}>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true, chamber: null })}>
              {t('chambers.new')}
            </Button>
          </Can>
        }
      />
      {isSuperAdmin && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
            <Input type="search" aria-label={t('common.search')} placeholder={t('common.search_placeholder')} className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
          </div>
          <Select
            aria-label={t('chambers.organization')}
            value={organizationId}
            onChange={(e) => {
              setPage(1);
              setParams(e.target.value ? { organizationId: e.target.value } : {});
            }}
          >
            <option value="">{t('common.all')} — {t('nav.organizations')}</option>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <DataTable
        caption={t('chambers.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={<EmptyState title={t('chambers.empty')} />}
      />
      <ChamberForm open={form.open} chamber={form.chamber} defaultOrgId={organizationId || undefined} onClose={() => setForm({ open: false, chamber: null })} />
      <ConfirmDialog
        open={!!removing}
        title={removing ? t('chambers.remove_title', { name: removing.name }) : ''}
        body={t('chambers.remove_body')}
        confirmLabel={t('common.delete')}
        requireReason
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => removing && remove.mutate({ id: removing.id, reason })}
      />
    </div>
  );
}

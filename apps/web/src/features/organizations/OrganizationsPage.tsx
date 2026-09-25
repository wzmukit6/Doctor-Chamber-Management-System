import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { createOrganizationSchema, PERMISSIONS, type OrganizationDto } from '@chamber/shared';
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
  StatusBadge,
  Textarea,
  useToast,
  type Column,
} from '@/components/ui';
import { organizationsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { Can } from '@/permissions/Can';

const formSchema = createOrganizationSchema.extend({ isActive: z.boolean().optional() });
type FormValues = z.input<typeof formSchema>;

function OrganizationForm({ org, open, onClose }: { org: OrganizationDto | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (open) reset(org ? { name: org.name, slug: org.slug, email: org.email, phone: org.phone, address: org.address, isActive: org.isActive } : { isActive: true });
  }, [open, org, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const v = formSchema.parse(values);
    try {
      if (org) await organizationsApi.update(org.id, { ...v, version: org.version });
      else await organizationsApi.create(v);
      toast.success(org ? t('organizations.updated') : t('organizations.created'));
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
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
      title={org ? t('organizations.edit') : t('organizations.new')}
      busy={isSubmitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="org-form" loading={isSubmitting}>
            {org ? t('common.save_changes') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="org-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} error={errors.name?.message} className="sm:col-span-2">
          <Input data-autofocus {...register('name')} />
        </Field>
        <Field label={t('organizations.slug')} error={errors.slug?.message} hint={t('organizations.slug_hint')}>
          <Input {...register('slug')} />
        </Field>
        <Field label={t('common.phone')} error={errors.phone?.message} optional>
          <Input type="tel" {...register('phone', nullIfEmpty)} />
        </Field>
        <Field label={t('common.email')} error={errors.email?.message} optional className="sm:col-span-2">
          <Input type="email" {...register('email', nullIfEmpty)} />
        </Field>
        <Field label={t('common.address')} error={errors.address?.message} optional className="sm:col-span-2">
          <Textarea rows={2} {...register('address')} />
        </Field>
        {org && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-primary-700" {...register('isActive')} />
            {t('common.active')}
          </label>
        )}
      </form>
    </Modal>
  );
}

export function OrganizationsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ open: boolean; org: OrganizationDto | null }>({ open: false, org: null });
  const [removing, setRemoving] = useState<OrganizationDto | null>(null);
  const q = useDebounce(search);
  const params = { page, pageSize: 20, q };
  const list = useQuery({ queryKey: ['organizations', params], queryFn: () => organizationsApi.list(params), placeholderData: keepPreviousData });

  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => organizationsApi.remove(id, reason),
    onSuccess: () => {
      toast.success(t('organizations.removed'));
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const manage = can(PERMISSIONS.ORGANIZATIONS_MANAGE);
  const columns: Column<OrganizationDto>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (o) => (
        <div>
          <p className="font-medium text-ink">
            {o.name} {o.isDemo && <Badge tone="warning">{t('app.demo')}</Badge>}
          </p>
          <p className="font-mono text-xs text-ink-subtle">{o.slug}</p>
        </div>
      ),
    },
    {
      key: 'chambers',
      header: t('organizations.chambers'),
      cell: (o) => (
        <Link to={`/chambers?organizationId=${o.id}`} className="font-medium text-primary-700 hover:underline">
          {o.chamberCount}
        </Link>
      ),
    },
    { key: 'contact', header: t('common.phone'), hideOnMobile: true, cell: (o) => <span className="text-ink-muted">{o.phone ?? o.email ?? t('common.none')}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (o) => <StatusBadge active={o.isActive} labels={{ active: t('common.active'), inactive: t('common.inactive'), locked: '' }} />,
    },
    { key: 'created', header: t('common.created'), hideOnMobile: true, cell: (o) => <span className="text-ink-muted">{formatDate(o.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (o) =>
        manage ? (
          <ActionMenu
            label={t('common.actions')}
            items={[
              { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setForm({ open: true, org: o }) },
              { label: t('common.delete'), icon: <Trash2 className="h-4 w-4" />, tone: 'danger', onSelect: () => setRemoving(o) },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('organizations.title')}
        subtitle={t('organizations.subtitle')}
        actions={
          <Can permission={PERMISSIONS.ORGANIZATIONS_MANAGE}>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true, org: null })}>
              {t('organizations.new')}
            </Button>
          </Can>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
        <Input type="search" aria-label={t('common.search')} placeholder={t('common.search_placeholder')} className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>
      <DataTable
        caption={t('organizations.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(o) => o.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={<EmptyState title={t('organizations.empty')} />}
      />
      <OrganizationForm open={form.open} org={form.org} onClose={() => setForm({ open: false, org: null })} />
      <ConfirmDialog
        open={!!removing}
        title={removing ? t('organizations.remove_title', { name: removing.name }) : ''}
        body={t('organizations.remove_body')}
        confirmLabel={t('common.delete')}
        requireReason
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(reason) => removing && remove.mutate({ id: removing.id, reason })}
      />
    </div>
  );
}

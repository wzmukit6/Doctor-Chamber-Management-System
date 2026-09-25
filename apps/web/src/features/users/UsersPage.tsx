import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Lock, Pencil, Plus, Power, Search, Trash2, Unlock } from 'lucide-react';
import { canManageRole, PERMISSIONS, ROLE_KEYS, type RoleKey, type UserDto } from '@chamber/shared';
import {
  ActionMenu,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  useToast,
  type Column,
} from '@/components/ui';
import { usersApi, chambersApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatRelative } from '@/utils/format';
import { Can } from '@/permissions/Can';
import { CreateUserModal, EditUserModal } from './UserFormModal';
import { usePasswordPolicyText, usePasswordIssues } from '@/features/auth/passwordPolicy';

type Dialog =
  | { kind: 'status'; user: UserDto }
  | { kind: 'remove'; user: UserDto }
  | { kind: 'reset'; user: UserDto }
  | null;

export function UsersPage() {
  const { t } = useTranslation();
  const policyText = usePasswordPolicyText();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user: me, can } = useAuth();
  const actorRole = me!.activeMembership.role;
  const isSuperAdmin = actorRole === 'SUPER_ADMIN';

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [chamberId, setChamberId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newPassword, setNewPassword] = useState('');
  const q = useDebounce(search);

  const params = { page, pageSize: 20, q, role: role || undefined, status, chamberId: chamberId || undefined };
  const list = useQuery({ queryKey: ['users', params], queryFn: () => usersApi.list(params), placeholderData: keepPreviousData });
  const chambers = useQuery({
    queryKey: ['chambers', 'options'],
    queryFn: () => chambersApi.list({ pageSize: 100, sort: 'name', order: 'asc' }),
    enabled: isSuperAdmin,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const action = useMutation({
    mutationFn: async ({ d, reason }: { d: NonNullable<Dialog>; reason: string }) => {
      if (d.kind === 'status') await usersApi.setStatus(d.user.id, { isActive: !d.user.isActive, reason });
      if (d.kind === 'remove') await usersApi.remove(d.user.id, reason);
      if (d.kind === 'reset') await usersApi.resetPassword(d.user.id, { newPassword, reason });
      return d;
    },
    onSuccess: (d) => {
      toast.success(d.kind === 'status' ? t('users.status_changed') : d.kind === 'remove' ? t('users.removed') : t('users.password_reset'));
      setDialog(null);
      setNewPassword('');
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const unlock = useMutation({
    mutationFn: (id: string) => usersApi.unlock(id),
    onSuccess: () => {
      toast.success(t('users.unlocked'));
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const roleOf = (u: UserDto) => (u.memberships[0]?.role ?? 'ASSISTANT') as RoleKey;
  const manageable = (u: UserDto) => u.id !== me!.id && canManageRole(actorRole, roleOf(u));

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      header: t('common.name'),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{u.fullName}</p>
            <p className="truncate text-xs text-ink-subtle">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('users.role'),
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.memberships.map((m) => (
            <Badge key={m.id} tone={m.role === 'DOCTOR' ? 'primary' : m.role === 'SUPER_ADMIN' ? 'info' : 'neutral'}>
              {t(`roles.${m.role}`)}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'chamber',
      header: t('users.chamber'),
      hideOnMobile: true,
      cell: (u) => <span className="text-ink-muted">{u.memberships.map((m) => m.chamber?.name).filter(Boolean).join(', ') || t('common.none')}</span>,
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (u) => (
        <StatusBadge
          active={u.isActive}
          locked={!!u.lockedUntil}
          labels={{ active: t('common.active'), inactive: t('common.inactive'), locked: t('common.locked') }}
        />
      ),
    },
    {
      key: 'lastLogin',
      header: t('users.last_login'),
      hideOnMobile: true,
      cell: (u) => <span className="text-ink-muted">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : t('users.never')}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12 text-right',
      cell: (u) =>
        manageable(u) ? (
          <ActionMenu
            label={t('common.actions')}
            items={[
              { label: t('common.edit'), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(u), hidden: !can(PERMISSIONS.USERS_UPDATE) },
              { label: t('users.unlock'), icon: <Unlock className="h-4 w-4" />, onSelect: () => unlock.mutate(u.id), hidden: !u.lockedUntil || !can(PERMISSIONS.USERS_UPDATE) },
              { label: t('users.reset_password'), icon: <KeyRound className="h-4 w-4" />, onSelect: () => setDialog({ kind: 'reset', user: u }), hidden: !can(PERMISSIONS.USERS_UPDATE) },
              {
                label: u.isActive ? t('users.deactivate') : t('users.activate'),
                icon: u.isActive ? <Power className="h-4 w-4" /> : <Lock className="h-4 w-4" />,
                onSelect: () => setDialog({ kind: 'status', user: u }),
                hidden: !can(PERMISSIONS.USERS_UPDATE),
              },
              { label: t('users.remove'), icon: <Trash2 className="h-4 w-4" />, tone: 'danger', onSelect: () => setDialog({ kind: 'remove', user: u }), hidden: !can(PERMISSIONS.USERS_DELETE) },
            ]}
          />
        ) : null,
    },
  ];

  const filtered = !!(q || role || status !== 'all' || chamberId);
  const resetIssues = usePasswordIssues(newPassword);

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          <Can permission={PERMISSIONS.USERS_CREATE}>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              {t('users.new')}
            </Button>
          </Can>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
          <Input
            type="search"
            aria-label={t('common.search')}
            placeholder={t('common.search_placeholder')}
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select aria-label={t('users.role')} value={role} onChange={(e) => (setRole(e.target.value), setPage(1))}>
          <option value="">{t('users.filter_role')}</option>
          {ROLE_KEYS.filter((r) => isSuperAdmin || r !== 'SUPER_ADMIN').map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('common.status')} value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setPage(1))}>
          <option value="all">{t('users.filter_status')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="inactive">{t('common.inactive')}</option>
        </Select>
        {isSuperAdmin && (
          <Select aria-label={t('users.chamber')} value={chamberId} onChange={(e) => (setChamberId(e.target.value), setPage(1))}>
            <option value="">{t('common.all')} — {t('nav.chambers')}</option>
            {chambers.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <DataTable
        caption={t('users.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        empty={
          <EmptyState
            title={filtered ? t('users.empty_filtered') : t('users.empty')}
            action={
              !filtered && can(PERMISSIONS.USERS_CREATE) ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  {t('users.new')}
                </Button>
              ) : undefined
            }
          />
        }
      />

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <EditUserModal user={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={dialog?.kind === 'status'}
        title={dialog ? t(dialog.user.isActive ? 'users.deactivate_title' : 'users.activate_title', { name: dialog.user.fullName }) : ''}
        body={dialog?.user.isActive ? t('users.deactivate_body') : undefined}
        tone={dialog?.user.isActive ? 'danger' : 'primary'}
        confirmLabel={dialog?.user.isActive ? t('users.deactivate') : t('users.activate')}
        requireReason
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => dialog && action.mutate({ d: dialog, reason })}
      />
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        title={dialog ? t('users.remove_title', { name: dialog.user.fullName }) : ''}
        body={t('users.remove_body')}
        confirmLabel={t('users.remove')}
        requireReason
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => dialog && action.mutate({ d: dialog, reason })}
      />
      <ConfirmDialog
        open={dialog?.kind === 'reset'}
        title={dialog ? t('users.reset_title', { name: dialog.user.fullName }) : ''}
        body={t('users.reset_body')}
        tone="primary"
        confirmLabel={t('users.reset_password')}
        requireReason
        loading={action.isPending}
        onClose={() => (setDialog(null), setNewPassword(''))}
        onConfirm={(reason) => {
          if (resetIssues.length === 0 && dialog) action.mutate({ d: dialog, reason });
        }}
      >
        <Field
          label={t('auth.new_password')}
          hint={policyText}
          error={newPassword && resetIssues.length ? resetIssues[0] : undefined}
        >
          <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

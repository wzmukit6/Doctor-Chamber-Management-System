import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Check, Lock, Minus, Pencil } from 'lucide-react';
import { PERMISSION_GROUPS, PERMISSIONS, type Permission, type RoleDto } from '@chamber/shared';
import { Button, ConfirmDialog, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { rolesApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';

const ROLE_ORDER = ['SUPER_ADMIN', 'MANAGER', 'DOCTOR', 'ASSISTANT'];

/** Permission matrix (spec §3, §50). Editing is super-admin only and every change is audited with a reason. */
export function RolesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.ROLES_MANAGE);
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<Permission>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const sorted = useMemo(
    () => [...(roles.data ?? [])].sort((a, b) => ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key)),
    [roles.data],
  );
  const editing = sorted.find((r) => r.id === editingId) ?? null;
  const changes = editing
    ? [...draft].filter((p) => !editing.permissions.includes(p)).length + editing.permissions.filter((p) => !draft.has(p)).length
    : 0;

  const save = useMutation({
    mutationFn: (reason: string) => rolesApi.updatePermissions(editing!.id, [...draft], reason),
    onSuccess: () => {
      toast.success(t('permissions.saved'));
      setConfirming(false);
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const startEdit = (role: RoleDto) => {
    setEditingId(role.id);
    setDraft(new Set(role.permissions));
  };

  const toggle = (p: Permission) =>
    setDraft((d) => {
      const next = new Set(d);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div>
      <PageHeader title={t('permissions.title')} subtitle={t('permissions.subtitle')} />
      {roles.isError && <ErrorState message={errorMessage(roles.error)} onRetry={() => void roles.refetch()} />}
      {roles.isLoading && <Skeleton className="h-96 w-full" />}
      {roles.data && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <caption className="sr-only">{t('permissions.title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="min-w-[14rem]">
                    {t('common.name')}
                  </th>
                  {sorted.map((r) => (
                    <th key={r.id} scope="col" className={clsx('min-w-[8.5rem] text-center', editingId === r.id && 'bg-primary-50')}>
                      <div className="flex flex-col items-center gap-1 normal-case tracking-normal">
                        <span className="text-xs font-semibold text-ink">{t(`roles.${r.key}`)}</span>
                        <span className="text-2xs font-normal text-ink-subtle">{t('permissions.users_count', { count: r.userCount })}</span>
                        {canManage && r.key !== 'SUPER_ADMIN' && editingId !== r.id && (
                          <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => startEdit(r)} disabled={!!editingId}>
                            {t('common.edit')}
                          </Button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="bg-canvas/70">
                      <th scope="rowgroup" colSpan={sorted.length + 1} className="!bg-transparent !py-2 !text-2xs">
                        {t(`permissions.groups.${group.key}`)}
                      </th>
                    </tr>
                    {group.permissions.map((p) => (
                      <tr key={p}>
                        <th scope="row" className="!border-b !bg-surface !px-4 !py-2 text-left !text-sm !font-normal !normal-case !tracking-normal !text-ink">
                          {t(`permissions.labels.${p}`)}
                          <span className="ml-2 font-mono text-2xs text-ink-subtle">{p}</span>
                        </th>
                        {sorted.map((r) => {
                          const forbidden = r.forbidden.includes(p);
                          const isEditing = editingId === r.id;
                          const granted = isEditing ? draft.has(p) : r.permissions.includes(p);
                          return (
                            <td key={r.id} className={clsx('!py-2 text-center', isEditing && 'bg-primary-50/50')}>
                              {forbidden ? (
                                <Lock className="mx-auto h-3.5 w-3.5 text-ink-subtle/60" aria-label={t('permissions.locked')} />
                              ) : isEditing ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-primary-700"
                                  checked={granted}
                                  onChange={() => toggle(p)}
                                  aria-label={`${t(`roles.${r.key}`)}: ${t(`permissions.labels.${p}`)}`}
                                />
                              ) : granted ? (
                                <Check className="mx-auto h-4 w-4 text-success" aria-label={t('common.yes')} />
                              ) : (
                                <Minus className="mx-auto h-4 w-4 text-ink-subtle/50" aria-label={t('common.no')} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-subtle">
        <Lock className="h-3.5 w-3.5" aria-hidden /> {t('permissions.locked')} · {t('permissions.always')}
      </p>

      {editing && (
        <div className="no-print sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-200 bg-surface px-4 py-3 shadow-overlay">
          <p className="text-sm text-ink">
            <span className="font-medium">{t(`roles.${editing.key}`)}</span> · {t('permissions.changes', { count: changes })}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditingId(null)}>
              {t('permissions.discard')}
            </Button>
            <Button disabled={changes === 0} onClick={() => setConfirming(true)}>
              {t('common.save_changes')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={editing ? t('permissions.save_title', { role: t(`roles.${editing.key}`) }) : ''}
        body={t('permissions.save_body')}
        tone="primary"
        requireReason
        loading={save.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={(reason) => save.mutate(reason)}
      />
    </div>
  );
}

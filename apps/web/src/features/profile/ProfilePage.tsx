import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Monitor } from 'lucide-react';
import { updateProfileSchema } from '@chamber/shared';
import { Badge, Button, Field, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { authApi } from '@/services/endpoints';
import { ME_QUERY_KEY, useAuth } from '@/stores/auth';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { describeDevice, formatRelative } from '@/utils/format';
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';

type ProfileForm = z.input<typeof updateProfileSchema>;

export function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: authApi.sessions });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm>({ resolver: zodResolver(updateProfileSchema) });

  useEffect(() => {
    if (user) reset({ fullName: user.fullName, phone: user.phone, preferredLanguage: user.preferredLanguage });
  }, [user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await authApi.updateProfile(updateProfileSchema.parse(values));
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      toast.success(t('profile.saved'));
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      toast.success(t('profile.revoked'));
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!user) return null;
  return (
    <div>
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="profile-details">
          <h2 id="profile-details" className="mb-4 text-sm font-semibold text-ink">
            {t('profile.details')}
          </h2>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field label={t('users.full_name')} error={errors.fullName?.message}>
              <Input {...register('fullName')} />
            </Field>
            <Field label={t('common.email')}>
              <Input value={user.email} disabled readOnly />
            </Field>
            <Field label={t('common.phone')} error={errors.phone?.message} optional>
              <Input type="tel" {...register('phone', { setValueAs: (v) => (v === '' ? null : v) })} />
            </Field>
            <Field label={t('users.preferred_language')}>
              <Select {...register('preferredLanguage')}>
                <option value="en">{t('common.english')}</option>
                <option value="bn">{t('common.bangla')}</option>
              </Select>
            </Field>
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              {t('common.save_changes')}
            </Button>
          </form>
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{t('profile.memberships')}</h3>
            <ul className="space-y-1.5">
              {user.memberships.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <Badge tone={m.id === user.activeMembership.id ? 'primary' : 'neutral'}>{t(`roles.${m.role}`)}</Badge>
                  <span className="text-ink-muted">{m.chamber ? `${m.chamber.name} · ${m.organization?.name ?? ''}` : t('roles.SUPER_ADMIN')}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="space-y-6">
          <section className="card p-5" aria-labelledby="profile-password">
            <h2 id="profile-password" className="mb-4 text-sm font-semibold text-ink">
              {t('profile.security')}
            </h2>
            <ChangePasswordForm onDone={() => void sessions.refetch()} />
          </section>

          <section className="card p-5" aria-labelledby="profile-sessions">
            <h2 id="profile-sessions" className="text-sm font-semibold text-ink">
              {t('profile.sessions')}
            </h2>
            <p className="mb-3 text-xs text-ink-muted">{t('profile.sessions_hint')}</p>
            {sessions.isLoading && <Skeleton className="h-16 w-full" />}
            <ul className="divide-y divide-border">
              {sessions.data?.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <Monitor className="h-4 w-4 text-ink-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {describeDevice(s.userAgent)} {s.current && <Badge tone="success">{t('profile.this_device')}</Badge>}
                    </p>
                    <p className="text-2xs text-ink-subtle">
                      {s.ipAddress ?? ''} · {t('profile.last_active', { time: formatRelative(s.lastSeenAt) })}
                    </p>
                  </div>
                  {!s.current && (
                    <Button size="sm" variant="secondary" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                      {t('profile.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema, type LoginInput } from '@chamber/shared';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { authApi } from '@/services/endpoints';
import { ME_QUERY_KEY, useAuth } from '@/stores/auth';
import { errorMessage } from '@/utils/errors';

/** Demo accounts are listed only in development / demo builds (VITE_SHOW_DEMO_ACCOUNTS=true). */
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
const DEMO_ACCOUNTS = [
  { role: 'SUPER_ADMIN', email: 'superadmin@demo.chamber.local' },
  { role: 'MANAGER', email: 'manager@demo.chamber.local' },
  { role: 'DOCTOR', email: 'doctor@demo.chamber.local' },
  { role: 'ASSISTANT', email: 'assistant@demo.chamber.local' },
];
const DEMO_PASSWORD = 'Demo@12345';

export function LoginPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const expired = new URLSearchParams(location.search).get('expired') === '1';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authApi.login(values.email, values.password);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title={t('auth.sign_in_title')}
      aside={
        SHOW_DEMO ? (
          <div className="card p-5">
            <p className="text-sm font-semibold text-ink">{t('auth.demo_accounts')}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {t('auth.demo_password')} <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-ink">{DEMO_PASSWORD}</code>
            </p>
            <ul className="mt-4 divide-y divide-border">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t(`roles.${a.role}`)}</p>
                    <p className="truncate text-xs text-ink-subtle">{a.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setValue('email', a.email, { shouldValidate: true });
                      setValue('password', DEMO_PASSWORD, { shouldValidate: true });
                    }}
                  >
                    {t('auth.use')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : undefined
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {(formError || expired) && (
          <div role="alert" className="rounded border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError ?? t('auth.session_expired')}
          </div>
        )}
        <Field label={t('auth.email')} error={errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...register('email')} />
        </Field>
        <Field label={t('auth.password')} error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-medium text-primary-700 hover:underline">
            {t('auth.forgot_password')}
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {isSubmitting ? t('auth.signing_in') : t('auth.sign_in')}
        </Button>
      </form>
    </AuthLayout>
  );
}

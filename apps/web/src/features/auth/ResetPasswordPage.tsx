import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { authApi } from '@/services/endpoints';
import { applyServerErrors, errorMessage } from '@/utils/errors';
import { newPasswordFormSchema, type NewPasswordForm } from './NewPasswordFields';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordFormSchema) });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await authApi.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      if (!applyServerErrors(err, setFieldError)) setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title={t('auth.reset_title')} subtitle={!done && token ? t('auth.password_policy') : undefined}>
      {!token ? (
        <p role="alert" className="text-sm text-danger">
          {t('auth.reset_invalid')}
        </p>
      ) : done ? (
        <div className="space-y-4">
          <p role="status" className="rounded border border-success/20 bg-success-soft px-3 py-2 text-sm text-success">
            {t('auth.reset_done')}
          </p>
          <Link to="/login" className="text-sm font-medium text-primary-700 hover:underline">
            {t('auth.sign_in')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && (
            <p role="alert" className="rounded border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Field label={t('auth.new_password')} error={errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" autoFocus {...register('newPassword')} />
          </Field>
          <Field label={t('auth.confirm_password')} error={errors.confirmPassword?.message}>
            <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            {t('auth.reset_submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

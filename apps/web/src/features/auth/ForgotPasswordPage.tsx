import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@chamber/shared';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { authApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title={t('auth.forgot_title')} subtitle={sent ? undefined : t('auth.forgot_intro')}>
      {sent ? (
        <div className="space-y-4">
          <p role="status" className="rounded border border-success/20 bg-success-soft px-3 py-2 text-sm text-success">
            {t('auth.link_sent')}
          </p>
          <Link to="/login" className="text-sm font-medium text-primary-700 hover:underline">
            {t('auth.back_to_sign_in')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && (
            <p role="alert" className="rounded border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Field label={t('auth.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            {t('auth.send_link')}
          </Button>
          <p className="text-center">
            <Link to="/login" className="text-xs font-medium text-primary-700 hover:underline">
              {t('auth.back_to_sign_in')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

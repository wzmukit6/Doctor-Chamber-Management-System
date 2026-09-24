import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { passwordSchema } from '@chamber/shared';
import { Button, Field, Input, useToast } from '@/components/ui';
import { authApi } from '@/services/endpoints';
import { applyServerErrors, errorMessage } from '@/utils/errors';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'auth.passwords_mismatch' })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'validation.password.same_as_current' });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      reset();
      toast.success(t('profile.password_changed'));
      onDone?.();
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label={t('auth.current_password')} error={errors.currentPassword?.message}>
        <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
      </Field>
      <Field label={t('auth.new_password')} error={errors.newPassword?.message} hint={t('auth.password_policy')}>
        <Input type="password" autoComplete="new-password" {...register('newPassword')} />
      </Field>
      <Field label={t('auth.confirm_password')} error={errors.confirmPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
      </Field>
      <Button type="submit" loading={isSubmitting}>
        {t('profile.change_password')}
      </Button>
    </form>
  );
}

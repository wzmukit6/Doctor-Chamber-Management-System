import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/ui';
import { ChangePasswordForm } from './ChangePasswordForm';

/** Shown after an admin-created account or admin password reset, before the app is usable. */
export function ForceChangePasswordPage() {
  const { t } = useTranslation();
  const { refresh, signOut } = useAuth();
  return (
    <AuthLayout title={t('profile.change_password')} subtitle={t('auth.must_change_password')}>
      <ChangePasswordForm onDone={() => void refresh()} />
      <Button variant="link" className="mt-4 text-xs" onClick={() => void signOut()}>
        {t('nav.sign_out')}
      </Button>
    </AuthLayout>
  );
}

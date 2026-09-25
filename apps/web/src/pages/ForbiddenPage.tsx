import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldX } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="card">
      <EmptyState
        icon={<ShieldX className="h-6 w-6" />}
        title={t('errors.forbidden_title')}
        description={t('errors.forbidden_body')}
        action={
          <Link to="/" className="text-sm font-medium text-primary-700 hover:underline">
            {t('errors.go_home')}
          </Link>
        }
      />
    </div>
  );
}

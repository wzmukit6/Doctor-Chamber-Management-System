import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPinOff } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="card">
      <EmptyState
        icon={<MapPinOff className="h-6 w-6" />}
        title={t('errors.not_found_title')}
        description={t('errors.not_found_body')}
        action={
          <Link to="/" className="text-sm font-medium text-primary-700 hover:underline">
            {t('errors.go_home')}
          </Link>
        }
      />
    </div>
  );
}

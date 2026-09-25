import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

const TONE = { UNPAID: 'danger', PARTIALLY_PAID: 'warning', PAID: 'success', VOID: 'neutral' } as const;

export function InvoiceStatusBadge({ status }: { status: keyof typeof TONE }) {
  const { t } = useTranslation();
  return (
    <Badge tone={TONE[status]} dot>
      {t(`invoiceStatus.${status}`)}
    </Badge>
  );
}

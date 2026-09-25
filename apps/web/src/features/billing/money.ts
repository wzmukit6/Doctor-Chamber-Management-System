import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_BILLING_SETTINGS, PERMISSIONS } from '@chamber/shared';
import { settingsApi } from '@/services/endpoints';
import { useAuth } from '@/stores/auth';

export function formatAmount(value: number, symbol: string, lang: string): string {
  const abs = Math.abs(value);
  const n = new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-IN', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 }).format(abs);
  return `${value < 0 ? '− ' : ''}${symbol}${n}`;
}

export function useBillingSettings() {
  const { can } = useAuth();
  return useQuery({ queryKey: ['settings', 'billing'], queryFn: settingsApi.billing, staleTime: 5 * 60_000, enabled: can(PERMISSIONS.BILLING_VIEW) });
}

/** Formats money with the chamber's currency symbol (default ৳). */
export function useMoney() {
  const { i18n } = useTranslation();
  const s = useBillingSettings();
  const symbol = s.data?.currencySymbol ?? DEFAULT_BILLING_SETTINGS.currencySymbol;
  return (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatAmount(v, symbol, i18n.language));
}

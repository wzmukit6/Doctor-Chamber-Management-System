import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PASSWORD_POLICY, passwordIssues, type PasswordPolicyRules } from '@chamber/shared';
import { passwordPolicyApi } from '@/services/endpoints';

/** The platform password policy (Settings → Security), fetched from the public endpoint. */
export function usePasswordPolicy(): PasswordPolicyRules {
  const q = useQuery({ queryKey: ['password-policy'], queryFn: passwordPolicyApi.get, staleTime: 5 * 60_000 });
  return q.data ?? DEFAULT_PASSWORD_POLICY;
}

/** "At least 12 characters, with an upper-case letter, a number…" */
export function usePasswordPolicyText(): string {
  const { t } = useTranslation();
  const p = usePasswordPolicy();
  const parts = [
    p.passwordRequireUpper && t('auth.policy_upper'),
    p.passwordRequireLower && t('auth.policy_lower'),
    p.passwordRequireDigit && t('auth.policy_digit'),
    p.passwordRequireSymbol && t('auth.policy_symbol'),
  ].filter(Boolean);
  return t('auth.policy_text', { count: p.passwordMinLength, parts: parts.join(', ') || t('auth.policy_none') });
}

export function usePasswordIssues(password: string): string[] {
  return passwordIssues(password, usePasswordPolicy());
}

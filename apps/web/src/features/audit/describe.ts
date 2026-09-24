import i18n from '@/i18n';

/** Human-readable label for an audit action key such as `user.password_reset`. */
export function describeAction(action: string): string {
  const key = `auditActions.${action.replace('.', '_')}`;
  if (i18n.exists(key)) return i18n.t(key);
  const [resource, verb] = action.split('.');
  const words = `${verb ?? ''}`.replace(/_/g, ' ');
  return `${resource ?? ''} ${words}`.trim().replace(/^\w/, (c) => c.toUpperCase());
}

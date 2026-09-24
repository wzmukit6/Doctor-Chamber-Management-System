export type NotificationChannelKind = 'in_app' | 'email' | 'sms' | 'whatsapp';

export type NotificationType =
  | 'PASSWORD_RESET'
  | 'ACCOUNT_CREATED'
  | 'APPOINTMENT_REMINDER'
  | 'APPOINTMENT_CONFIRMATION'
  | 'FOLLOW_UP_REMINDER'
  | 'PAYMENT_NOTIFICATION'
  | 'SYSTEM';

export interface OutgoingNotification {
  type: NotificationType;
  channel: NotificationChannelKind;
  to: string;
  subject: string;
  body: string;
  /** Structured data for templating; never include clinical details here. */
  data?: Record<string, string>;
}

/**
 * Provider abstraction (spec §27). Concrete providers (SMTP, SMS gateway,
 * WhatsApp) implement this interface and are selected via configuration.
 */
export interface NotificationProvider {
  readonly channel: NotificationChannelKind;
  send(message: OutgoingNotification): Promise<void>;
}

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');

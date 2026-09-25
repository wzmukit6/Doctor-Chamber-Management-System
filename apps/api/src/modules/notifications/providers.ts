import { Logger } from '@nestjs/common';
import { NotificationProvider, OutgoingNotification } from './notification.types';

/**
 * Development email provider: writes to the server log instead of sending.
 * Replace with an SMTP/API provider in staging/production.
 */
export class ConsoleEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const;
  private readonly logger = new Logger('ConsoleEmail');

  async send(message: OutgoingNotification): Promise<void> {
    this.logger.log(`[${message.type}] to=${message.to} subject="${message.subject}"\n${message.body}`);
  }
}

/** Test provider: keeps messages in memory so integration tests can read them. */
export class InMemoryEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const;
  static readonly outbox: OutgoingNotification[] = [];

  async send(message: OutgoingNotification): Promise<void> {
    InMemoryEmailProvider.outbox.push(message);
  }
}

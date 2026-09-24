import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_PROVIDERS, NotificationProvider, OutgoingNotification } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(NOTIFICATION_PROVIDERS) private readonly providers: NotificationProvider[]) {}

  /** Delivery failures are logged but never break the calling business workflow. */
  async send(message: OutgoingNotification): Promise<boolean> {
    const provider = this.providers.find((p) => p.channel === message.channel);
    if (!provider) {
      this.logger.warn(`No provider configured for channel "${message.channel}"`);
      return false;
    }
    try {
      await provider.send(message);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send ${message.type} via ${message.channel}: ${(err as Error).message}`);
      return false;
    }
  }
}

import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NOTIFICATION_PROVIDERS } from './notification.types';
import { ConsoleEmailProvider, InMemoryEmailProvider } from './providers';
import { loadConfig } from '../../config/config';

@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATION_PROVIDERS,
      useFactory: () => [loadConfig().NODE_ENV === 'test' ? new InMemoryEmailProvider() : new ConsoleEmailProvider()],
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ListingNotificationsListener } from './listing-notifications.listener';
import { PUSH_PROVIDER } from './push-provider.interface';
import { ConsolePushProvider } from './providers/console-push.provider';
import { FcmPushProvider } from './providers/fcm-push.provider';

/**
 * Owns push delivery and device-token storage. Chat and listings reach it only
 * through NotificationsService, so the choice of push transport stays behind
 * this module.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ListingNotificationsListener,
    ConsolePushProvider,
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService, ConsolePushProvider],
      useFactory: (config: ConfigService, consoleProvider: ConsolePushProvider) =>
        config.getOrThrow<string>('PUSH_PROVIDER') === 'fcm'
          ? new FcmPushProvider(config)
          : consoleProvider,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

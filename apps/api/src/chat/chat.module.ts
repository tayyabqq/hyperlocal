import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  MESSAGE_SCREEN_PORT,
  AllowAllMessageScreen,
} from '../common/ports/message-screen.port';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatDeliveryService } from './chat-delivery.service';
import { ChatGateway } from './chat.gateway';

/**
 * The message screen defaults to allow-all here; the moderation module (M5)
 * overrides MESSAGE_SCREEN_PORT with a real keyword blacklist. Chat never
 * imports moderation — it depends only on the port.
 */
@Module({
  imports: [
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        publicKey: config.getOrThrow<string>('JWT_PUBLIC_KEY'),
        signOptions: { algorithm: 'RS256' },
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatDeliveryService,
    ChatGateway,
    { provide: MESSAGE_SCREEN_PORT, useClass: AllowAllMessageScreen },
  ],
  exports: [ChatService, ChatDeliveryService],
})
export class ChatModule {}

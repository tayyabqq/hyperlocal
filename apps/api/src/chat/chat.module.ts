import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatDeliveryService } from './chat-delivery.service';
import { ChatGateway } from './chat.gateway';

/**
 * ChatService injects MESSAGE_SCREEN_PORT but this module does not provide it —
 * the moderation module supplies it globally. Chat depends only on the port
 * contract and never imports moderation.
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
  providers: [ChatService, ChatDeliveryService, ChatGateway],
  exports: [ChatService, ChatDeliveryService],
})
export class ChatModule {}

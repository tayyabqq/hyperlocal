import { Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ChatSocketEvent, MESSAGE_MAX_LENGTH } from '@hl/shared';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ChatService } from './chat.service';
import { ChatDeliveryService } from './chat-delivery.service';

interface AuthedSocket extends Socket {
  data: { userId?: string; displayName?: string };
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Realtime 1-to-1 chat. Every socket authenticates in the handshake with the
 * same RS256 access token the REST API uses, then joins a room keyed by its
 * user id. Messages fan out to the two participants' user rooms — never a
 * conversation room — so a user is reachable on any device without explicit
 * presence bookkeeping. Cross-instance fan-out is handled by the Redis adapter
 * wired in main.ts, so this code is identical on one node or many.
 */
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() private server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chat: ChatService,
    private readonly delivery: ChatDeliveryService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Give the delivery service a way to reach connected clients without it
    // depending on socket.io directly.
    this.delivery.bindTransport(
      (userId, event, payload) => this.server.to(userRoom(userId)).emit(event, payload),
      async (userId) => (await this.server.in(userRoom(userId)).fetchSockets()).length > 0,
    );
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        publicKey: this.config.getOrThrow<string>('JWT_PUBLIC_KEY'),
        algorithms: ['RS256'],
      });
      client.data.userId = payload.sub;
      client.data.displayName = await this.chat.displayNameOf(payload.sub);
      await client.join(userRoom(payload.sub));
    } catch {
      // Never leave an unauthenticated socket connected.
      client.emit(ChatSocketEvent.ERROR, { message: 'Authentication failed.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.userId) {
      this.logger.debug(`Socket for user ${client.data.userId} disconnected.`);
    }
  }

  @SubscribeMessage(ChatSocketEvent.MESSAGE_SEND)
  async onMessageSend(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { conversationId?: string; body?: string },
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }

    const conversationId = payload?.conversationId;
    const body = (payload?.body ?? '').toString();
    if (!conversationId || body.length === 0 || body.length > MESSAGE_MAX_LENGTH) {
      client.emit(ChatSocketEvent.ERROR, { message: 'Invalid message.' });
      return;
    }

    try {
      const conversation = await this.chat.requireParticipant(conversationId, userId);
      const message = await this.chat.sendMessage(conversationId, userId, body);
      await this.delivery.deliver(message, conversation, client.data.displayName ?? 'New message');
    } catch (error) {
      client.emit(ChatSocketEvent.ERROR, {
        message: error instanceof Error ? error.message : 'Could not send message.',
      });
    }
  }

  @SubscribeMessage(ChatSocketEvent.MESSAGE_READ)
  async onMessageRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { conversationId?: string },
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !payload?.conversationId) return;

    try {
      const conversation = await this.chat.requireParticipant(payload.conversationId, userId);
      const changed = await this.chat.markRead(payload.conversationId, userId);
      if (changed > 0) this.delivery.notifyRead(conversation, userId);
    } catch {
      // A read receipt failing is not worth surfacing to the user.
    }
  }

  private extractToken(client: Socket): string {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    throw new Error('No token');
  }
}

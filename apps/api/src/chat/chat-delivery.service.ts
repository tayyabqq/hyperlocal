import { Injectable } from '@nestjs/common';
import { ChatSocketEvent, type ChatMessage } from '@hl/shared';
import { NotificationsService } from '../notifications/notifications.service';
import type { ConversationParticipants } from './chat.service';

/**
 * Delivery side of chat, kept out of ChatService so message persistence has no
 * dependency on sockets or push. Both the WebSocket gateway and the REST
 * fallback route new messages through here, so realtime fan-out and offline
 * push happen exactly once regardless of how the message was sent.
 *
 * The socket server is injected lazily by the gateway (which owns the io
 * instance) to avoid a construction-time cycle.
 */
@Injectable()
export class ChatDeliveryService {
  private emitToUser: ((userId: string, event: string, payload: unknown) => void) | null = null;
  private isUserConnected: (userId: string) => Promise<boolean> = () => Promise.resolve(false);

  constructor(private readonly notifications: NotificationsService) {}

  /** Wired once by the gateway at bootstrap. */
  bindTransport(
    emitToUser: (userId: string, event: string, payload: unknown) => void,
    isUserConnected: (userId: string) => Promise<boolean>,
  ): void {
    this.emitToUser = emitToUser;
    this.isUserConnected = isUserConnected;
  }

  /**
   * Delivers a stored message: pushes it live to both participants, then sends
   * a push to the recipient if they are not currently connected. The sender is
   * never pushed.
   */
  async deliver(
    message: ChatMessage,
    conversation: ConversationParticipants,
    senderName: string,
  ): Promise<void> {
    const recipientId =
      conversation.authorId === message.senderId
        ? conversation.inquirerId
        : conversation.authorId;

    this.emitToUser?.(message.senderId, ChatSocketEvent.MESSAGE_NEW, message);
    this.emitToUser?.(recipientId, ChatSocketEvent.MESSAGE_NEW, message);

    // Only wake a device when the recipient isn't already looking — an online
    // user gets the realtime event and does not need a notification too.
    const connected = await this.isUserConnected(recipientId).catch(() => false);
    if (connected) return;

    const preview = message.body.length > 120 ? `${message.body.slice(0, 117)}…` : message.body;
    await this.notifications.notifyUser(recipientId, {
      title: senderName,
      body: preview,
      data: { type: 'chat', conversationId: message.conversationId },
    });
  }

  /** Notifies both participants that one side read the thread. */
  notifyRead(conversation: ConversationParticipants, readerId: string): void {
    const otherId =
      conversation.authorId === readerId ? conversation.inquirerId : conversation.authorId;
    this.emitToUser?.(otherId, ChatSocketEvent.MESSAGE_READ, {
      conversationId: conversation.id,
      readerId,
    });
  }
}

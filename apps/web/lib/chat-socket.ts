'use client';

import { io, type Socket } from 'socket.io-client';
import { ChatSocketEvent, type ChatMessage } from '@hl/shared';

export interface ChatSocketHandlers {
  onMessage: (message: ChatMessage) => void;
  onRead: (payload: { conversationId: string; readerId: string }) => void;
  onError?: (message: string) => void;
}

/**
 * Thin wrapper over the /chat socket namespace. The access token authenticates
 * the handshake; the caller is responsible for reconnecting with a fresh token
 * after a rotation. Realtime is an enhancement — every send also has a REST
 * fallback — so a failed socket degrades gracefully rather than breaking chat.
 */
export function connectChatSocket(
  accessToken: string,
  handlers: ChatSocketHandlers,
): Socket {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const socket = io(`${base}/chat`, {
    transports: ['websocket'],
    auth: { token: accessToken },
  });

  socket.on(ChatSocketEvent.MESSAGE_NEW, handlers.onMessage);
  socket.on(ChatSocketEvent.MESSAGE_READ, handlers.onRead);
  socket.on(ChatSocketEvent.ERROR, (payload: { message?: string }) =>
    handlers.onError?.(payload?.message ?? 'Chat error'),
  );

  return socket;
}

export function sendMessageSocket(socket: Socket, conversationId: string, body: string): void {
  socket.emit(ChatSocketEvent.MESSAGE_SEND, { conversationId, body });
}

export function sendReadSocket(socket: Socket, conversationId: string): void {
  socket.emit(ChatSocketEvent.MESSAGE_READ, { conversationId });
}

import { io, type Socket } from 'socket.io-client';
import { ChatSocketEvent, type ChatMessage } from '@hl/shared';
import { apiBaseUrl } from './config';

export interface ChatSocketHandlers {
  onMessage: (message: ChatMessage) => void;
  onRead: (payload: { conversationId: string; readerId: string }) => void;
  onError?: (message: string) => void;
}

/**
 * Connects to the /chat namespace with the access token in the handshake.
 * Realtime is an enhancement over the REST send path, so a socket that fails to
 * connect degrades to REST rather than breaking chat.
 */
export function connectChatSocket(accessToken: string, handlers: ChatSocketHandlers): Socket {
  const socket = io(`${apiBaseUrl()}/chat`, {
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

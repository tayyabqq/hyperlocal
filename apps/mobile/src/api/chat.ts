import type {
  ChatMessage,
  ConversationMessagesResult,
  ConversationSummary,
} from '@hl/shared';
import { authedFetch } from './client';

export function startConversation(
  accessToken: string,
  listingId: string,
): Promise<ConversationSummary> {
  return authedFetch<ConversationSummary>('/v1/chat/conversations', accessToken, {
    method: 'POST',
    body: JSON.stringify({ listingId }),
  });
}

export function fetchConversations(accessToken: string): Promise<ConversationSummary[]> {
  return authedFetch<ConversationSummary[]>('/v1/chat/conversations', accessToken);
}

export function fetchMessages(
  accessToken: string,
  conversationId: string,
  before?: string,
): Promise<ConversationMessagesResult> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return authedFetch<ConversationMessagesResult>(
    `/v1/chat/conversations/${conversationId}/messages${query}`,
    accessToken,
  );
}

/** REST fallback used when the socket is not connected. */
export function sendMessageRest(
  accessToken: string,
  conversationId: string,
  body: string,
): Promise<ChatMessage> {
  return authedFetch<ChatMessage>(
    `/v1/chat/conversations/${conversationId}/messages`,
    accessToken,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
}

export function markConversationRead(
  accessToken: string,
  conversationId: string,
): Promise<void> {
  return authedFetch<void>(`/v1/chat/conversations/${conversationId}/read`, accessToken, {
    method: 'POST',
  });
}

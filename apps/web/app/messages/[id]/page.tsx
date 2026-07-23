'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import type { ChatMessage } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { fetchMessages, markConversationRead, sendMessageRest } from '@/lib/chat-client';
import { connectChatSocket, sendMessageSocket, sendReadSocket } from '@/lib/chat-socket';
import { ApiError } from '@/lib/api-client';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';

export default function ConversationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const conversationId = params.id;
  const { status, accessToken, user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const appendUnique = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  // Load history, then open the socket for realtime and mark the thread read.
  useEffect(() => {
    if (!accessToken || !conversationId) return;
    let active = true;

    void fetchMessages(accessToken, conversationId)
      .then((res) => {
        if (active) setMessages(res.messages);
      })
      .catch(() => setError('Could not load this conversation.'));

    void markConversationRead(accessToken, conversationId).catch(() => undefined);

    const socket = connectChatSocket(accessToken, {
      onMessage: (m) => {
        if (m.conversationId !== conversationId) return;
        appendUnique(m);
        // The thread is open, so a message from the other side is read on arrival.
        if (m.senderId !== user?.id) sendReadSocket(socket, conversationId);
      },
      onRead: () => undefined,
      onError: (msg) => setError(msg),
    });
    socketRef.current = socket;

    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, conversationId, appendUnique, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const onSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const body = draft.trim();
      if (!body || !accessToken) return;
      setError(null);
      setDraft('');

      const socket = socketRef.current;
      if (socket?.connected) {
        // The server echoes the persisted message back over message:new, so the
        // socket path adds nothing optimistic here — it just sends.
        sendMessageSocket(socket, conversationId, body);
        return;
      }

      // No live socket — fall back to REST so a flaky connection never loses a message.
      setSending(true);
      try {
        appendUnique(await sendMessageRest(accessToken, conversationId, body));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not send your message.');
        setDraft(body);
      } finally {
        setSending(false);
      }
    },
    [draft, accessToken, conversationId, appendUnique],
  );

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated') return null;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <button onClick={() => router.push('/messages')} className="text-sm text-slate/60">
          ← Back
        </button>
        <span className="font-display text-base font-semibold text-ink">Conversation</span>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-2xl space-y-2">
          <ErrorNotice message={error} />
          {messages.map((m) => {
            const mine = m.senderId === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    mine ? 'bg-ink text-canvas' : 'border border-line bg-white text-ink'
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={onSend} className="border-t border-line px-5 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Write a message…"
            className="flex-1 rounded-card border border-line px-4 py-3 text-sm outline-none focus:border-slate/40"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="rounded-card bg-ink px-5 py-3 text-sm font-semibold text-canvas disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </main>
  );
}

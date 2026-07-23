'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationSummary } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { fetchConversations } from '@/lib/chat-client';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';
import { ProximityMark } from '@/components/ProximityMark';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function MessagesPage() {
  const router = useRouter();
  const { status, accessToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setConversations(await fetchConversations(accessToken));
    } catch {
      setError('Could not load your messages. Reload to try again.');
    }
  }, [accessToken]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated') void load();
  }, [status, router, load]);

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated') return null;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center gap-3">
          <ProximityMark className="h-9 w-9" />
          <span className="font-display text-lg font-semibold text-ink">Messages</span>
        </header>

        <ErrorNotice message={error} />

        {conversations === null && <p className="text-sm text-slate/60">Loading…</p>}

        {conversations?.length === 0 && (
          <p className="rounded-card border border-line bg-white p-6 text-sm text-slate/70">
            No conversations yet. Tap “Message” on a listing to start one.
          </p>
        )}

        <ul className="space-y-2">
          {conversations?.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => router.push(`/messages/${c.id}`)}
                className="flex w-full items-center justify-between gap-4 rounded-card border border-line bg-white p-4 text-left hover:border-slate/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-ink">{c.counterpartName}</span>
                    <span className="shrink-0 text-xs text-slate/50">· {c.listingCategory}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate/70">
                    {c.lastMessagePreview ?? 'No messages yet'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-slate/50">{timeAgo(c.lastMessageAt)}</span>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-canvas">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

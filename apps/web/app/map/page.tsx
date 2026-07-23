'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ListingSummary } from '@hl/shared';
import { ReportTargetType } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { fetchNearbyListings } from '@/lib/listings-client';
import { startConversation } from '@/lib/chat-client';
import { reportTarget } from '@/lib/reports-client';
import { ApiError } from '@/lib/api-client';
import { MapView } from '@/components/MapView';
import { ErrorNotice } from '@/components/ErrorNotice';

const DEIRA_DUBAI = { latitude: 25.2697, longitude: 55.3095 };

export default function MapPage() {
  const router = useRouter();
  const { status, accessToken, user } = useAuth();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [center, setCenter] = useState(DEIRA_DUBAI);
  const [selected, setSelected] = useState<ListingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState(false);

  const loadListings = useCallback(async (lat: number, lng: number) => {
    setLoading(true);
    try {
      const result = await fetchNearbyListings(lat, lng);
      setListings(result.listings);
      setError(null);
    } catch {
      setError('Could not load nearby listings. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadListings(center.latitude, center.longitude);
    // Deliberately only on mount + explicit center changes below — not on
    // every render, since flying the map shouldn't itself refire the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCenter(next);
        void loadListings(next.latitude, next.longitude);
      },
      () => undefined, // silently keep the UAE default if permission is denied
      { timeout: 5000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMarkerClick = useCallback((listing: ListingSummary) => {
    setNotice(null);
    setSelected(listing);
  }, []);

  const openChat = useCallback(async () => {
    if (!selected) return;
    if (status !== 'authenticated' || !accessToken) {
      router.push('/login');
      return;
    }
    setError(null);
    setMessaging(true);
    try {
      const conversation = await startConversation(accessToken, selected.id);
      router.push(`/messages/${conversation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open a conversation.');
      setMessaging(false);
    }
  }, [selected, status, accessToken, router]);

  const reportListing = useCallback(async () => {
    if (!selected) return;
    if (status !== 'authenticated' || !accessToken) {
      router.push('/login');
      return;
    }
    const reason = window.prompt('What is wrong with this listing?');
    if (!reason || reason.trim().length < 3) return;
    setError(null);
    try {
      await reportTarget(accessToken, ReportTargetType.LISTING, selected.id, reason.trim());
      setNotice('Thanks — our team will review this listing.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your report.');
    }
  }, [selected, status, accessToken, router]);

  // Hide the message button on the caller's own listing — you can't chat with yourself.
  const isOwnListing = selected !== null && selected.authorId === user?.id;

  return (
    <main className="relative h-screen w-screen">
      <MapView listings={listings} center={center} onMarkerClick={handleMarkerClick} />

      <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-3">
        <div className="rounded-card bg-white px-4 py-2.5 shadow-sm">
          <span className="font-display text-sm font-semibold text-ink">
            {loading ? 'Loading…' : `${listings.length} nearby`}
          </span>
        </div>
        <button
          onClick={() => router.push(status === 'authenticated' ? '/listings/new' : '/login')}
          className="rounded-card bg-amber px-5 py-2.5 text-sm font-semibold text-ink shadow-sm"
        >
          Post a listing
        </button>
      </div>

      {error && (
        <div className="absolute left-4 top-16 max-w-xs">
          <ErrorNotice message={error} />
        </div>
      )}

      {selected && (
        <div className="absolute bottom-0 left-0 right-0 rounded-t-[20px] bg-white p-6 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="mx-auto max-w-md">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="font-display text-lg font-semibold text-ink">{selected.category}</p>
                <p className="text-sm text-slate/70">{selected.locationLabel}</p>
                <p className="text-xs text-slate/50">Posted by {selected.authorDisplayName}</p>
              </div>
              <p className="font-display text-lg font-semibold text-amber">
                AED {selected.payAmountAed}
              </p>
            </div>
            <p className="mb-4 text-sm text-slate">{selected.description}</p>
            <div className="flex items-center justify-between text-xs text-slate/50">
              <span>Posted {new Date(selected.createdAt).toLocaleDateString()}</span>
              {selected.distanceMeters !== null && (
                <span>{(selected.distanceMeters / 1000).toFixed(1)} km away</span>
              )}
            </div>
            {notice && <p className="mt-4 text-sm text-signal">{notice}</p>}
            {!isOwnListing && (
              <button
                onClick={openChat}
                disabled={messaging}
                className="mt-4 w-full rounded-card bg-ink px-6 py-3 text-sm font-semibold text-canvas disabled:opacity-50"
              >
                {messaging ? 'Opening…' : `Message ${selected.authorDisplayName}`}
              </button>
            )}
            <div className="mt-3 flex items-center justify-between text-sm">
              <button onClick={() => setSelected(null)} className="text-slate/50">
                Close
              </button>
              {!isOwnListing && (
                <button onClick={reportListing} className="text-slate/50 underline">
                  Report
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

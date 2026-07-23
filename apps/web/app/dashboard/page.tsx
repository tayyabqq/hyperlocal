'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ListingSummary, UserProfile } from '@hl/shared';
import { formatAed, LISTING_FEE_FILS, ListingStatus, UserRole } from '@hl/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { fetchMyListings } from '@/lib/listings-client';
import { fetchCredits, retryListingPayment } from '@/lib/payments-client';
import { useAuth } from '@/context/AuthContext';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';
import { ProximityMark } from '@/components/ProximityMark';

const STATUS_LABEL: Record<string, string> = {
  [ListingStatus.PENDING_PAYMENT]: 'Awaiting payment',
  [ListingStatus.ACTIVE]: 'Live',
  [ListingStatus.EXPIRED]: 'Expired',
  [ListingStatus.REMOVED]: 'Removed',
};

function daysLeft(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? '1 day left' : `${days} days left`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { status, accessToken, user, setUser, refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    try {
      setUser(await apiFetch<UserProfile>('/v1/users/me', accessToken));
    } catch {
      // A 15-minute access token can expire while the tab sits open; rotate once.
      const fresh = await refresh();
      if (!fresh) return;
      try {
        setUser(await apiFetch<UserProfile>('/v1/users/me', fresh));
      } catch {
        setError('Could not load your profile. Reload the page to try again.');
      }
    }
  }, [accessToken, setUser, refresh]);

  const loadListings = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [mine, balance] = await Promise.all([
        fetchMyListings(accessToken),
        fetchCredits(accessToken),
      ]);
      setListings(mine);
      setCredits(balance.credits);
    } catch {
      setError('Could not load your listings. Reload the page to try again.');
    }
  }, [accessToken]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && !user) void loadProfile();
    if (status === 'authenticated' && listings === null) void loadListings();
  }, [status, user, listings, router, loadProfile, loadListings]);

  useEffect(() => {
    if (user && !user.isProfileComplete) router.replace('/onboarding');
  }, [user, router]);

  const completePayment = useCallback(
    async (listingId: string) => {
      if (!accessToken) return;
      setError(null);
      setPayingId(listingId);
      try {
        const order = await retryListingPayment(accessToken, listingId);
        if (order.redirectUrl) {
          window.location.href = order.redirectUrl;
          return;
        }
        router.push(`/listings/pending?orderId=${order.id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not restart your payment.');
        setPayingId(null);
      }
    },
    [accessToken, router],
  );

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated') return null;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProximityMark className="h-9 w-9" />
            <span className="font-display text-lg font-semibold text-ink">Work Nearby</span>
          </div>
          <button
            onClick={() => logout().then(() => router.replace('/login'))}
            className="text-sm text-slate/60 underline"
          >
            Log out
          </button>
        </header>

        <ErrorNotice message={error} />

        <section className="rounded-card border border-line bg-white p-8">
          <p className="font-display text-xl font-semibold text-ink">
            {user ? `Welcome, ${user.displayName}` : 'Welcome'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate/70">
            {user?.role === UserRole.PROVIDER
              ? 'Post what you need and workers within 2 km will see it.'
              : 'Post your availability and employers within 2 km will see it.'}
          </p>

          <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate/50">Phone</dt>
              <dd className="mt-1 text-ink">{user?.phoneE164 ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate/50">Account type</dt>
              <dd className="mt-1 text-ink">
                {user?.role === UserRole.PROVIDER ? 'Hiring' : 'Looking for work'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate/50">Free listings</dt>
              <dd className="mt-1 text-ink">{credits ?? '—'}</dd>
            </div>
          </dl>

          <div className="mt-6 flex gap-3">
            <a
              href="/map"
              className="inline-block rounded-card bg-ink px-6 py-3 text-sm font-semibold text-canvas"
            >
              Browse the map
            </a>
            <a
              href="/listings/new"
              className="inline-block rounded-card border border-line px-6 py-3 text-sm font-semibold text-slate"
            >
              Post a listing
            </a>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">Your listings</h2>

          {listings === null && <p className="text-sm text-slate/60">Loading…</p>}

          {listings?.length === 0 && (
            <p className="rounded-card border border-line bg-white p-6 text-sm text-slate/70">
              Nothing posted yet. Your first listing is free.
            </p>
          )}

          <ul className="space-y-3">
            {listings?.map((listing) => {
              const remaining = daysLeft(listing.expiresAt);
              const unpaid = listing.status === ListingStatus.PENDING_PAYMENT;

              return (
                <li key={listing.id} className="rounded-card border border-line bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-ink">{listing.category}</p>
                      <p className="mt-1 text-sm text-slate/70">
                        AED {listing.payAmountAed} · {listing.locationLabel}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        listing.status === ListingStatus.ACTIVE
                          ? 'bg-ink text-canvas'
                          : 'border border-line text-slate/70'
                      }`}
                    >
                      {STATUS_LABEL[listing.status] ?? listing.status}
                    </span>
                  </div>

                  {remaining && <p className="mt-3 text-xs text-slate/60">{remaining}</p>}

                  {unpaid && (
                    <button
                      onClick={() => void completePayment(listing.id)}
                      disabled={payingId === listing.id}
                      className="mt-4 rounded-card bg-ink px-5 py-2.5 text-sm font-semibold text-canvas disabled:opacity-50"
                    >
                      {payingId === listing.id
                        ? 'Working…'
                        : `Pay ${formatAed(LISTING_FEE_FILS)} to publish`}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}

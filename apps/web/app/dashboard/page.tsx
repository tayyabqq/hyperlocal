'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserProfile } from '@hl/shared';
import { UserRole } from '@hl/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';
import { ProximityMark } from '@/components/ProximityMark';

export default function DashboardPage() {
  const router = useRouter();
  const { status, accessToken, user, setUser, refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && !user) void loadProfile();
  }, [status, user, router, loadProfile]);

  useEffect(() => {
    if (user && !user.isProfileComplete) router.replace('/onboarding');
  }, [user, router]);

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
              ? 'Your account is set up to hire. The map of workers near you opens next.'
              : 'Your account is set up to find work. The map of jobs near you opens next.'}
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-6 text-sm">
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
          </dl>

          <a
            href="/map"
            className="mt-6 inline-block rounded-card bg-ink px-6 py-3 text-sm font-semibold text-canvas"
          >
            Browse the map
          </a>
        </section>
      </div>
    </main>
  );
}

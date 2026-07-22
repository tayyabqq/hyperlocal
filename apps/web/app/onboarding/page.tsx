'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRole, type UserProfile } from '@hl/shared';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { Field, inputClass } from '@/components/Field';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';

export default function OnboardingPage() {
  const router = useRouter();
  const { status, accessToken, setUser } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.SEEKER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const profile = await apiFetch<UserProfile>('/v1/users/me', accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.trim(), role }),
      });
      setUser(profile);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your details.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated') return null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center font-display text-[26px] font-semibold text-ink">
          Set up your account
        </h1>
        <p className="mb-8 text-center text-sm leading-relaxed text-slate/70">
          This decides what you see first — jobs near you, or workers near you.
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Your name" htmlFor="name" hint="Shown to people you contact.">
            <input
              id="name"
              required
              minLength={2}
              maxLength={60}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate">I am here to</legend>
            <div className="grid grid-cols-2 gap-3">
              <RoleCard
                title="Find work"
                subtitle="Show me jobs nearby"
                selected={role === UserRole.SEEKER}
                onSelect={() => setRole(UserRole.SEEKER)}
              />
              <RoleCard
                title="Hire someone"
                subtitle="Show me workers nearby"
                selected={role === UserRole.PROVIDER}
                onSelect={() => setRole(UserRole.PROVIDER)}
              />
            </div>
          </fieldset>

          <ErrorNotice message={error} />
          <Button type="submit" loading={busy} disabled={displayName.trim().length < 2}>
            Continue
          </Button>
        </form>
      </div>
    </main>
  );
}

function RoleCard({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-card border px-4 py-4 text-left transition-colors ${
        selected ? 'border-ink bg-ink text-canvas' : 'border-line bg-white text-ink hover:border-slate/40'
      }`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className={`mt-0.5 block text-xs ${selected ? 'text-canvas/70' : 'text-slate/60'}`}>
        {subtitle}
      </span>
    </button>
  );
}

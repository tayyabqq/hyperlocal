'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/Button';
import { Field, inputClass } from '@/components/Field';
import { ErrorNotice } from '@/components/ErrorNotice';
import { ProximityMark } from '@/components/ProximityMark';

export default function LoginPage() {
  const router = useRouter();
  const { status, requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+971');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  // Drives the "Resend in Ns" affordance so the user is never left guessing.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await requestOtp(phone.trim());
      setChallengeId(result.challengeId);
      setCooldown(result.retryAfterSeconds);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await verifyOtp(challengeId, phone.trim(), code);
      router.replace(result.isNewUser || !result.user.isProfileComplete ? '/onboarding' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify that code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <ProximityMark className="mx-auto mb-8 h-20 w-20" />

        <h1 className="mb-2 text-center font-display text-[26px] font-semibold leading-tight text-ink">
          {step === 'phone' ? 'Work happens nearby' : 'Enter your code'}
        </h1>
        <p className="mb-8 text-center text-sm leading-relaxed text-slate/70">
          {step === 'phone'
            ? 'Sign in with your phone number. We send a code on WhatsApp — no password to remember.'
            : `We sent a 6-digit code to ${phone} on WhatsApp.`}
        </p>

        {step === 'phone' ? (
          <form onSubmit={onRequest} className="space-y-4">
            <Field label="Phone number" htmlFor="phone" hint="Include the country code.">
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </Field>
            <ErrorNotice message={error} />
            <Button type="submit" loading={busy} disabled={phone.trim().length < 8}>
              Send code
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <Field label="6-digit code" htmlFor="code">
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center text-2xl tracking-[0.4em]`}
              />
            </Field>
            <ErrorNotice message={error} />
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Verify and continue
            </Button>
            <button
              type="button"
              disabled={cooldown > 0}
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
              className="w-full py-2 text-center text-sm text-slate/60 underline disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Use a different number'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PaymentOrderSummary } from '@hl/shared';
import { formatAed, PaymentMethod, PaymentOrderStatus } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api-client';
import { fetchOrder, retryListingPayment } from '@/lib/payments-client';
import { Button } from '@/components/Button';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';
import { ProximityMark } from '@/components/ProximityMark';

const POLL_INTERVAL_MS = 2000;
// The gateway callback normally lands within a second or two; after this we
// stop spinning and tell the user plainly rather than looping forever.
const MAX_POLLS = 30;

/**
 * Where the payment gateway returns the user. The gateway's redirect is not
 * proof of payment — only our own callback is — so this screen polls the order
 * until the server confirms it.
 */
function PendingPaymentView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const { status: authStatus, accessToken } = useAuth();

  const [order, setOrder] = useState<PaymentOrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollCount = useRef(0);

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.replace('/login');
  }, [authStatus, router]);

  useEffect(() => {
    if (!accessToken || !orderId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = await fetchOrder(accessToken, orderId);
        if (cancelled) return;
        setOrder(next);

        if (next.status !== PaymentOrderStatus.PENDING) return;
        if (++pollCount.current >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not check your payment.');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, orderId]);

  const onRetry = useCallback(async () => {
    if (!accessToken || !order) return;
    setError(null);
    setRetrying(true);
    try {
      const next = await retryListingPayment(accessToken, order.listingId);
      if (next.redirectUrl) {
        window.location.href = next.redirectUrl;
        return;
      }
      setOrder(next);
      setTimedOut(false);
      pollCount.current = 0;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restart your payment.');
      setRetrying(false);
    }
  }, [accessToken, order]);

  if (authStatus === 'loading') return <FullPageSpinner />;
  if (authStatus !== 'authenticated') return null;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-md">
        <header className="mb-10 flex items-center gap-3">
          <ProximityMark className="h-9 w-9" />
          <span className="font-display text-lg font-semibold text-ink">Work Nearby</span>
        </header>

        <section className="rounded-card border border-line bg-white p-8">
          <ErrorNotice message={error} />

          {!orderId && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">Nothing to confirm</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">
                We could not tell which payment you meant. Your listings are on your dashboard.
              </p>
            </>
          )}

          {orderId && !order && !error && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">Checking your payment…</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">This takes a few seconds.</p>
            </>
          )}

          {order?.status === PaymentOrderStatus.PAID && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">Your listing is live</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">
                {order.method === PaymentMethod.CREDIT
                  ? 'That one was free — we used a listing credit. '
                  : `${formatAed(order.amountFils)} paid. `}
                People within 2 km can see it now, and it stays up for 7 days.
              </p>
              <div className="mt-6">
                <Button onClick={() => router.push('/map')}>See it on the map</Button>
              </div>
            </>
          )}

          {order?.status === PaymentOrderStatus.PENDING && !timedOut && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">
                Waiting for confirmation
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">
                Your bank is confirming {formatAed(order.amountFils)}. Keep this page open — it
                updates by itself.
              </p>
            </>
          )}

          {order?.status === PaymentOrderStatus.PENDING && timedOut && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">
                Still not confirmed
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">
                We have not had confirmation from your bank. Nothing has been posted and you have
                not been charged twice — you can start the payment again.
              </p>
              <div className="mt-6">
                <Button onClick={onRetry} loading={retrying}>
                  Try the payment again
                </Button>
              </div>
            </>
          )}

          {order?.status === PaymentOrderStatus.FAILED && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink">Payment did not go through</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate/70">
                Your listing is saved but not visible yet. You have not been charged.
              </p>
              <div className="mt-6">
                <Button onClick={onRetry} loading={retrying}>
                  Try again
                </Button>
              </div>
            </>
          )}

          <button
            onClick={() => router.push('/dashboard')}
            className="mt-6 text-sm text-slate/60 underline"
          >
            Back to dashboard
          </button>
        </section>
      </div>
    </main>
  );
}

export default function PendingPaymentPage() {
  // useSearchParams opts the route into client rendering; the boundary is what
  // Next requires to keep the rest of the shell static.
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <PendingPaymentView />
    </Suspense>
  );
}

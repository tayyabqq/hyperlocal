'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateListingRequest } from '@hl/shared';
import { formatAed, LISTING_FEE_FILS } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api-client';
import { createListing } from '@/lib/listings-client';
import { fetchCredits } from '@/lib/payments-client';
import { Button } from '@/components/Button';
import { Field, inputClass } from '@/components/Field';
import { ErrorNotice } from '@/components/ErrorNotice';
import { MapView } from '@/components/MapView';
import { FullPageSpinner } from '@/components/Spinner';

const DEIRA_DUBAI = { latitude: 25.2697, longitude: 55.3095 };

export default function NewListingPage() {
  const router = useRouter();
  const { status, accessToken } = useAuth();

  const [category, setCategory] = useState('');
  const [payAmountAed, setPayAmountAed] = useState('');
  const [description, setDescription] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [pin, setPin] = useState(DEIRA_DUBAI);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  // Drives the fee copy below the form. A failure here is not worth blocking
  // the form for — the wording just falls back to the standard fee.
  useEffect(() => {
    if (!accessToken) return;
    fetchCredits(accessToken)
      .then((balance) => setCredits(balance.credits))
      .catch(() => setCredits(null));
  }, [accessToken]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => undefined,
      { timeout: 5000 },
    );
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const payload: CreateListingRequest = {
        category: category.trim(),
        payAmountAed: Number(payAmountAed),
        description: description.trim(),
        latitude: pin.latitude,
        longitude: pin.longitude,
        locationLabel: locationLabel.trim(),
      };
      const { order } = await createListing(accessToken, payload);

      // A card order sends the user to the gateway's own page; a credit order
      // is already settled and only needs the confirmation screen.
      if (order.redirectUrl) {
        window.location.href = order.redirectUrl;
        return; // navigating away — leaving `busy` set keeps the form locked
      }
      router.push(`/listings/pending?orderId=${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post your listing.');
      setBusy(false);
    }
  }

  if (status === 'loading') return <FullPageSpinner />;
  if (status !== 'authenticated') return null;

  return (
    <main className="flex min-h-screen flex-col">
      <div className="h-64 w-full shrink-0">
        <MapView
          listings={[]}
          center={pin}
          pickerPin={{ ...pin, onMove: (latitude, longitude) => setPin({ latitude, longitude }) }}
        />
      </div>

      <div className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-sm">
          <h1 className="mb-1 font-display text-xl font-semibold text-ink">Post a listing</h1>
          <p className="mb-6 text-sm text-slate/70">
            Drag the pin to your exact location. Visible to nearby users for 7 days.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="What's the job or skill?" htmlFor="category">
              <input
                id="category"
                required
                minLength={2}
                maxLength={60}
                placeholder="e.g. Warehouse helper"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Pay (AED)" htmlFor="pay">
              <input
                id="pay"
                type="number"
                required
                min={5}
                max={2000}
                placeholder="120"
                value={payAmountAed}
                onChange={(e) => setPayAmountAed(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Area name" htmlFor="area">
              <input
                id="area"
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Al Murar, Deira"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Details" htmlFor="description">
              <textarea
                id="description"
                required
                minLength={10}
                maxLength={500}
                rows={4}
                placeholder="What's the work, when, and any requirements?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClass}
              />
            </Field>

            <ErrorNotice message={error} />

            <p className="text-sm text-slate/70">
              {credits && credits > 0
                ? `Free — you have ${credits} listing credit${credits > 1 ? 's' : ''} left.`
                : `${formatAed(LISTING_FEE_FILS)} to post. Your listing goes live as soon as payment clears.`}
            </p>

            <Button type="submit" loading={busy}>
              {credits && credits > 0 ? 'Post listing' : `Pay ${formatAed(LISTING_FEE_FILS)} and post`}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

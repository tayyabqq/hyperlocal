'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateListingRequest, ListingSummary } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/lib/api-client';
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

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

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
      await apiFetch<ListingSummary>('/v1/listings', accessToken, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      router.push('/map');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post your listing.');
    } finally {
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
            <Button type="submit" loading={busy}>
              Post listing
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

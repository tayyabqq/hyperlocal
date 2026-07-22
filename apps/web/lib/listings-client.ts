import type { BrowseListingsResult, ListingSummary } from '@hl/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/** Browsing is public — no auth token needed, matches the API contract. */
export async function fetchNearbyListings(
  latitude: number,
  longitude: number,
  radiusMeters?: number,
): Promise<BrowseListingsResult> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  if (radiusMeters) params.set('radiusMeters', String(radiusMeters));

  const res = await fetch(`${API_BASE_URL}/v1/listings?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load nearby listings');
  return res.json();
}

export async function fetchListing(id: string): Promise<ListingSummary> {
  const res = await fetch(`${API_BASE_URL}/v1/listings/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Listing not found');
  return res.json();
}

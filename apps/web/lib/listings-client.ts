import type {
  BrowseListingsResult,
  CreateListingRequest,
  CreateListingResult,
  ListingSummary,
} from '@hl/shared';
import { apiFetch } from './api-client';

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

/**
 * Creates the listing and opens its charge. The listing is not visible to
 * anyone until the returned order reaches PAID, so callers must follow the
 * order — not the listing — to decide what to show next.
 */
export function createListing(
  accessToken: string,
  payload: CreateListingRequest,
): Promise<CreateListingResult> {
  return apiFetch<CreateListingResult>('/v1/listings', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** The caller's own listings, including unpaid drafts they can still complete. */
export function fetchMyListings(accessToken: string): Promise<ListingSummary[]> {
  return apiFetch<ListingSummary[]>('/v1/listings/mine', accessToken);
}

import type {
  BrowseListingsResult,
  CreateListingRequest,
  CreateListingResult,
  ListingSummary,
} from '@hl/shared';
import { authedFetch, publicFetch } from './client';

export function fetchNearbyListings(latitude: number, longitude: number): Promise<BrowseListingsResult> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  return publicFetch<BrowseListingsResult>(`/v1/listings?${params.toString()}`);
}

/**
 * Creates the listing and opens its charge. The listing is invisible to
 * everyone until the returned order reaches PAID, so callers follow the order
 * rather than the listing to decide what to show next.
 */
export function createListing(
  accessToken: string,
  payload: CreateListingRequest,
): Promise<CreateListingResult> {
  return authedFetch<CreateListingResult>('/v1/listings', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** The caller's own listings, including unpaid drafts they can still complete. */
export function fetchMyListings(accessToken: string): Promise<ListingSummary[]> {
  return authedFetch<ListingSummary[]>('/v1/listings/mine', accessToken);
}

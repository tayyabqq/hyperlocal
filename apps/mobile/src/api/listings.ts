import type { BrowseListingsResult, CreateListingRequest, ListingSummary } from '@hl/shared';
import { authedFetch, publicFetch } from './client';

export function fetchNearbyListings(latitude: number, longitude: number): Promise<BrowseListingsResult> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  return publicFetch<BrowseListingsResult>(`/v1/listings?${params.toString()}`);
}

export function createListing(
  accessToken: string,
  payload: CreateListingRequest,
): Promise<ListingSummary> {
  return authedFetch<ListingSummary>('/v1/listings', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

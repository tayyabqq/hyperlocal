/**
 * Listing lifecycle events. Notifications subscribes to these so the listings
 * module never imports the notifications module — the same event-based
 * decoupling used for payments.
 */
export const ListingEvent = {
  EXPIRED: 'listing.expired',
} as const;

export interface ListingExpiredEvent {
  listingId: string;
  authorId: string;
  category: string;
}

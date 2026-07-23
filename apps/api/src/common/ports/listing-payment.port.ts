import type { PaymentMethod, PaymentOrderStatus } from '@hl/shared';

/**
 * The one seam between listings and payments.
 *
 * The architecture doc requires the payments module to be isolated — "no other
 * module imports from it except via a service interface" — so listings depends
 * on this token and these types, never on anything under `src/payments`. The
 * return direction (payments telling listings a charge settled) deliberately
 * does not appear here: it travels as a domain event instead, which keeps the
 * dependency acyclic and means a failure inside payments cannot propagate
 * synchronously into the listing write path.
 */
export const LISTING_PAYMENT_PORT = Symbol('LISTING_PAYMENT_PORT');

export interface ListingChargeRequest {
  userId: string;
  listingId: string;
  /** Passed to the gateway's hosted page so the payer sees who is being charged. */
  displayName: string;
  phoneE164: string;
}

export interface ListingCharge {
  orderId: string;
  status: PaymentOrderStatus;
  amountFils: number;
  method: PaymentMethod;
  /** Hosted payment page to send the user to; null when settled by credit. */
  redirectUrl: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface ListingPaymentPort {
  /**
   * Settles from the user's credit balance when one is available, otherwise
   * opens a hosted card payment. Throws only if no charge could be started at
   * all — callers must treat a PENDING result as success.
   */
  chargeForListing(request: ListingChargeRequest): Promise<ListingCharge>;
}

/**
 * Payment outcomes, published by the payments module and consumed by listings.
 *
 * The contract lives in `common` rather than in either module so neither has to
 * import the other: listings learns that a charge settled without ever
 * referencing `src/payments`, which is what keeps the payments module isolated
 * and its failures contained.
 */
export const PaymentEvent = {
  SETTLED: 'payment.settled',
  FAILED: 'payment.failed',
} as const;

export interface PaymentSettledEvent {
  orderId: string;
  listingId: string;
  userId: string;
  amountFils: number;
}

export interface PaymentFailedEvent {
  orderId: string;
  listingId: string;
  userId: string;
  reason: string;
}

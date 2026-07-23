import type { CreditBalance, PaymentOrderSummary } from '@hl/shared';
import { authedFetch } from './client';

export function fetchOrder(accessToken: string, orderId: string): Promise<PaymentOrderSummary> {
  return authedFetch<PaymentOrderSummary>(`/v1/payments/orders/${orderId}`, accessToken);
}

/** Re-opens payment for a draft whose hosted page was abandoned or declined. */
export function retryListingPayment(
  accessToken: string,
  listingId: string,
): Promise<PaymentOrderSummary> {
  return authedFetch<PaymentOrderSummary>(`/v1/listings/${listingId}/pay`, accessToken, {
    method: 'POST',
  });
}

export function fetchCredits(accessToken: string): Promise<CreditBalance> {
  return authedFetch<CreditBalance>('/v1/payments/credits', accessToken);
}

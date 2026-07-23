import type { CreditBalance, PaymentOrderSummary } from '@hl/shared';
import { apiFetch } from './api-client';

export function fetchOrder(accessToken: string, orderId: string): Promise<PaymentOrderSummary> {
  return apiFetch<PaymentOrderSummary>(`/v1/payments/orders/${orderId}`, accessToken);
}

export function fetchOrderForListing(
  accessToken: string,
  listingId: string,
): Promise<PaymentOrderSummary> {
  return apiFetch<PaymentOrderSummary>(`/v1/payments/listings/${listingId}/order`, accessToken);
}

/** Re-opens payment for a draft whose hosted page was abandoned or declined. */
export function retryListingPayment(
  accessToken: string,
  listingId: string,
): Promise<PaymentOrderSummary> {
  return apiFetch<PaymentOrderSummary>(`/v1/listings/${listingId}/pay`, accessToken, {
    method: 'POST',
  });
}

export function fetchCredits(accessToken: string): Promise<CreditBalance> {
  return apiFetch<CreditBalance>('/v1/payments/credits', accessToken);
}

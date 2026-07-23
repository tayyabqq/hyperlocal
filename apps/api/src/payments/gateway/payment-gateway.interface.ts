export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface HostedPaymentRequest {
  /** Our idempotency key. The gateway echoes it back on the callback. */
  cartId: string;
  amountFils: number;
  currency: string;
  description: string;
  customerName: string;
  customerPhoneE164: string;
}

export interface HostedPaymentSession {
  redirectUrl: string;
  providerRef: string;
}

export interface GatewayCallback {
  cartId: string;
  providerRef: string;
  amountFils: number;
  currency: string;
  settled: boolean;
  /** Present when `settled` is false; surfaced to the user verbatim is not safe, so it is logged only. */
  failureReason: string | null;
  /** Stable per-event identity used to make replayed callbacks a no-op. */
  eventId: string;
}

export interface PaymentGateway {
  /** Identifies rows this gateway wrote, so a provider switch stays auditable. */
  readonly name: string;

  /**
   * Opens a payment the user completes on the gateway's own page. Card data
   * never reaches this service, which is what keeps it outside PCI scope.
   */
  createHostedPayment(request: HostedPaymentRequest): Promise<HostedPaymentSession>;

  /**
   * Authenticates a callback against the raw request body. Must be
   * constant-time and must reject when the signature is absent — a forged
   * callback would otherwise activate listings for free.
   */
  verifyCallbackSignature(rawBody: Buffer, signature: string | undefined): boolean;

  parseCallback(payload: Record<string, unknown>): GatewayCallback;
}

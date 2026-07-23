import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode, FILS_PER_AED } from '@hl/shared';
import type {
  GatewayCallback,
  HostedPaymentRequest,
  HostedPaymentSession,
  PaymentGateway,
} from './payment-gateway.interface';

/**
 * PayTabs hosted payment page. Chosen in the technology doc for having no
 * monthly minimum at MVP volume; the `PaymentGateway` seam exists so the
 * documented Phase-2 switch to Telr is a provider swap, not a refactor.
 *
 * PayTabs reports success as `payment_result.response_status === 'A'`
 * (authorised). Every other status — declined, expired, pending review, voided
 * — is treated as not settled, which is the safe default: a listing stays
 * invisible unless money definitely arrived.
 */
@Injectable()
export class PayTabsGateway implements PaymentGateway {
  readonly name = 'paytabs';

  private readonly logger = new Logger(PayTabsGateway.name);

  constructor(private readonly config: ConfigService) {}

  async createHostedPayment(request: HostedPaymentRequest): Promise<HostedPaymentSession> {
    const baseUrl = this.config.getOrThrow<string>('PAYTABS_BASE_URL');
    const serverKey = this.config.getOrThrow<string>('PAYTABS_SERVER_KEY');

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/payment/request`, {
        method: 'POST',
        headers: { Authorization: serverKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: Number(this.config.getOrThrow<string>('PAYTABS_PROFILE_ID')),
          tran_type: 'sale',
          tran_class: 'ecom',
          cart_id: request.cartId,
          cart_description: request.description,
          cart_currency: request.currency,
          cart_amount: Number((request.amountFils / FILS_PER_AED).toFixed(2)),
          callback: this.config.getOrThrow<string>('PAYMENT_CALLBACK_URL'),
          return: this.config.getOrThrow<string>('PAYMENT_RETURN_URL'),
          hide_shipping: true,
          customer_details: {
            name: request.customerName,
            phone: request.customerPhoneE164,
            country: 'AE',
          },
        }),
      });
    } catch (error) {
      this.logger.error(`PayTabs request failed: ${String(error)}`);
      throw this.unavailable();
    }

    if (!response.ok) {
      this.logger.error(`PayTabs rejected request (${response.status}): ${await response.text()}`);
      throw this.unavailable();
    }

    const body = (await response.json()) as { redirect_url?: string; tran_ref?: string };
    if (!body.redirect_url || !body.tran_ref) {
      this.logger.error(`PayTabs response missing redirect_url/tran_ref: ${JSON.stringify(body)}`);
      throw this.unavailable();
    }

    return { redirectUrl: body.redirect_url, providerRef: body.tran_ref };
  }

  verifyCallbackSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = createHmac('sha256', this.config.getOrThrow<string>('PAYTABS_SERVER_KEY'))
      .update(rawBody)
      .digest('hex');

    const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
    const computed = Buffer.from(expected, 'utf8');
    if (provided.length !== computed.length) return false;
    return timingSafeEqual(provided, computed);
  }

  parseCallback(payload: Record<string, unknown>): GatewayCallback {
    const result = (payload.payment_result ?? {}) as Record<string, unknown>;
    const status = String(result.response_status ?? '');
    const settled = status === 'A';
    const providerRef = String(payload.tran_ref ?? '');

    return {
      cartId: String(payload.cart_id ?? ''),
      providerRef,
      amountFils: Math.round(Number(payload.cart_amount ?? 0) * FILS_PER_AED),
      currency: String(payload.cart_currency ?? ''),
      settled,
      failureReason: settled ? null : `${status}: ${String(result.response_message ?? 'unknown')}`,
      // tran_ref alone is stable across retries of the same outcome, but a
      // transaction can legitimately move (pending -> authorised), so the
      // status is part of the identity.
      eventId: `${providerRef}:${status}`,
    };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      errorCode: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      message: 'Payments are temporarily unavailable. Please try again in a moment.',
    });
  }
}

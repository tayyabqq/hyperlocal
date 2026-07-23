import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GatewayCallback,
  HostedPaymentRequest,
  HostedPaymentSession,
  PaymentGateway,
} from './payment-gateway.interface';

/**
 * Local/CI stand-in for a real gateway, mirroring how `ConsoleOtpProvider`
 * stands in for WhatsApp. The redirect points at the sandbox settle endpoint so
 * the whole post → pay → activate journey is exercisable end-to-end without a
 * PayTabs account.
 *
 * Env validation refuses to boot with this gateway when NODE_ENV=production, so
 * the free-money path it represents cannot reach a live deployment.
 */
@Injectable()
export class ManualGateway implements PaymentGateway {
  readonly name = 'manual';

  private readonly logger = new Logger(ManualGateway.name);

  constructor(private readonly config: ConfigService) {}

  createHostedPayment(request: HostedPaymentRequest): Promise<HostedPaymentSession> {
    const apiUrl = this.config.getOrThrow<string>('API_PUBLIC_URL').replace(/\/$/, '');
    this.logger.log(
      `Sandbox payment opened for cart ${request.cartId} (${request.amountFils} fils ${request.currency}).`,
    );

    return Promise.resolve({
      redirectUrl: `${apiUrl}/v1/payments/sandbox/${encodeURIComponent(request.cartId)}`,
      providerRef: `manual_${request.cartId}`,
    });
  }

  /** No callbacks exist in sandbox mode; the settle endpoint replaces them. */
  verifyCallbackSignature(): boolean {
    return false;
  }

  parseCallback(): GatewayCallback {
    throw new Error('ManualGateway does not receive gateway callbacks');
  }
}

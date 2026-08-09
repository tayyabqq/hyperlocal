import { randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  LISTING_FEE_FILS,
  PaymentMethod,
  PaymentOrderStatus,
  type PaymentOrderSummary,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { paymentOrders, webhookEvents, type PaymentOrderRow } from '../db/schema';
import { captureException } from '../observability/sentry';
import { AnalyticsService } from '../analytics/analytics.service';
import type {
  ListingCharge,
  ListingChargeRequest,
  ListingPaymentPort,
} from '../common/ports/listing-payment.port';
import { CreditsService } from './credits.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway.interface';
import {
  PaymentEvent,
  type PaymentFailedEvent,
  type PaymentSettledEvent,
} from '../common/events/payment.events';

const CURRENCY = 'AED';

@Injectable()
export class PaymentsService implements ListingPaymentPort {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly credits: CreditsService,
    private readonly analytics: AnalyticsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async chargeForListing(request: ListingChargeRequest): Promise<ListingCharge> {
    // Unique per attempt, not per listing: a user who abandons the hosted page
    // and retries must get a fresh cart the gateway has not already seen.
    const cartId = `HL-${request.listingId}-${randomBytes(4).toString('hex')}`;

    if (await this.credits.tryConsumeOne(request.userId, request.listingId)) {
      const [order] = await this.db
        .insert(paymentOrders)
        .values({
          listingId: request.listingId,
          userId: request.userId,
          amountFils: 0,
          currency: CURRENCY,
          status: 'PAID',
          method: 'CREDIT',
          provider: 'credit',
          providerCartId: cartId,
          paidAt: new Date(),
        })
        .returning();

      await this.analytics.track(AnalyticsEvent.PAYMENT_SETTLED, request.userId, {
        orderId: order.id,
        method: PaymentMethod.CREDIT,
        amountFils: 0,
      });
      this.emitSettled(order);
      return toCharge(order);
    }

    const [order] = await this.db
      .insert(paymentOrders)
      .values({
        listingId: request.listingId,
        userId: request.userId,
        amountFils: LISTING_FEE_FILS,
        currency: CURRENCY,
        status: 'PENDING',
        method: 'CARD',
        provider: this.gateway.name,
        providerCartId: cartId,
      })
      .returning();

    try {
      const session = await this.gateway.createHostedPayment({
        cartId,
        amountFils: LISTING_FEE_FILS,
        currency: CURRENCY,
        description: 'Work Nearby listing fee',
        customerName: request.displayName,
        customerPhoneE164: request.phoneE164,
      });

      const [updated] = await this.db
        .update(paymentOrders)
        .set({ redirectUrl: session.redirectUrl, providerRef: session.providerRef })
        .where(eq(paymentOrders.id, order.id))
        .returning();

      await this.analytics.track(AnalyticsEvent.PAYMENT_INITIATED, request.userId, {
        orderId: order.id,
        amountFils: LISTING_FEE_FILS,
      });
      return toCharge(updated);
    } catch (error) {
      await this.markFailed(order, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async findOrderForUser(orderId: string, userId: string): Promise<PaymentOrderSummary> {
    const [order] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.userId, userId)))
      .limit(1);

    if (!order) {
      throw new NotFoundException({
        errorCode: ErrorCode.PAYMENT_ORDER_NOT_FOUND,
        message: 'That payment could not be found.',
      });
    }
    return toSummary(order);
  }

  async latestOrderForListing(listingId: string, userId: string): Promise<PaymentOrderSummary> {
    const [order] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.listingId, listingId), eq(paymentOrders.userId, userId)))
      .orderBy(desc(paymentOrders.createdAt))
      .limit(1);

    if (!order) {
      throw new NotFoundException({
        errorCode: ErrorCode.PAYMENT_ORDER_NOT_FOUND,
        message: 'That payment could not be found.',
      });
    }
    return toSummary(order);
  }

  /**
   * Gateway callback. Returns normally for anything the gateway should stop
   * retrying (replays, unknown carts, declines) and throws only when the
   * request could not be authenticated — the HTTP status is the gateway's
   * retry signal, so returning 200 on a decline is deliberate.
   */
  async handleGatewayCallback(rawBody: Buffer, signature: string | undefined): Promise<void> {
    if (!this.gateway.verifyCallbackSignature(rawBody, signature)) {
      this.logger.warn('Rejected payment callback with an invalid signature.');
      throw new UnauthorizedException({
        errorCode: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        message: 'Invalid callback signature.',
      });
    }

    const callback = this.gateway.parseCallback(
      JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
    );

    const recorded = await this.db
      .insert(webhookEvents)
      .values({
        provider: this.gateway.name,
        providerEventId: callback.eventId,
        payload: { cartId: callback.cartId, settled: callback.settled },
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });

    if (recorded.length === 0) {
      this.logger.log(`Ignored replayed callback ${callback.eventId}.`);
      return;
    }

    const [order] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.providerCartId, callback.cartId))
      .limit(1);

    if (!order) {
      this.logger.warn(`Callback referenced unknown cart ${callback.cartId}.`);
      return;
    }

    if (!callback.settled) {
      await this.markFailed(order, callback.failureReason ?? 'declined');
      return;
    }

    // A tampered callback claiming a smaller amount must never settle the
    // order, so the gateway's figures are checked against what we asked for.
    if (callback.amountFils !== order.amountFils || callback.currency !== order.currency) {
      this.logger.error(
        `Amount mismatch on cart ${callback.cartId}: expected ${order.amountFils} ${order.currency}, got ${callback.amountFils} ${callback.currency}.`,
      );
      await this.markFailed(order, 'amount_mismatch');
      return;
    }

    await this.settle(order, callback.providerRef);
  }

  /**
   * Sandbox-only settle used by the manual gateway's redirect. Guarded here as
   * well as by env validation: defence in depth on a free-money endpoint.
   */
  async settleSandbox(cartId: string): Promise<string> {
    if (this.gateway.name !== 'manual') {
      throw new NotFoundException({
        errorCode: ErrorCode.PAYMENT_ORDER_NOT_FOUND,
        message: 'Not found.',
      });
    }

    const [order] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.providerCartId, cartId))
      .limit(1);

    if (!order) {
      throw new NotFoundException({
        errorCode: ErrorCode.PAYMENT_ORDER_NOT_FOUND,
        message: 'That payment could not be found.',
      });
    }

    await this.settle(order, `manual_${cartId}`);
    return `${this.config.getOrThrow<string>('PAYMENT_RETURN_URL')}?orderId=${order.id}`;
  }

  /**
   * Moves a PENDING order to PAID. The `status = 'PENDING'` predicate makes
   * this a compare-and-set: concurrent callbacks race, exactly one wins, and
   * the loser emits nothing.
   *
   * A second, independent order for the same listing (the user opened two
   * hosted payment sessions and paid both — e.g. an abandoned tab retried
   * later) can still reach this point after the listing is already active.
   * The DB's `payment_orders_one_paid_per_listing_idx` partial unique index
   * is the actual backstop: it rejects the second UPDATE outright. That is
   * real money already captured by the gateway with nowhere to go, so it is
   * marked for manual refund and surfaced to Sentry rather than crashing the
   * webhook handler.
   */
  private async settle(order: PaymentOrderRow, providerRef: string): Promise<void> {
    let updated: PaymentOrderRow | undefined;
    try {
      [updated] = await this.db
        .update(paymentOrders)
        .set({ status: 'PAID', paidAt: new Date(), providerRef })
        .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'PENDING')))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.db
          .update(paymentOrders)
          .set({
            status: 'FAILED',
            failureReason: 'duplicate_settlement_needs_manual_refund',
          })
          .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'PENDING')));
        this.logger.error(
          `Order ${order.id} for listing ${order.listingId} was paid but the listing already ` +
            `has a settled order. Money was captured by the gateway; a manual refund is required.`,
        );
        captureException(error);
        return;
      }
      throw error;
    }

    if (!updated) {
      this.logger.log(`Order ${order.id} was already settled; nothing to do.`);
      return;
    }

    await this.analytics.track(AnalyticsEvent.PAYMENT_SETTLED, updated.userId, {
      orderId: updated.id,
      method: updated.method,
      amountFils: updated.amountFils,
    });
    this.emitSettled(updated);
  }

  private async markFailed(order: PaymentOrderRow, reason: string): Promise<void> {
    await this.db
      .update(paymentOrders)
      .set({ status: 'FAILED', failureReason: reason.slice(0, 500) })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'PENDING')));

    await this.analytics.track(AnalyticsEvent.PAYMENT_FAILED, order.userId, {
      orderId: order.id,
      reason,
    });

    this.events.emit(PaymentEvent.FAILED, {
      orderId: order.id,
      listingId: order.listingId,
      userId: order.userId,
      reason,
    } satisfies PaymentFailedEvent);
  }

  private emitSettled(order: PaymentOrderRow): void {
    this.events.emit(PaymentEvent.SETTLED, {
      orderId: order.id,
      listingId: order.listingId,
      userId: order.userId,
      amountFils: order.amountFils,
    } satisfies PaymentSettledEvent);
  }
}

/** Postgres unique_violation (23505) — the only constraint this UPDATE can hit. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function toSummary(order: PaymentOrderRow): PaymentOrderSummary {
  return {
    id: order.id,
    listingId: order.listingId,
    status: order.status as PaymentOrderStatus,
    amountFils: order.amountFils,
    method: order.method as PaymentMethod,
    // Sending a stale hosted-page URL for a settled order invites a second
    // charge, so it is only ever exposed while the order is still payable.
    redirectUrl: order.status === 'PENDING' ? order.redirectUrl : null,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
  };
}

function toCharge(order: PaymentOrderRow): ListingCharge {
  return {
    orderId: order.id,
    status: order.status as PaymentOrderStatus,
    amountFils: order.amountFils,
    method: order.method as PaymentMethod,
    redirectUrl: order.status === 'PENDING' ? order.redirectUrl : null,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

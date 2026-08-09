import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { LISTING_FEE_FILS } from '@hl/shared';
import { PaymentsService } from '../src/payments/payments.service';
import { CreditsService } from '../src/payments/credits.service';
import { PAYMENT_GATEWAY } from '../src/payments/gateway/payment-gateway.interface';
import { PaymentEvent } from '../src/common/events/payment.events';
import { DB } from '../src/db/db.module';
import { AnalyticsService } from '../src/analytics/analytics.service';

function insertChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    values: () => chain,
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

function updateChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let dbInsert: jest.Mock;
  let dbSelect: jest.Mock;
  let dbUpdate: jest.Mock;
  let tryConsumeOne: jest.Mock;
  let createHostedPayment: jest.Mock;
  let verifyCallbackSignature: jest.Mock;
  let parseCallback: jest.Mock;
  let emit: jest.Mock;
  let track: jest.Mock;
  let gatewayName: string;

  const request = {
    userId: 'user-1',
    listingId: 'listing-1',
    displayName: 'Rashid',
    phoneE164: '+971500000001',
  };

  function orderRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-1',
      listingId: 'listing-1',
      userId: 'user-1',
      amountFils: LISTING_FEE_FILS,
      currency: 'AED',
      status: 'PENDING',
      method: 'CARD',
      provider: 'paytabs',
      providerCartId: 'HL-listing-1-abcd',
      providerRef: null,
      redirectUrl: null,
      failureReason: null,
      createdAt: new Date(),
      paidAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    gatewayName = 'paytabs';
    dbInsert = jest.fn();
    dbSelect = jest.fn();
    dbUpdate = jest.fn().mockReturnValue(updateChain([]));
    tryConsumeOne = jest.fn().mockResolvedValue(false);
    createHostedPayment = jest.fn();
    verifyCallbackSignature = jest.fn().mockReturnValue(true);
    parseCallback = jest.fn();
    emit = jest.fn();
    track = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: DB, useValue: { insert: dbInsert, select: dbSelect, update: dbUpdate } },
        {
          provide: PAYMENT_GATEWAY,
          useValue: {
            get name() {
              return gatewayName;
            },
            createHostedPayment,
            verifyCallbackSignature,
            parseCallback,
          },
        },
        { provide: CreditsService, useValue: { tryConsumeOne } },
        { provide: AnalyticsService, useValue: { track } },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'https://web.example/pending' } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('chargeForListing', () => {
    it('settles from the credit balance without contacting the gateway', async () => {
      tryConsumeOne.mockResolvedValueOnce(true);
      dbInsert.mockReturnValueOnce(
        insertChain([orderRow({ status: 'PAID', method: 'CREDIT', amountFils: 0, paidAt: new Date() })]),
      );

      const charge = await service.chargeForListing(request);

      expect(charge.amountFils).toBe(0);
      expect(charge.method).toBe('CREDIT');
      expect(charge.redirectUrl).toBeNull();
      expect(createHostedPayment).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(PaymentEvent.SETTLED, expect.objectContaining({ listingId: 'listing-1' }));
    });

    it('opens a hosted payment for the listing fee when no credit is available', async () => {
      dbInsert.mockReturnValueOnce(insertChain([orderRow()]));
      createHostedPayment.mockResolvedValueOnce({
        redirectUrl: 'https://pay.example/hosted/abc',
        providerRef: 'TST123',
      });
      dbUpdate.mockReturnValueOnce(
        updateChain([orderRow({ redirectUrl: 'https://pay.example/hosted/abc', providerRef: 'TST123' })]),
      );

      const charge = await service.chargeForListing(request);

      expect(charge.status).toBe('PENDING');
      expect(charge.amountFils).toBe(LISTING_FEE_FILS);
      expect(charge.redirectUrl).toBe('https://pay.example/hosted/abc');
      expect(createHostedPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amountFils: LISTING_FEE_FILS, currency: 'AED' }),
      );
      // Nothing is emitted until the gateway confirms the money arrived.
      expect(emit).not.toHaveBeenCalled();
    });

    it('marks the order failed and rethrows when the gateway is unreachable', async () => {
      dbInsert.mockReturnValueOnce(insertChain([orderRow()]));
      createHostedPayment.mockRejectedValueOnce(new Error('gateway down'));

      await expect(service.chargeForListing(request)).rejects.toThrow('gateway down');
      expect(emit).toHaveBeenCalledWith(PaymentEvent.FAILED, expect.objectContaining({ orderId: 'order-1' }));
    });
  });

  describe('handleGatewayCallback', () => {
    const body = Buffer.from(JSON.stringify({ cart_id: 'HL-listing-1-abcd' }));

    it('rejects a callback whose signature does not verify', async () => {
      verifyCallbackSignature.mockReturnValueOnce(false);

      await expect(service.handleGatewayCallback(body, 'bad')).rejects.toThrow(UnauthorizedException);
      expect(dbInsert).not.toHaveBeenCalled();
    });

    it('treats a replayed callback as a no-op', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: LISTING_FEE_FILS,
        currency: 'AED',
        settled: true,
        failureReason: null,
        eventId: 'TST123:A',
      });
      dbInsert.mockReturnValueOnce(insertChain([])); // unique conflict -> no row

      await service.handleGatewayCallback(body, 'sig');

      expect(dbSelect).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('refuses to settle when the reported amount does not match the order', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: 1, // tampered
        currency: 'AED',
        settled: true,
        failureReason: null,
        eventId: 'TST123:A',
      });
      dbInsert.mockReturnValueOnce(insertChain([{ id: 'evt-1' }]));
      dbSelect.mockReturnValueOnce(selectChain([orderRow()]));

      await service.handleGatewayCallback(body, 'sig');

      expect(emit).toHaveBeenCalledWith(PaymentEvent.FAILED, expect.objectContaining({ reason: 'amount_mismatch' }));
      expect(emit).not.toHaveBeenCalledWith(PaymentEvent.SETTLED, expect.anything());
    });

    it('settles a matching authorised callback and announces it', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: LISTING_FEE_FILS,
        currency: 'AED',
        settled: true,
        failureReason: null,
        eventId: 'TST123:A',
      });
      dbInsert.mockReturnValueOnce(insertChain([{ id: 'evt-1' }]));
      dbSelect.mockReturnValueOnce(selectChain([orderRow()]));
      dbUpdate.mockReturnValueOnce(updateChain([orderRow({ status: 'PAID', paidAt: new Date() })]));

      await service.handleGatewayCallback(body, 'sig');

      expect(emit).toHaveBeenCalledWith(
        PaymentEvent.SETTLED,
        expect.objectContaining({ orderId: 'order-1', listingId: 'listing-1' }),
      );
    });

    it('emits nothing when the compare-and-set loses to a concurrent settle', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: LISTING_FEE_FILS,
        currency: 'AED',
        settled: true,
        failureReason: null,
        eventId: 'TST123:A',
      });
      dbInsert.mockReturnValueOnce(insertChain([{ id: 'evt-1' }]));
      dbSelect.mockReturnValueOnce(selectChain([orderRow()]));
      dbUpdate.mockReturnValueOnce(updateChain([])); // already PAID

      await service.handleGatewayCallback(body, 'sig');

      expect(emit).not.toHaveBeenCalled();
    });

    it('marks the order for manual refund instead of crashing when a second order for the same listing already settled', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: LISTING_FEE_FILS,
        currency: 'AED',
        settled: true,
        failureReason: null,
        eventId: 'TST123:A',
      });
      dbInsert.mockReturnValueOnce(insertChain([{ id: 'evt-1' }]));
      dbSelect.mockReturnValueOnce(selectChain([orderRow()]));
      // First update attempt hits payment_orders_one_paid_per_listing_idx.
      const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' });
      dbUpdate
        .mockReturnValueOnce({
          set: () => ({ where: () => ({ returning: () => Promise.reject(uniqueViolation) }) }),
        })
        .mockReturnValueOnce(updateChain([])); // the FAILED-marking update that follows

      await expect(service.handleGatewayCallback(body, 'sig')).resolves.toBeUndefined();

      expect(emit).not.toHaveBeenCalled();
      expect(dbUpdate).toHaveBeenCalledTimes(2);
    });

    it('records a decline without settling', async () => {
      parseCallback.mockReturnValueOnce({
        cartId: 'HL-listing-1-abcd',
        providerRef: 'TST123',
        amountFils: LISTING_FEE_FILS,
        currency: 'AED',
        settled: false,
        failureReason: 'D: declined',
        eventId: 'TST123:D',
      });
      dbInsert.mockReturnValueOnce(insertChain([{ id: 'evt-1' }]));
      dbSelect.mockReturnValueOnce(selectChain([orderRow()]));

      await service.handleGatewayCallback(body, 'sig');

      expect(emit).toHaveBeenCalledWith(PaymentEvent.FAILED, expect.objectContaining({ reason: 'D: declined' }));
    });
  });

  describe('settleSandbox', () => {
    it('is unreachable unless the manual gateway is configured', async () => {
      gatewayName = 'paytabs';

      await expect(service.settleSandbox('HL-listing-1-abcd')).rejects.toThrow(NotFoundException);
    });

    it('settles the order and returns the configured return URL', async () => {
      gatewayName = 'manual';
      dbSelect.mockReturnValueOnce(selectChain([orderRow({ provider: 'manual' })]));
      dbUpdate.mockReturnValueOnce(updateChain([orderRow({ status: 'PAID', paidAt: new Date() })]));

      const url = await service.settleSandbox('HL-listing-1-abcd');

      expect(url).toBe('https://web.example/pending?orderId=order-1');
      expect(emit).toHaveBeenCalledWith(PaymentEvent.SETTLED, expect.anything());
    });
  });
});

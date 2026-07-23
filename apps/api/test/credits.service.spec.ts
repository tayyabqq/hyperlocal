import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CreditsService, CreditReason } from '../src/payments/credits.service';
import { DB } from '../src/db/db.module';
import { AnalyticsService } from '../src/analytics/analytics.service';

describe('CreditsService', () => {
  let service: CreditsService;
  let execute: jest.Mock;
  let txExecute: jest.Mock;
  let txInsert: jest.Mock;
  let insertedValues: Record<string, unknown>[];
  let launchGrant: string;
  let track: jest.Mock;

  beforeEach(async () => {
    launchGrant = '1';
    execute = jest.fn();
    txExecute = jest.fn().mockResolvedValue([]);
    insertedValues = [];
    txInsert = jest.fn().mockReturnValue({
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        return Promise.resolve([]);
      },
    });
    track = jest.fn().mockResolvedValue(undefined);

    const transaction = (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ execute: txExecute, insert: txInsert });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: DB, useValue: { execute, transaction } },
        { provide: ConfigService, useValue: { get: () => launchGrant } },
        { provide: AnalyticsService, useValue: { track } },
      ],
    }).compile();

    service = moduleRef.get(CreditsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('reports a zero balance for a user with no ledger entries', async () => {
    execute.mockResolvedValueOnce([{ balance: 0 }]);

    await expect(service.balanceOf('user-1')).resolves.toBe(0);
  });

  describe('tryConsumeOne', () => {
    it('grants the launch credit on a first-ever listing and immediately spends it', async () => {
      txExecute
        .mockResolvedValueOnce([]) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce([{ balance: 0, entries: 0 }]);

      await expect(service.tryConsumeOne('user-1', 'listing-1')).resolves.toBe(true);

      expect(insertedValues).toEqual([
        expect.objectContaining({ delta: 1, reason: CreditReason.LAUNCH_GRANT }),
        expect.objectContaining({ delta: -1, reason: CreditReason.LISTING_PAYMENT, listingId: 'listing-1' }),
      ]);
    });

    it('spends an existing credit without granting another', async () => {
      txExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ balance: 2, entries: 3 }]);

      await expect(service.tryConsumeOne('user-1', 'listing-1')).resolves.toBe(true);

      expect(insertedValues).toEqual([expect.objectContaining({ delta: -1 })]);
    });

    it('declines when the user has spent their credits, so the fee wall applies', async () => {
      txExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ balance: 0, entries: 4 }]);

      await expect(service.tryConsumeOne('user-1', 'listing-1')).resolves.toBe(false);

      expect(insertedValues).toEqual([]);
      expect(track).not.toHaveBeenCalled();
    });

    it('does not grant anything when the launch offer is switched off', async () => {
      launchGrant = '0';
      txExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ balance: 0, entries: 0 }]);

      await expect(service.tryConsumeOne('user-1', 'listing-1')).resolves.toBe(false);

      expect(insertedValues).toEqual([]);
    });
  });
});

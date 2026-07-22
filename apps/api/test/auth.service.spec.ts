import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService, hashOpaqueToken } from '../src/auth/auth.service';
import { DB } from '../src/db/db.module';
import { OTP_PROVIDER } from '../src/auth/otp/otp-provider.interface';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { JwtService } from '@nestjs/jwt';


/**
 * Drizzle's fluent builders are thenable, so the mock resolves to whatever rows
 * a real query would return. `queueSelect` lines up successive SELECT results.
 */
interface DbMock {
  queueSelect: (rows: unknown[]) => void;
  inserted: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  db: {
    select: () => Record<string, unknown>;
    insert: () => Record<string, unknown>;
    update: () => Record<string, unknown>;
  };
}

describe('AuthService', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');
  let service: AuthService;
  let dbMock: DbMock;
  let sendOtp: jest.Mock;
  let insertReturn: unknown[];
  let updateReturn: unknown[];

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now);
    sendOtp = jest.fn().mockResolvedValue(undefined);
    insertReturn = [{ id: 'challenge-1' }];
    updateReturn = [{ id: 'user-1' }];

    const selectQueue: unknown[][] = [];
    dbMock = {
      queueSelect: (rows: unknown[]) => selectQueue.push(rows),
      inserted: [],
      updates: [],
      db: {
        select: () => buildChain(() => selectQueue.shift() ?? [], dbMock),
        insert: () => buildChain(() => insertReturn, dbMock),
        update: () => buildChain(() => updateReturn, dbMock),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DB, useValue: dbMock.db },
        { provide: OTP_PROVIDER, useValue: { sendOtp } },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('jwt.access') } },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('issues a 6-digit code and returns the challenge id', async () => {
      dbMock.queueSelect([]);

      const result = await service.requestOtp('+971501234567');

      expect(result.challengeId).toBe('challenge-1');
      expect(result.retryAfterSeconds).toBe(60);
      expect(sendOtp).toHaveBeenCalledWith('+971501234567', expect.stringMatching(/^\d{6}$/));
    });

    it('never stores the code in plaintext', async () => {
      dbMock.queueSelect([]);

      await service.requestOtp('+971501234567');

      const sentCode = sendOtp.mock.calls[0][1] as string;
      const stored = dbMock.inserted.find((row) => 'codeHash' in row);
      expect(stored).toBeDefined();
      expect(stored?.codeHash).not.toBe(sentCode);
      await expect(bcrypt.compare(sentCode, stored?.codeHash as string)).resolves.toBe(true);
    });

    it('rejects a resend inside the cooldown window', async () => {
      dbMock.queueSelect([{ createdAt: new Date(now.getTime() - 10_000), consumedAt: null }]);

      await expect(service.requestOtp('+971501234567')).rejects.toThrow(BadRequestException);
      expect(sendOtp).not.toHaveBeenCalled();
    });

    it('allows a resend once the cooldown has passed', async () => {
      dbMock.queueSelect([{ createdAt: new Date(now.getTime() - 61_000), consumedAt: null }]);

      await expect(service.requestOtp('+971501234567')).resolves.toMatchObject({
        challengeId: 'challenge-1',
      });
    });

    it('burns the challenge when delivery fails so a dead code cannot be used', async () => {
      dbMock.queueSelect([]);
      sendOtp.mockRejectedValueOnce(new Error('carrier down'));

      await expect(service.requestOtp('+971501234567')).rejects.toThrow('carrier down');
      expect(dbMock.updates.some((u) => u.consumedAt instanceof Date)).toBe(true);
    });
  });

  describe('verifyOtp', () => {
    const validChallenge = async (overrides: Record<string, unknown> = {}) => ({
      id: 'challenge-1',
      phoneE164: '+971501234567',
      codeHash: await bcrypt.hash('123456', 4),
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      attemptCount: 0,
      ...overrides,
    });

    it('rejects an unknown challenge', async () => {
      dbMock.queueSelect([]);
      await expect(service.verifyOtp('nope', '+971501234567', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired challenge', async () => {
      dbMock.queueSelect([await validChallenge({ expiresAt: new Date(now.getTime() - 1) })]);
      await expect(service.verifyOtp('challenge-1', '+971501234567', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects once the attempt cap is reached', async () => {
      dbMock.queueSelect([await validChallenge({ attemptCount: 5 })]);
      await expect(service.verifyOtp('challenge-1', '+971501234567', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a challenge issued to a different number', async () => {
      dbMock.queueSelect([await validChallenge()]);
      await expect(service.verifyOtp('challenge-1', '+971509999999', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('counts a wrong code against the attempt cap', async () => {
      dbMock.queueSelect([await validChallenge()]);

      await expect(service.verifyOtp('challenge-1', '+971501234567', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dbMock.updates.some((u) => u.attemptCount === 1)).toBe(true);
    });

    it('creates an incomplete profile for a first-time number', async () => {
      dbMock.queueSelect([await validChallenge()]);
      dbMock.queueSelect([]); // no existing user
      insertReturn = [
        {
          id: 'user-1',
          phoneE164: '+971501234567',
          displayName: '',
          role: 'SEEKER',
          isProfileComplete: false,
          createdAt: now,
        },
      ];

      const result = await service.verifyOtp('challenge-1', '+971501234567', '123456');

      expect(result.isNewUser).toBe(true);
      expect(result.user.isProfileComplete).toBe(false);
      expect(result.tokens.accessToken).toBe('jwt.access');
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
    });

    it('returns the existing profile for a known number', async () => {
      dbMock.queueSelect([await validChallenge()]);
      dbMock.queueSelect([{ id: 'user-1' }]);
      updateReturn = [
        {
          id: 'user-1',
          phoneE164: '+971501234567',
          displayName: 'Rashid',
          role: 'PROVIDER',
          isProfileComplete: true,
          createdAt: now,
        },
      ];

      const result = await service.verifyOtp('challenge-1', '+971501234567', '123456');

      expect(result.isNewUser).toBe(false);
      expect(result.user.displayName).toBe('Rashid');
    });
  });

  describe('refresh', () => {
    it('rejects a token that was never issued', async () => {
      dbMock.queueSelect([]);
      await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      dbMock.queueSelect([
        { id: 'rt-1', userId: 'user-1', revokedAt: null, expiresAt: new Date(now.getTime() - 1) },
      ]);
      await expect(service.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes every session when a rotated token is replayed', async () => {
      dbMock.queueSelect([
        { id: 'rt-1', userId: 'user-1', revokedAt: now, expiresAt: new Date(now.getTime() + 1000) },
      ]);

      await expect(service.refresh('leaked-token')).rejects.toMatchObject({
        response: { errorCode: 'REFRESH_REUSE_DETECTED' },
      });
      expect(dbMock.updates.some((u) => u.revokedAt instanceof Date)).toBe(true);
    });

    it('rotates the token on success', async () => {
      dbMock.queueSelect([
        {
          id: 'rt-1',
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      ]);

      const tokens = await service.refresh('valid-token');

      expect(tokens.accessToken).toBe('jwt.access');
      expect(dbMock.updates.some((u) => u.revokedAt instanceof Date)).toBe(true);
    });
  });

  describe('hashOpaqueToken', () => {
    it('is deterministic and does not echo the input', () => {
      const hash = hashOpaqueToken('abc');
      expect(hash).toBe(hashOpaqueToken('abc'));
      expect(hash).not.toContain('abc');
      expect(hash).toHaveLength(64);
    });
  });
});

/** Builds a thenable stand-in for a Drizzle query chain. */
function buildChain(
  resolveRows: () => unknown,
  sink: { inserted: Record<string, unknown>[]; updates: Record<string, unknown>[] },
): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(resolveRows()),
    set: (values: Record<string, unknown>) => {
      sink.updates.push(values);
      return chain;
    },
    values: (values: Record<string, unknown>) => {
      sink.inserted.push(values);
      return chain;
    },
    returning: () => Promise.resolve(resolveRows()),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolveRows()).then(resolve),
  };
  return chain;
}

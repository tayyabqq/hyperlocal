import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  UserRole,
  type AuthTokens,
  type RequestOtpResult,
  type UserProfile,
  type VerifyOtpResult,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { otpChallenges, refreshTokens, users, type UserRow } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import { OTP_PROVIDER, type OtpProvider } from './otp/otp-provider.interface';

const OTP_TTL_SECONDS = 300;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    private readonly jwt: JwtService,
    private readonly analytics: AnalyticsService,
  ) {}

  async requestOtp(phoneE164: string): Promise<RequestOtpResult> {
    const [latest] = await this.db
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.phoneE164, phoneE164), isNull(otpChallenges.consumedAt)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);

    if (latest) {
      const elapsedSeconds = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
        throw new BadRequestException({
          errorCode: ErrorCode.OTP_COOLDOWN,
          message: `Wait ${Math.ceil(
            OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds,
          )} seconds before requesting another code.`,
        });
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);

    const [challenge] = await this.db
      .insert(otpChallenges)
      .values({
        phoneE164,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      })
      .returning();

    // Delivery failure must not leave a usable challenge behind.
    try {
      await this.otpProvider.sendOtp(phoneE164, code);
    } catch (error) {
      await this.db
        .update(otpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenges.id, challenge.id));
      throw error;
    }

    await this.analytics.track(AnalyticsEvent.OTP_REQUESTED, null, { phoneE164 });

    return {
      challengeId: challenge.id,
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: OTP_TTL_SECONDS,
    };
  }

  async verifyOtp(challengeId: string, phoneE164: string, code: string): Promise<VerifyOtpResult> {
    // Every rejection returns the same error: never reveal whether the
    // challenge existed, expired, or simply had the wrong code.
    const reject = (): never => {
      throw new UnauthorizedException({
        errorCode: ErrorCode.OTP_INVALID,
        message: 'That code is invalid or has expired. Request a new one.',
      });
    };

    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.id, challengeId))
      .limit(1);

    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.attemptCount >= OTP_MAX_ATTEMPTS ||
      challenge.expiresAt.getTime() < Date.now() ||
      !this.constantTimeEquals(challenge.phoneE164, phoneE164)
    ) {
      reject();
    }

    if (!(await bcrypt.compare(code, challenge.codeHash))) {
      await this.db
        .update(otpChallenges)
        .set({ attemptCount: challenge.attemptCount + 1 })
        .where(eq(otpChallenges.id, challenge.id));
      reject();
    }

    await this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);

    let user: UserRow;
    let isNewUser = false;

    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      user = updated;
    } else {
      isNewUser = true;
      const [created] = await this.db
        .insert(users)
        .values({ phoneE164, displayName: '', role: UserRole.SEEKER, isProfileComplete: false })
        .returning();
      user = created;
      await this.analytics.track(AnalyticsEvent.USER_REGISTERED, user.id, {});
    }

    await this.analytics.track(AnalyticsEvent.OTP_VERIFIED, user.id, { isNewUser });

    return {
      tokens: await this.issueTokens(user.id),
      user: toUserProfile(user),
      isNewUser,
    };
  }

  async refresh(presentedToken: string): Promise<AuthTokens> {
    const tokenHash = hashOpaqueToken(presentedToken);

    const [stored] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!stored) {
      throw new UnauthorizedException({
        errorCode: ErrorCode.REFRESH_INVALID,
        message: 'Session is no longer valid. Please log in again.',
      });
    }

    if (stored.revokedAt !== null) {
      // A rotated token being replayed means it leaked. Kill every session.
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedException({
        errorCode: ErrorCode.REFRESH_REUSE_DETECTED,
        message: 'Session ended for security reasons. Please log in again.',
      });
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        errorCode: ErrorCode.REFRESH_EXPIRED,
        message: 'Session expired. Please log in again.',
      });
    }

    const tokens = await this.issueTokens(stored.userId);

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    await this.analytics.track(AnalyticsEvent.SESSION_REFRESHED, stored.userId, {});

    return tokens;
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async logout(userId: string): Promise<void> {
    await this.revokeAllSessions(userId);
    await this.analytics.track(AnalyticsEvent.LOGGED_OUT, userId, {});
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );

    const refreshToken = randomBytes(48).toString('base64url');

    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });

    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

/**
 * Refresh tokens are 384 bits of CSPRNG output, not user-chosen secrets, so a
 * fast digest is correct here: it cannot be brute-forced offline and it gives
 * O(1) indexed lookup, which bcrypt would not.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    role: row.role as UserRole,
    isProfileComplete: row.isProfileComplete,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt.toISOString(),
  };
}

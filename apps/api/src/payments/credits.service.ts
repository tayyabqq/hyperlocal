import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { AnalyticsEvent } from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { listingCredits, users } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';

export const CreditReason = {
  /** The launch offer: every user's first listing is free. */
  LAUNCH_GRANT: 'LAUNCH_GRANT',
  /** Issued by an operator, e.g. to a community anchor or after a bad listing. */
  ADMIN_GRANT: 'ADMIN_GRANT',
  /** Spent on a listing. */
  LISTING_PAYMENT: 'LISTING_PAYMENT',
} as const;

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly analytics: AnalyticsService,
  ) {}

  async balanceOf(userId: string): Promise<number> {
    const rows = await this.db.execute<{ balance: number }>(sql`
      SELECT COALESCE(SUM(delta), 0)::int AS balance
      FROM ${listingCredits} WHERE user_id = ${userId}
    `);
    return rows[0]?.balance ?? 0;
  }

  async grant(userId: string, count: number, reason: string): Promise<void> {
    await this.db.insert(listingCredits).values({ userId, delta: count, reason });
    await this.analytics.track(AnalyticsEvent.CREDIT_GRANTED, userId, { count, reason });
  }

  /**
   * Spends one credit if the user has one, granting the launch credit first if
   * they have never held a ledger row.
   *
   * The whole check-and-spend runs inside a transaction that takes a row lock
   * on the user, so two listings posted at the same instant cannot both see the
   * same single credit and each spend it.
   */
  async tryConsumeOne(userId: string, listingId: string): Promise<boolean> {
    const launchGrant = Number(this.config.get<string>('LAUNCH_FREE_LISTING_CREDITS') ?? 1);

    const consumed = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${users} WHERE id = ${userId} FOR UPDATE`);

      const [ledger] = await tx.execute<{ balance: number; entries: number }>(sql`
        SELECT COALESCE(SUM(delta), 0)::int AS balance, COUNT(*)::int AS entries
        FROM ${listingCredits} WHERE user_id = ${userId}
      `);

      let balance = ledger?.balance ?? 0;
      const isFirstEverListing = (ledger?.entries ?? 0) === 0;

      if (isFirstEverListing && launchGrant > 0) {
        await tx
          .insert(listingCredits)
          .values({ userId, delta: launchGrant, reason: CreditReason.LAUNCH_GRANT });
        balance += launchGrant;
      }

      if (balance < 1) return false;

      await tx.insert(listingCredits).values({
        userId,
        delta: -1,
        reason: CreditReason.LISTING_PAYMENT,
        listingId,
      });
      return true;
    });

    if (consumed) {
      await this.analytics.track(AnalyticsEvent.CREDIT_CONSUMED, userId, { listingId });
      this.logger.log(`Listing ${listingId} settled from credit balance.`);
    }
    return consumed;
  }

  /** Used by the admin panel to attribute grants; kept here so the ledger has one owner. */
  async historyFor(userId: string, limit = 50) {
    return this.db
      .select()
      .from(listingCredits)
      .where(eq(listingCredits.userId, userId))
      .orderBy(sql`created_at DESC`)
      .limit(limit);
  }
}

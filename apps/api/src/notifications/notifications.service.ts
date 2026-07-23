import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { AnalyticsEvent, DevicePlatform } from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { deviceTokens } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push-provider.interface';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Upserts a device token, re-homing it if it moved to another account. */
  async registerDevice(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.db
      .insert(deviceTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: { userId, platform, lastSeenAt: new Date() },
      });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.db
      .delete(deviceTokens)
      .where(sql`${deviceTokens.token} = ${token} AND ${deviceTokens.userId} = ${userId}`);
  }

  /**
   * Fan-out to every device a user owns. Fire-and-forget: a push failure must
   * never propagate into whatever user action triggered it, so all errors are
   * contained here and dead tokens are pruned.
   */
  async notifyUser(userId: string, message: PushMessage): Promise<void> {
    try {
      const tokens = await this.db
        .select({ token: deviceTokens.token, platform: deviceTokens.platform })
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, userId));

      if (tokens.length === 0) return;

      const { invalidTokens } = await this.push.send(tokens, message);

      if (invalidTokens.length > 0) {
        await this.db.delete(deviceTokens).where(inArray(deviceTokens.token, invalidTokens));
      }

      await this.analytics.track(AnalyticsEvent.PUSH_SENT, userId, {
        delivered: tokens.length - invalidTokens.length,
        title: message.title,
      });
    } catch (error) {
      this.logger.error(
        `Failed to notify user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

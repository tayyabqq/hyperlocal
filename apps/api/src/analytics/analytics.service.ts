import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnalyticsEventName } from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { analyticsEvents } from '../db/schema';

type EventProperties = Record<string, string | number | boolean | null>;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Fire-and-forget. Analytics must never fail a user-facing request, so
   * errors are logged and swallowed rather than propagated.
   */
  async track(
    eventName: AnalyticsEventName,
    userId: string | null,
    properties: EventProperties = {},
  ): Promise<void> {
    try {
      await this.db.insert(analyticsEvents).values({ eventName, userId, properties });
    } catch (error) {
      this.logger.warn(
        `Failed to record analytics event "${eventName}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
